'use strict';

const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');

const DEFAULT_BAUD = Number(process.env.PICO_BAUD_RATE || 115200);
const DEFAULT_PATH = process.env.PICO_SERIAL_PATH || 'auto';
const DEFAULT_DEVICE_ID = process.env.PICO_DEVICE_ID || 'pico2w-rfid-01';

class PicoRfidBridge extends EventEmitter {
    constructor(options = {}) {
        super();

        this.logger = options.logger || console;
        this.enabled = options.enabled !== undefined
            ? Boolean(options.enabled)
            : (process.env.HARDWARE_HUB_ENABLED !== 'false' && process.env.PICO_RFID_ENABLED === 'true');

        this.serialPath = options.serialPath || DEFAULT_PATH;
        this.baudRate = Number(options.baudRate || DEFAULT_BAUD);
        this.expectedDeviceId = String(options.deviceId || DEFAULT_DEVICE_ID);
        this.reconnectDelayMs = Number(options.reconnectDelayMs || 3000);
        this.heartbeatTimeoutMs = Number(options.heartbeatTimeoutMs || 25000);

        this._started = false;
        this._port = null;
        this._buffer = '';
        this._reconnectTimer = null;
        this._watchdogTimer = null;

        this._connected = false;
        this._deviceOnline = false;
        this._activePortPath = null;
        this._lastHeartbeatAt = 0;
        this._lastScanAt = 0;
        this._lastMalformedLineAt = 0;
        this._lastError = null;
    }

    async start() {
        if (this._started) return;

        this._started = true;
        this._startWatchdog();

        if (!this.enabled) {
            this.logger.info('[PicoRfidBridge] Disabled by configuration');
            this._emitStatus();
            return;
        }

        await this._connect();
    }

    async stop() {
        this._started = false;
        this._clearReconnect();
        this._stopWatchdog();

        if (this._port) {
            await new Promise((resolve) => {
                try {
                    this._port.close(() => resolve());
                } catch (_) {
                    resolve();
                }
            });
            this._port = null;
        }

        this._connected = false;
        this._deviceOnline = false;
        this._activePortPath = null;
        this._emitStatus();
    }

    getStatus() {
        return {
            enabled: this.enabled,
            started: this._started,
            connected: this._connected,
            deviceOnline: this._deviceOnline,
            serialPath: this._activePortPath,
            baudRate: this.baudRate,
            expectedDeviceId: this.expectedDeviceId,
            lastHeartbeatAt: this._lastHeartbeatAt || null,
            lastScanAt: this._lastScanAt || null,
            lastMalformedLineAt: this._lastMalformedLineAt || null,
            lastError: this._lastError,
        };
    }

    async sendLedState(state) {
        const normalized = String(state || '').trim().toLowerCase();
        if (!normalized) return false;

        return this.sendJson({ type: 'led', state: normalized });
    }

    async sendJson(payload) {
        if (!this._port || !this._port.isOpen) {
            return false;
        }

        return new Promise((resolve) => {
            try {
                this._port.write(`${JSON.stringify(payload)}\n`, (err) => {
                    if (err) {
                        this._lastError = err.message;
                        this.logger.warn('[PicoRfidBridge] Write failed:', err.message);
                        resolve(false);
                        return;
                    }
                    resolve(true);
                });
            } catch (err) {
                this._lastError = err.message;
                this.logger.warn('[PicoRfidBridge] Write exception:', err.message);
                resolve(false);
            }
        });
    }

    async _connect() {
        if (!this._started || !this.enabled) return;

        const portPath = await this._resolvePortPath();
        if (!portPath) {
            this._lastError = 'no_serial_port_found';
            this.logger.warn('[PicoRfidBridge] No Pico serial port found, retrying...');
            this._emitStatus();
            this._scheduleReconnect();
            return;
        }

        this._activePortPath = portPath;

        if (this._port) {
            try { this._port.removeAllListeners(); } catch (_) {}
            try {
                if (this._port.isOpen) {
                    this._port.close();
                }
            } catch (_) {}
            this._port = null;
        }

        const port = new SerialPort({
            path: portPath,
            baudRate: this.baudRate,
            autoOpen: false,
        });

        port.on('data', (chunk) => this._onData(chunk));
        port.on('close', () => this._onClose());
        port.on('error', (err) => this._onError(err));

        this._port = port;

        port.open((err) => {
            if (err) {
                this._lastError = err.message;
                this.logger.warn('[PicoRfidBridge] Open failed:', err.message);
                this._connected = false;
                this._deviceOnline = false;
                this._emitStatus();
                this._scheduleReconnect();
                return;
            }

            this._lastError = null;
            this._connected = true;
            this._deviceOnline = true;
            this._emitStatus();
            this.logger.info(`[PicoRfidBridge] Connected to ${portPath} @ ${this.baudRate}`);

            this.sendLedState('ready').catch(() => {});
        });
    }

    async _resolvePortPath() {
        if (this.serialPath && this.serialPath !== 'auto') {
            return this.serialPath;
        }

        try {
            const ports = await SerialPort.list();
            const preferred = ports.find((p) => (
                (p.vendorId && p.vendorId.toLowerCase() === '2e8a') ||
                /raspberry/i.test(String(p.manufacturer || '')) ||
                /ttyACM/i.test(String(p.path || ''))
            ));

            if (preferred && preferred.path) {
                return preferred.path;
            }

            const fallback = ports.find((p) => /ttyUSB|usbmodem|ttyACM/i.test(String(p.path || '')));
            return fallback ? fallback.path : null;
        } catch (err) {
            this._lastError = err.message;
            this.logger.warn('[PicoRfidBridge] Port listing failed:', err.message);
            return null;
        }
    }

    _onData(chunk) {
        this._buffer += chunk.toString('utf8');

        while (true) {
            const idx = this._buffer.indexOf('\n');
            if (idx === -1) break;

            const line = this._buffer.slice(0, idx).trim();
            this._buffer = this._buffer.slice(idx + 1);

            if (!line) continue;
            this._handleLine(line);
        }
    }

    _handleLine(line) {
        let parsed;
        try {
            parsed = JSON.parse(line);
        } catch (_) {
            this._lastMalformedLineAt = Date.now();
            this.emit('malformed_line', { line });
            return;
        }

        if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
            this._lastMalformedLineAt = Date.now();
            this.emit('malformed_line', { line, parsed });
            return;
        }

        if (parsed.type === 'heartbeat') {
            if (!this._isValidHeartbeat(parsed)) {
                this._lastMalformedLineAt = Date.now();
                this.emit('malformed_line', { line, parsed, reason: 'invalid_heartbeat' });
                return;
            }

            this._lastHeartbeatAt = Date.now();
            this._deviceOnline = true;
            this.emit('heartbeat', {
                deviceId: parsed.deviceId,
                uptimeMs: Number(parsed.uptimeMs),
                receivedAt: this._lastHeartbeatAt,
            });
            this._emitStatus();
            return;
        }

        if (parsed.type === 'rfid_scan') {
            if (!this._isValidScan(parsed)) {
                this._lastMalformedLineAt = Date.now();
                this.emit('malformed_line', { line, parsed, reason: 'invalid_scan' });
                return;
            }

            this._lastScanAt = Date.now();
            this._deviceOnline = true;
            const event = {
                deviceId: parsed.deviceId,
                uid: String(parsed.uid),
                timestampMs: Number(parsed.timestampMs),
                nonce: String(parsed.nonce),
                receivedAt: this._lastScanAt,
            };

            this.emit('scan', event);
            this._emitStatus();
            return;
        }

        this.emit('message', parsed);
    }

    _isValidHeartbeat(payload) {
        if (typeof payload.deviceId !== 'string' || !payload.deviceId.trim()) return false;
        if (typeof payload.uptimeMs !== 'number' || payload.uptimeMs < 0) return false;
        return true;
    }

    _isValidScan(payload) {
        if (typeof payload.deviceId !== 'string' || !payload.deviceId.trim()) return false;
        if (typeof payload.uid !== 'string' || payload.uid.length < 3 || payload.uid.length > 128) return false;
        if (typeof payload.timestampMs !== 'number' || payload.timestampMs < 0) return false;
        if (typeof payload.nonce !== 'string' || payload.nonce.length < 1 || payload.nonce.length > 128) return false;
        return true;
    }

    _onClose() {
        this._connected = false;
        this._deviceOnline = false;
        this._emitStatus();
        this.logger.warn('[PicoRfidBridge] Serial port closed');
        this._scheduleReconnect();
    }

    _onError(err) {
        this._lastError = err && err.message ? err.message : 'serial_error';
        this._connected = false;
        this._deviceOnline = false;
        this._emitStatus();
        this.logger.warn('[PicoRfidBridge] Serial error:', this._lastError);
    }

    _scheduleReconnect() {
        if (!this._started || !this.enabled) return;
        if (this._reconnectTimer) return;

        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null;
            await this._connect();
        }, this.reconnectDelayMs);
    }

    _clearReconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    _startWatchdog() {
        this._stopWatchdog();
        this._watchdogTimer = setInterval(() => {
            if (!this._started || !this.enabled) return;
            if (!this._connected) return;
            if (!this._lastHeartbeatAt) return;

            const ageMs = Date.now() - this._lastHeartbeatAt;
            if (ageMs > this.heartbeatTimeoutMs && this._deviceOnline) {
                this._deviceOnline = false;
                this._lastError = 'heartbeat_timeout';
                this.logger.warn('[PicoRfidBridge] Heartbeat timeout detected');
                this._emitStatus();
            }
        }, 2000);
    }

    _stopWatchdog() {
        if (this._watchdogTimer) {
            clearInterval(this._watchdogTimer);
            this._watchdogTimer = null;
        }
    }

    _emitStatus() {
        this.emit('status', this.getStatus());
    }
}

module.exports = PicoRfidBridge;
