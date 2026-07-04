'use strict';

const { EventEmitter } = require('events');
const PicoRfidBridge = require('./PicoRfidBridge');
const RfidApprovalService = require('./RfidApprovalService');

class HardwareSecurityHubService extends EventEmitter {
    constructor(options = {}) {
        super();

        this.logger = options.logger || console;
        this.enabled = process.env.HARDWARE_HUB_ENABLED !== 'false';

        this.bridge = new PicoRfidBridge({
            logger: this.logger,
            enabled: this.enabled,
        });

        this.rfid = new RfidApprovalService({ logger: this.logger });

        this._started = false;
        this._bound = false;
    }

    async start() {
        if (this._started) return;

        await this.rfid.initSchema();
        this._bindEvents();

        await this.bridge.start();
        this._started = true;
    }

    async stop() {
        if (!this._started) return;
        await this.bridge.stop();
        this._started = false;
    }

    async createChallenge(payload) {
        return this.rfid.createChallenge(payload);
    }

    async getChallengeStatus(payload) {
        return this.rfid.getChallengeStatus(payload);
    }

    async consumeAdminLoginChallenge(payload) {
        return this.rfid.consumeAdminLoginChallenge(payload);
    }

    async consumeBaselineApproval(payload = {}) {
        return this.rfid.consumeBaselineApproval(payload);
    }

    async registerCardHash(payload) {
        return this.rfid.registerCardHash(payload);
    }

    async hashUid(uid) {
        return this.rfid.hashUid(uid);
    }

    async listCards() {
        return this.rfid.listCards();
    }

    async listRecentEvents(limit = 50) {
        return this.rfid.listRecentEvents(limit);
    }

    async sendLedState(state) {
        return this.bridge.sendLedState(state);
    }

    async getStatus() {
        const [overview, device] = await Promise.all([
            this.rfid.getOverview(),
            this.rfid.getDeviceStatus(),
        ]);

        return {
            bridge: this.bridge.getStatus(),
            overview,
            device,
        };
    }

    isEnabled() {
        const bridgeEnabled = this.bridge.enabled;
        return Boolean(this.enabled && bridgeEnabled);
    }

    _bindEvents() {
        if (this._bound) return;
        this._bound = true;

        this.bridge.on('status', async (status) => {
            const deviceId = status.expectedDeviceId || process.env.PICO_DEVICE_ID || 'pico2w-rfid-01';
            const mappedStatus = status.connected && status.deviceOnline ? 'online' : 'offline';
            try {
                await this.rfid.updateDeviceStatus({
                    deviceId,
                    status: mappedStatus,
                    metadata: {
                        serialPath: status.serialPath,
                        lastHeartbeatAt: status.lastHeartbeatAt,
                        lastScanAt: status.lastScanAt,
                        lastError: status.lastError,
                    },
                });
            } catch (err) {
                this.logger.warn('[HardwareHub] Failed to persist device status:', err.message);
            }

            this.emit('status', status);
        });

        this.bridge.on('heartbeat', async (heartbeat) => {
            try {
                await this.rfid.updateDeviceStatus({
                    deviceId: heartbeat.deviceId,
                    status: 'online',
                    metadata: {
                        uptimeMs: heartbeat.uptimeMs,
                        receivedAt: heartbeat.receivedAt,
                    },
                });
            } catch (err) {
                this.logger.warn('[HardwareHub] Failed to store heartbeat:', err.message);
            }

            this.emit('heartbeat', heartbeat);
        });

        this.bridge.on('scan', async (scanEvent) => {
            try {
                const outcome = await this.rfid.handleScanEvent(scanEvent);
                if (outcome?.ledState) {
                    await this.bridge.sendLedState(outcome.ledState);
                }
                this.emit('scan', { scanEvent, outcome });
            } catch (err) {
                this.logger.error('[HardwareHub] Scan handling failed:', err.message || err);
                await this.bridge.sendLedState('rejected').catch(() => {});
            }
        });

        this.rfid.on('challengeApproved', (approval) => {
            this.emit('challengeApproved', approval);
        });
    }
}

let singleton = null;

function getHardwareSecurityHub() {
    if (!singleton) {
        singleton = new HardwareSecurityHubService();
    }
    return singleton;
}

module.exports = {
    HardwareSecurityHubService,
    getHardwareSecurityHub,
};
