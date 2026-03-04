/**
 * RealtimeService — Client-side WebSocket manager for dashboard analytics.
 *
 * Features:
 *  - Auto-reconnect with exponential backoff.
 *  - Per-guild subscription lifecycle.
 *  - Event batching acknowledgment.
 *  - Live status indicator (Live / Syncing / Disconnected).
 *  - Maintains chart zoom/state across data updates.
 *
 * Usage:
 *   const rt = new RealtimeService();
 *   rt.connect(authToken);
 *   rt.subscribeAnalytics(guildId, (batch) => { ... });
 *   rt.onStatus((status) => updateIndicator(status));
 */

class RealtimeService {
    constructor() {
        this._ws = null;
        this._token = null;
        this._reconnectDelay = 1000;
        this._maxReconnectDelay = 30000;
        this._reconnectTimer = null;
        this._pingTimer = null;
        this._lastPong = 0;

        /** @type {'disconnected'|'connecting'|'live'|'syncing'} */
        this.status = 'disconnected';

        /** @type {Map<string, Function[]>} guildId → callback arrays */
        this._analyticsListeners = new Map();

        /** @type {Map<string, Function[]>} guildId → snapshot callbacks */
        this._snapshotListeners = new Map();

        /** @type {Function[]} status change callbacks */
        this._statusListeners = [];

        /** @type {Map<string, Object>} guildId → latest snapshot */
        this._snapshots = new Map();

        /** @type {Set<string>} guilds we're subscribed to */
        this._subscribedGuilds = new Set();
    }

    /* ═══════════ Connection ═══════════ */

    connect(token) {
        if (this._ws && this._ws.readyState <= 1) return; // already open/opening

        this._token = token || this._token;
        if (!this._token) return;

        this._setStatus('connecting');

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(this._token)}`;

        this._ws = new WebSocket(url);

        this._ws.onopen = () => {
            this._reconnectDelay = 1000;
            this._setStatus('live');
            this._startPing();

            // Re-subscribe to any previously active guilds
            for (const guildId of this._subscribedGuilds) {
                this._send('analytics_subscribe', { guildId });
                this._send('subscribe', { guildId });
            }
        };

        this._ws.onmessage = (evt) => {
            try {
                const { type, payload } = JSON.parse(evt.data);
                this._handleMessage(type, payload);
            } catch { /* malformed */ }
        };

        this._ws.onclose = () => {
            this._stopPing();
            this._setStatus('disconnected');
            this._scheduleReconnect();
        };

        this._ws.onerror = () => {
            // onclose will fire after this
        };
    }

    disconnect() {
        clearTimeout(this._reconnectTimer);
        this._stopPing();
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.close();
            this._ws = null;
        }
        this._setStatus('disconnected');
    }

    /* ═══════════ Subscriptions ═══════════ */

    /**
     * Subscribe to realtime analytics batch events for a guild.
     * @param {string} guildId
     * @param {(events: Array) => void} callback - Called with each batch of events
     * @returns {Function} unsubscribe function
     */
    subscribeAnalytics(guildId, callback) {
        if (!this._analyticsListeners.has(guildId)) {
            this._analyticsListeners.set(guildId, []);
        }
        this._analyticsListeners.get(guildId).push(callback);
        this._subscribedGuilds.add(guildId);

        // Subscribe over WS if connected
        if (this._ws?.readyState === WebSocket.OPEN) {
            this._send('analytics_subscribe', { guildId });
            this._send('subscribe', { guildId });
        }

        return () => {
            const list = this._analyticsListeners.get(guildId);
            if (list) {
                const idx = list.indexOf(callback);
                if (idx >= 0) list.splice(idx, 1);
            }
        };
    }

    /**
     * Subscribe to snapshot updates for a guild.
     * @param {string} guildId
     * @param {(snapshot: Object) => void} callback
     * @returns {Function} unsubscribe
     */
    subscribeSnapshot(guildId, callback) {
        if (!this._snapshotListeners.has(guildId)) {
            this._snapshotListeners.set(guildId, []);
        }
        this._snapshotListeners.get(guildId).push(callback);

        // Immediately send cached snapshot if we have one
        const cached = this._snapshots.get(guildId);
        if (cached) callback(cached);

        return () => {
            const list = this._snapshotListeners.get(guildId);
            if (list) {
                const idx = list.indexOf(callback);
                if (idx >= 0) list.splice(idx, 1);
            }
        };
    }

    /**
     * Listen for connection status changes.
     * @param {(status: string) => void} callback
     * @returns {Function} unsubscribe
     */
    onStatus(callback) {
        this._statusListeners.push(callback);
        callback(this.status); // immediate delivery
        return () => {
            const idx = this._statusListeners.indexOf(callback);
            if (idx >= 0) this._statusListeners.splice(idx, 1);
        };
    }

    /** Get the latest snapshot for a guild. */
    getSnapshot(guildId) {
        return this._snapshots.get(guildId) ?? null;
    }

    /* ═══════════ Internal ═══════════ */

    _handleMessage(type, payload) {
        switch (type) {
            case 'pong':
                this._lastPong = Date.now();
                break;

            case 'analytics_batch': {
                const guildId = payload?.guildId || this._inferGuild(payload);
                if (guildId) {
                    const cbs = this._analyticsListeners.get(guildId) ?? [];
                    for (const cb of cbs) cb(payload.events);
                }
                // Also broadcast to any guild the events belong to
                if (payload?.events) {
                    for (const evt of payload.events) {
                        if (evt.guildId && evt.guildId !== guildId) {
                            const cbs2 = this._analyticsListeners.get(evt.guildId) ?? [];
                            for (const cb of cbs2) cb([evt]);
                        }
                    }
                }
                break;
            }

            case 'analytics_snapshot': {
                const guildId = payload?.guildId;
                if (guildId && payload.snapshot) {
                    this._snapshots.set(guildId, payload.snapshot);
                    const cbs = this._snapshotListeners.get(guildId) ?? [];
                    for (const cb of cbs) cb(payload.snapshot);
                }
                break;
            }

            case 'analytics_subscribed':
                if (this.status !== 'live') this._setStatus('live');
                break;

            case 'connected':
                break; // handled by onopen

            case 'security_incident':
            case 'mod_action':
            case 'verification_event':
            case 'settings_changed':
                // Forward as analytics events to listeners
                for (const guildId of this._subscribedGuilds) {
                    const cbs = this._analyticsListeners.get(guildId) ?? [];
                    for (const cb of cbs) cb([{ t: type, ts: Date.now(), d: payload }]);
                }
                break;
        }
    }

    _inferGuild(payload) {
        // Best-effort: return first subscribed guild
        return this._subscribedGuilds.values().next().value ?? null;
    }

    _send(type, payload) {
        if (this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type, payload }));
        }
    }

    _setStatus(s) {
        if (this.status === s) return;
        this.status = s;
        for (const cb of this._statusListeners) cb(s);
    }

    _scheduleReconnect() {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => {
            this._setStatus('syncing');
            this.connect();
        }, this._reconnectDelay);

        this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
    }

    _startPing() {
        this._stopPing();
        this._lastPong = Date.now();
        this._pingTimer = setInterval(() => {
            if (Date.now() - this._lastPong > 45000) {
                // Server not responding, force reconnect
                this._ws?.close();
                return;
            }
            this._send('ping', {});
        }, 20000);
    }

    _stopPing() {
        clearInterval(this._pingTimer);
    }
}

// Singleton
window.DLRealtime = window.DLRealtime || new RealtimeService();
