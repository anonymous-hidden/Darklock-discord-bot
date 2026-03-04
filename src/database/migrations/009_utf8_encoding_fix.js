'use strict';

/**
 * Migration 009: UTF-8 & Emoji Encoding Fix
 *
 * Root Cause:
 *   SQLite uses UTF-8 by default, but:
 *   1. PRAGMA encoding may not be set explicitly.
 *   2. Node's sqlite3 binding can corrupt multi-byte chars if text is
 *      coerced through latin1 anywhere in the pipeline.
 *   3. Some older rows may contain replacement chars (U+FFFD) or literal '??'
 *      from prior writes that truncated surrogate pairs.
 *
 * This migration:
 *   - Forces PRAGMA encoding = 'UTF-8' (idempotent, SQLite default).
 *   - Enables WAL journal mode for safer concurrent reads.
 *   - Adds a `_utf8_verified` flag to guild_configs so we can track.
 */

module.exports = {
    version: 9,
    name: '009_utf8_encoding_fix',

    async up(db) {
        // 1. Ensure UTF-8 encoding
        await db.runAsync("PRAGMA encoding = 'UTF-8'");

        // 2. Enable WAL for better write concurrency
        await db.runAsync('PRAGMA journal_mode = WAL');

        // 3. Track that this db has been verified for encoding
        try {
            await db.runAsync(`ALTER TABLE guild_configs ADD COLUMN _utf8_verified INTEGER DEFAULT 0`);
        } catch (e) {
            // Column already exists — fine
            if (!e.message.includes('duplicate column')) throw e;
        }

        // 4. Test round-trip of a multi-byte string
        const testStr = '🛡️ DarkLock 日本語 café ñ';
        await db.runAsync(
            `INSERT OR REPLACE INTO bot_logs (type, user_id, guild_id, command, endpoint, detail)
             VALUES ('utf8_test', 'system', 'system', 'migration_009', '/migration', ?)`,
            [testStr]
        );
        const row = await db.getAsync(
            `SELECT detail FROM bot_logs WHERE type = 'utf8_test' AND user_id = 'system' LIMIT 1`
        );
        if (row?.detail !== testStr) {
            console.error('[Migration 009] UTF-8 round-trip FAILED. Got:', row?.detail);
        } else {
            console.log('[Migration 009] UTF-8 round-trip OK ✅');
        }

        // Cleanup test row
        await db.runAsync(`DELETE FROM bot_logs WHERE type = 'utf8_test'`);
    },

    async down(db) {
        // No destructive rollback needed
    }
};
