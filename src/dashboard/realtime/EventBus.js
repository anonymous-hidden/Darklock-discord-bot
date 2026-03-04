'use strict';

/**
 * EventBus — Central realtime event aggregator.
 *
 * Collects bot events (messages, joins, mod actions, security alerts),
 * batches them per guild, and flushes to the WebSocket layer at a
 * configurable interval (default 500 ms).
 *
 * Design:
 *  - Per-guild event queues prevent cross-guild data leaks.
 *  - Flush interval is tunable between 250–1000 ms for latency/throughput.
 *  - Subscribers are WebSocket broadcast functions, not raw sockets.
 */

const { EventEmitter } = require('events');

const MIN_FLUSH_MS =  250;
const MAX_FLUSH_MS = 1000;
const DEFAULT_FLUSH_MS = 500;

class EventBus extends EventEmitter {
    /**
     * @param {Object} opts
     * @param {number} [opts.flushInterval=500] - Batch flush interval in ms.
     */
    constructor(opts = {}) {
        super();
        this.setMaxListeners(100);

        this.flushInterval = Math.max(MIN_FLUSH_MS,
            Math.min(MAX_FLUSH_MS, opts.flushInterval ?? DEFAULT_FLUSH_MS));

        /** @type {Map<string, Array<Object>>} guildId → queued events */
        this._queues = new Map();

        /** @type {Map<string, Object>} guildId → latest snapshot (for new subscribers) */
        this._snapshots = new Map();

        this._flushTimer = setInterval(() => this._flush(), this.flushInterval);
    }

    /* ─── public API ──────────────────────────────────────────────── */

    /**
     * Push one analytics event into the batch queue.
     * @param {string} guildId
     * @param {string} eventType - e.g. 'message', 'member_join', 'mod_action', 'security_event'
     * @param {Object} data      - event payload
     */
    push(guildId, eventType, data) {
        if (!guildId || !eventType) return;

        if (!this._queues.has(guildId)) {
            this._queues.set(guildId, []);
        }

        this._queues.get(guildId).push({
            t: eventType,
            ts: Date.now(),
            d: data,
        });
    }

    /**
     * Store a guild analytics snapshot (latest aggregate stats).
     * Sent to clients immediately on subscribe so they don't start blank.
     */
    setSnapshot(guildId, snapshot) {
        this._snapshots.set(guildId, { ...snapshot, _ts: Date.now() });
    }

    /** Get the latest snapshot for a guild (or null). */
    getSnapshot(guildId) {
        return this._snapshots.get(guildId) ?? null;
    }

    /** Graceful shutdown. */
    destroy() {
        clearInterval(this._flushTimer);
        this._flush(); // flush remaining
        this._queues.clear();
        this._snapshots.clear();
        this.removeAllListeners();
    }

    /* ─── internal ────────────────────────────────────────────────── */

    _flush() {
        for (const [guildId, queue] of this._queues) {
            if (queue.length === 0) continue;

            // Emit a single batched event per guild
            this.emit('flush', guildId, queue);

            // Clear queue
            this._queues.set(guildId, []);
        }
    }
}

module.exports = EventBus;
