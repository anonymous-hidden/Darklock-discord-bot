'use strict';

/**
 * Migration 010: Ticket System Enhancement
 *
 * Adds:
 *  - ticket_settings table (was missing — code references it but it didn't exist)
 *  - severity column to tickets (critical, high, normal, low)
 *  - SLA fields (response_deadline, resolution_deadline)
 *  - Premium customization fields (custom_colors, custom_labels, auto_tags)
 *  - Ticket tags/labels for categorization
 *  - Satisfaction rating
 */

module.exports = {
    version: 10,
    name: '010_ticket_system_enhancement',

    async up(db) {
        // 1. Create ticket_settings if missing
        await db.runAsync(`
            CREATE TABLE IF NOT EXISTS ticket_settings (
                guild_id TEXT PRIMARY KEY,
                enabled INTEGER DEFAULT 0,
                category_id TEXT,
                support_role_id TEXT,
                log_channel_id TEXT,
                ticket_limit INTEGER DEFAULT 3,
                auto_close_hours INTEGER,
                transcript_channel_id TEXT,
                welcome_message TEXT,
                close_confirmation INTEGER DEFAULT 1,
                
                /* Severity & SLA (premium) */
                severity_enabled INTEGER DEFAULT 0,
                default_severity TEXT DEFAULT 'normal',
                sla_response_minutes_critical INTEGER DEFAULT 30,
                sla_response_minutes_high INTEGER DEFAULT 120,
                sla_response_minutes_normal INTEGER DEFAULT 480,
                sla_response_minutes_low INTEGER DEFAULT 1440,
                sla_resolution_minutes_critical INTEGER DEFAULT 240,
                sla_resolution_minutes_high INTEGER DEFAULT 720,
                sla_resolution_minutes_normal INTEGER DEFAULT 2880,
                sla_resolution_minutes_low INTEGER DEFAULT 10080,
                
                /* Premium customization */
                custom_embed_color TEXT DEFAULT '#5865F2',
                custom_open_emoji TEXT DEFAULT '🎫',
                custom_close_emoji TEXT DEFAULT '🔒',
                custom_labels TEXT DEFAULT '[]',
                auto_tags TEXT DEFAULT '[]',
                require_reason INTEGER DEFAULT 0,
                require_severity INTEGER DEFAULT 0,
                allow_user_close INTEGER DEFAULT 1,
                dm_on_update INTEGER DEFAULT 1,
                dm_on_close INTEGER DEFAULT 1,
                thread_mode INTEGER DEFAULT 0,
                
                /* Styling (premium) */
                panel_title TEXT DEFAULT 'Support Tickets',
                panel_description TEXT,
                panel_thumbnail_url TEXT,
                panel_footer TEXT,
                
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        // 2. Add severity/SLA columns to tickets table
        const addCol = async (table, col, type) => {
            try { await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); }
            catch (e) { if (!e.message.includes('duplicate column')) throw e; }
        };

        await addCol('tickets', 'severity', "TEXT DEFAULT 'normal'");
        await addCol('tickets', 'response_deadline', 'TEXT');
        await addCol('tickets', 'resolution_deadline', 'TEXT');
        await addCol('tickets', 'first_response_at', 'TEXT');
        await addCol('tickets', 'satisfaction_rating', 'INTEGER');
        await addCol('tickets', 'satisfaction_comment', 'TEXT');
        await addCol('tickets', 'tags', "TEXT DEFAULT '[]'");
        await addCol('tickets', 'sla_breached', 'INTEGER DEFAULT 0');

        // Same for active_tickets
        await addCol('active_tickets', 'severity', "TEXT DEFAULT 'normal'");
        await addCol('active_tickets', 'response_deadline', 'TEXT');
        await addCol('active_tickets', 'resolution_deadline', 'TEXT');
        await addCol('active_tickets', 'first_response_at', 'TEXT');
        await addCol('active_tickets', 'tags', "TEXT DEFAULT '[]'");

        // 3. Create ticket_tags table
        await db.runAsync(`
            CREATE TABLE IF NOT EXISTS ticket_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#808080',
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(guild_id, name)
            )
        `);

        console.log('[Migration 010] Ticket system enhancement complete');
    },

    async down(db) {
        // ticket_settings is safe to drop since we created it
        await db.runAsync('DROP TABLE IF EXISTS ticket_tags');
        // Can't drop columns in SQLite easily, leave them
    }
};
