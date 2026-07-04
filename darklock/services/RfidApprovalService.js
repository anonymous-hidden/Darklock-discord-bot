'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');
const db = require('../utils/database');

const DEFAULT_TTL_SECONDS = Number(process.env.RFID_APPROVAL_TTL_SECONDS || 120);
const DEFAULT_SECRET = process.env.RFID_HASH_SECRET || '';
const DEFAULT_DEVICE_ID = process.env.PICO_DEVICE_ID || 'pico2w-rfid-01';
const FAILED_COOLDOWN_MS = Number(process.env.RFID_FAILED_COOLDOWN_MS || 4000);

function nowIso() {
    return new Date().toISOString();
}

function randomId() {
    return crypto.randomUUID();
}

class RfidApprovalService extends EventEmitter {
    constructor(options = {}) {
        super();

        this.logger = options.logger || console;
        this.defaultDeviceId = String(options.deviceId || DEFAULT_DEVICE_ID);
        this.secret = String(options.secret || DEFAULT_SECRET);
        this.ttlSeconds = Number(options.ttlSeconds || DEFAULT_TTL_SECONDS);
        this.failedCooldownMs = Number(options.failedCooldownMs || FAILED_COOLDOWN_MS);

        this._schemaReady = false;
        this._failedCooldownUntil = new Map();
        this._lastScanSummary = null;
    }

    async initSchema() {
        if (this._schemaReady) return;
        if (!db.ready) {
            await db.initialize();
        }

        await db.run(`
            CREATE TABLE IF NOT EXISTS rfid_cards (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                uid_hash TEXT NOT NULL UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1,
                allowed_purposes_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used_at TEXT
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS rfid_challenges (
                id TEXT PRIMARY KEY,
                purpose TEXT NOT NULL,
                admin_user_id TEXT,
                challenge_token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                approved_at TEXT,
                consumed_at TEXT,
                status TEXT NOT NULL,
                metadata_json TEXT,
                created_at TEXT NOT NULL
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS rfid_events (
                id TEXT PRIMARY KEY,
                device_id TEXT,
                event_type TEXT NOT NULL,
                accepted INTEGER NOT NULL,
                purpose TEXT,
                reason TEXT,
                created_at TEXT NOT NULL
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS hardware_devices (
                device_id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                last_seen_at TEXT,
                metadata_json TEXT
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS baseline_approvals (
                id TEXT PRIMARY KEY,
                challenge_id TEXT NOT NULL,
                approved_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                consumed_at TEXT,
                created_at TEXT NOT NULL
            )
        `);

        await db.run(`CREATE INDEX IF NOT EXISTS idx_rfid_cards_hash ON rfid_cards(uid_hash)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_rfid_challenges_status ON rfid_challenges(status)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_rfid_challenges_expiry ON rfid_challenges(expires_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_rfid_events_created ON rfid_events(created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_baseline_approvals_expires ON baseline_approvals(expires_at)`);

        this._schemaReady = true;
    }

    isHashingConfigured() {
        return Boolean(this.secret);
    }

    hashUid(uid) {
        if (!this.secret) {
            throw new Error('RFID_HASH_SECRET is required for UID hashing');
        }
        return crypto
            .createHmac('sha256', this.secret)
            .update(String(uid || '').trim(), 'utf8')
            .digest('hex');
    }

    async createChallenge({ purpose, adminUserId = null, ttlSeconds = this.ttlSeconds, metadata = {} }) {
        await this.initSchema();
        await this.expirePendingChallenges();

        const now = Date.now();
        const expiresAt = new Date(now + (Number(ttlSeconds) * 1000)).toISOString();
        const id = randomId();
        const challengeToken = crypto.randomBytes(24).toString('hex');

        await db.run(
            `INSERT INTO rfid_challenges (
                id, purpose, admin_user_id, challenge_token,
                expires_at, approved_at, consumed_at, status, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?)` ,
            [id, String(purpose), adminUserId, challengeToken, expiresAt, JSON.stringify(metadata || {}), nowIso()]
        );

        return {
            id,
            purpose: String(purpose),
            adminUserId,
            challengeToken,
            expiresAt,
            status: 'pending',
        };
    }

    async getChallengeStatus({ challengeId, challengeToken = null }) {
        await this.initSchema();
        await this.expirePendingChallenges();

        const row = await db.get(
            `SELECT * FROM rfid_challenges WHERE id = ?`,
            [String(challengeId)]
        );

        if (!row) return null;
        if (challengeToken && row.challenge_token !== String(challengeToken)) return null;

        return {
            id: row.id,
            purpose: row.purpose,
            adminUserId: row.admin_user_id,
            status: row.status,
            expiresAt: row.expires_at,
            approvedAt: row.approved_at,
            consumedAt: row.consumed_at,
            metadata: this._safeJson(row.metadata_json),
        };
    }

    async consumeAdminLoginChallenge({ challengeId, challengeToken }) {
        const status = await this.getChallengeStatus({ challengeId, challengeToken });
        if (!status) return null;
        if (status.purpose !== 'admin-login') return null;
        if (status.status !== 'approved') return null;

        const consumedAt = nowIso();
        await db.run(
            `UPDATE rfid_challenges
             SET status = 'consumed', consumed_at = ?
             WHERE id = ? AND status = 'approved'`,
            [consumedAt, status.id]
        );

        return {
            ...status,
            status: 'consumed',
            consumedAt,
        };
    }

    async consumeBaselineApproval({ challengeId = null } = {}) {
        await this.initSchema();
        const now = nowIso();

        const row = challengeId
            ? await db.get(
                `SELECT * FROM baseline_approvals
                 WHERE challenge_id = ?
                   AND consumed_at IS NULL
                   AND expires_at > ?
                 ORDER BY approved_at DESC
                 LIMIT 1`,
                [String(challengeId), now]
            )
            : await db.get(
                `SELECT * FROM baseline_approvals
                 WHERE consumed_at IS NULL
                   AND expires_at > ?
                 ORDER BY approved_at DESC
                 LIMIT 1`,
                [now]
            );

        if (!row) return null;

        await db.run(`UPDATE baseline_approvals SET consumed_at = ? WHERE id = ?`, [now, row.id]);
        await db.run(
            `UPDATE rfid_challenges
             SET status = 'consumed', consumed_at = ?
             WHERE id = ? AND status = 'approved'`,
            [now, row.challenge_id]
        );

        return {
            id: row.id,
            challengeId: row.challenge_id,
            approvedAt: row.approved_at,
            expiresAt: row.expires_at,
            consumedAt: now,
        };
    }

    async registerCardHash({ label, uidHash, allowedPurposes, enabled = true }) {
        await this.initSchema();

        const cardId = randomId();
        const purposes = Array.isArray(allowedPurposes) && allowedPurposes.length
            ? allowedPurposes.map((p) => String(p).trim()).filter(Boolean)
            : ['admin-login'];

        await db.run(
            `INSERT INTO rfid_cards (
                id, label, uid_hash, enabled, allowed_purposes_json, created_at, last_used_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(uid_hash) DO UPDATE SET
                label = excluded.label,
                enabled = excluded.enabled,
                allowed_purposes_json = excluded.allowed_purposes_json`,
            [cardId, String(label), String(uidHash), enabled ? 1 : 0, JSON.stringify(purposes), nowIso()]
        );

        const card = await db.get(`SELECT * FROM rfid_cards WHERE uid_hash = ?`, [String(uidHash)]);
        return this._formatCard(card);
    }

    async listCards() {
        await this.initSchema();
        const rows = await db.all(`SELECT * FROM rfid_cards ORDER BY created_at DESC`);
        return rows.map((row) => this._formatCard(row));
    }

    async listRecentEvents(limit = 50) {
        await this.initSchema();
        const rows = await db.all(
            `SELECT * FROM rfid_events ORDER BY created_at DESC LIMIT ?`,
            [Math.max(1, Math.min(200, Number(limit) || 50))]
        );

        return rows.map((row) => ({
            id: row.id,
            deviceId: row.device_id,
            eventType: row.event_type,
            accepted: Boolean(row.accepted),
            purpose: row.purpose,
            reason: row.reason,
            createdAt: row.created_at,
        }));
    }

    async getOverview() {
        await this.initSchema();

        const [lastEvent, cards, pendingChallenges, validBaselineApproval] = await Promise.all([
            db.get(`SELECT * FROM rfid_events ORDER BY created_at DESC LIMIT 1`),
            db.get(`SELECT COUNT(*) AS c FROM rfid_cards WHERE enabled = 1`),
            db.get(`SELECT COUNT(*) AS c FROM rfid_challenges WHERE status = 'pending' AND expires_at > ?`, [nowIso()]),
            db.get(`SELECT COUNT(*) AS c FROM baseline_approvals WHERE consumed_at IS NULL AND expires_at > ?`, [nowIso()]),
        ]);

        return {
            registeredEnabledCards: Number(cards?.c || 0),
            pendingChallenges: Number(pendingChallenges?.c || 0),
            validBaselineApprovals: Number(validBaselineApproval?.c || 0),
            lastScan: this._lastScanSummary,
            lastEvent: lastEvent ? {
                eventType: lastEvent.event_type,
                accepted: Boolean(lastEvent.accepted),
                purpose: lastEvent.purpose,
                reason: lastEvent.reason,
                createdAt: lastEvent.created_at,
            } : null,
        };
    }

    async updateDeviceStatus({ deviceId, status, metadata = {} }) {
        await this.initSchema();

        await db.run(
            `INSERT INTO hardware_devices (device_id, type, status, last_seen_at, metadata_json)
             VALUES (?, 'pico-rfid-hub', ?, ?, ?)
             ON CONFLICT(device_id) DO UPDATE SET
                status = excluded.status,
                last_seen_at = excluded.last_seen_at,
                metadata_json = excluded.metadata_json`,
            [String(deviceId || this.defaultDeviceId), String(status || 'unknown'), nowIso(), JSON.stringify(metadata || {})]
        );
    }

    async getDeviceStatus(deviceId = this.defaultDeviceId) {
        await this.initSchema();
        const row = await db.get(`SELECT * FROM hardware_devices WHERE device_id = ?`, [String(deviceId)]);
        if (!row) return null;
        return {
            deviceId: row.device_id,
            type: row.type,
            status: row.status,
            lastSeenAt: row.last_seen_at,
            metadata: this._safeJson(row.metadata_json),
        };
    }

    async handleScanEvent(scanEvent) {
        await this.initSchema();
        await this.expirePendingChallenges();

        const deviceId = String(scanEvent.deviceId || this.defaultDeviceId);
        await this.updateDeviceStatus({
            deviceId,
            status: 'online',
            metadata: { source: 'scan', lastSeenReason: 'rfid_scan' },
        });

        let uidHash;
        try {
            uidHash = this.hashUid(scanEvent.uid);
        } catch (err) {
            await this._logEvent({
                deviceId,
                eventType: 'rfid_scan',
                accepted: false,
                purpose: null,
                reason: 'hash_secret_missing',
            });
            return {
                accepted: false,
                reason: 'hash_secret_missing',
                ledState: 'rejected',
            };
        }

        const nowMs = Date.now();
        const cooldownUntil = this._failedCooldownUntil.get(uidHash) || 0;
        if (cooldownUntil > nowMs) {
            await this._logEvent({
                deviceId,
                eventType: 'rfid_scan',
                accepted: false,
                purpose: null,
                reason: 'cooldown_active',
            });

            this._lastScanSummary = {
                at: nowIso(),
                accepted: false,
                reason: 'cooldown_active',
            };

            return {
                accepted: false,
                reason: 'cooldown_active',
                ledState: 'rejected',
            };
        }

        const card = await db.get(`SELECT * FROM rfid_cards WHERE uid_hash = ?`, [uidHash]);
        if (!card) {
            this._failedCooldownUntil.set(uidHash, nowMs + this.failedCooldownMs);
            await this._logEvent({
                deviceId,
                eventType: 'rfid_scan',
                accepted: false,
                purpose: null,
                reason: 'unknown_card',
            });

            this._lastScanSummary = {
                at: nowIso(),
                accepted: false,
                reason: 'unknown_card',
            };

            return {
                accepted: false,
                reason: 'unknown_card',
                ledState: 'rejected',
            };
        }

        if (!card.enabled) {
            await this._logEvent({
                deviceId,
                eventType: 'rfid_scan',
                accepted: false,
                purpose: null,
                reason: 'card_disabled',
            });

            this._lastScanSummary = {
                at: nowIso(),
                accepted: false,
                reason: 'card_disabled',
            };

            return {
                accepted: false,
                reason: 'card_disabled',
                ledState: 'rejected',
            };
        }

        const challenge = await db.get(
            `SELECT * FROM rfid_challenges
             WHERE status = 'pending' AND expires_at > ?
             ORDER BY created_at ASC
             LIMIT 1`,
            [nowIso()]
        );

        if (!challenge) {
            await this._logEvent({
                deviceId,
                eventType: 'rfid_scan',
                accepted: false,
                purpose: null,
                reason: 'no_pending_challenge',
            });

            this._lastScanSummary = {
                at: nowIso(),
                accepted: false,
                reason: 'no_pending_challenge',
            };

            return {
                accepted: false,
                reason: 'no_pending_challenge',
                ledState: 'rejected',
            };
        }

        const allowedPurposes = this._safeJson(card.allowed_purposes_json) || [];
        if (!Array.isArray(allowedPurposes) || !allowedPurposes.includes(challenge.purpose)) {
            await this._logEvent({
                deviceId,
                eventType: 'rfid_scan',
                accepted: false,
                purpose: challenge.purpose,
                reason: 'purpose_not_allowed',
            });

            this._lastScanSummary = {
                at: nowIso(),
                accepted: false,
                purpose: challenge.purpose,
                reason: 'purpose_not_allowed',
            };

            return {
                accepted: false,
                reason: 'purpose_not_allowed',
                ledState: 'rejected',
            };
        }

        const approvedAt = nowIso();

        await db.run(
            `UPDATE rfid_challenges
             SET status = 'approved', approved_at = ?
             WHERE id = ? AND status = 'pending'`,
            [approvedAt, challenge.id]
        );

        await db.run(`UPDATE rfid_cards SET last_used_at = ? WHERE id = ?`, [approvedAt, card.id]);

        if (challenge.purpose === 'baseline-generation') {
            await db.run(
                `INSERT INTO baseline_approvals (id, challenge_id, approved_at, expires_at, consumed_at, created_at)
                 VALUES (?, ?, ?, ?, NULL, ?)`,
                [randomId(), challenge.id, approvedAt, challenge.expires_at, approvedAt]
            );
        }

        await this._logEvent({
            deviceId,
            eventType: 'rfid_scan',
            accepted: true,
            purpose: challenge.purpose,
            reason: 'approved',
        });

        const approval = {
            challengeId: challenge.id,
            purpose: challenge.purpose,
            adminUserId: challenge.admin_user_id,
            approvedAt,
            expiresAt: challenge.expires_at,
            cardLabel: card.label,
            cardId: card.id,
        };

        this._lastScanSummary = {
            at: approvedAt,
            accepted: true,
            purpose: challenge.purpose,
            cardLabel: card.label,
        };

        this.emit('challengeApproved', approval);

        return {
            accepted: true,
            reason: 'approved',
            ledState: 'accepted',
            approval,
        };
    }

    async expirePendingChallenges() {
        await this.initSchema();
        const now = nowIso();
        await db.run(
            `UPDATE rfid_challenges
             SET status = 'expired'
             WHERE status = 'pending' AND expires_at <= ?`,
            [now]
        );
    }

    async _logEvent({ deviceId, eventType, accepted, purpose, reason }) {
        await db.run(
            `INSERT INTO rfid_events (id, device_id, event_type, accepted, purpose, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [randomId(), deviceId || null, String(eventType), accepted ? 1 : 0, purpose || null, reason || null, nowIso()]
        );
    }

    _safeJson(raw) {
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    _formatCard(row) {
        if (!row) return null;
        return {
            id: row.id,
            label: row.label,
            uidHash: row.uid_hash,
            enabled: Boolean(row.enabled),
            allowedPurposes: this._safeJson(row.allowed_purposes_json) || [],
            createdAt: row.created_at,
            lastUsedAt: row.last_used_at,
        };
    }
}

module.exports = RfidApprovalService;
