/**
 * Ticket Routes — Enhanced with severity, SLA, premium gating, tags.
 */

const express = require('express');
const router = express.Router();

const SEVERITY_LEVELS = ['critical', 'high', 'normal', 'low'];
const PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'];

/** Check if a guild has an active premium subscription */
async function isPremium(db, guildId) {
    try {
        const row = await db.getAsync(
            `SELECT * FROM guild_subscriptions WHERE guild_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > datetime('now'))`,
            [guildId]
        );
        return !!row;
    } catch {
        return false;
    }
}

/** Calculate SLA deadline from settings + severity */
function calcDeadline(settings, severity, field) {
    const key = `sla_${field}_minutes_${severity}`;
    const minutes = settings?.[key];
    if (!minutes) return null;
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

module.exports = function(dashboard) {
    const { bot, db, authMiddleware, requireGuildAccess, checkPermission, validateCSRF } = dashboard;
    const t = bot.i18n?.t?.bind(bot.i18n) || ((key) => key);

    /**
     * GET /api/guilds/:guildId/tickets
     * Enhanced: filter by severity, tags, assignee, search
     */
    router.get('/guilds/:guildId/tickets', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { status, severity, assignee, tag, search, page = 1, limit = 50, sort = 'created_at', order = 'DESC' } = req.query;

            let query = 'SELECT * FROM tickets WHERE guild_id = ?';
            const params = [guildId];

            if (status && status !== 'all') {
                query += ' AND status = ?';
                params.push(status);
            }
            if (severity && SEVERITY_LEVELS.includes(severity)) {
                query += ' AND severity = ?';
                params.push(severity);
            }
            if (assignee) {
                query += ' AND assignee_id = ?';
                params.push(assignee);
            }
            if (tag) {
                query += " AND tags LIKE ?";
                params.push(`%"${tag}"%`);
            }
            if (search) {
                query += ' AND (subject LIKE ? OR notes LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            // Validate sort column
            const allowedSorts = ['created_at', 'updated_at', 'priority', 'severity', 'status'];
            const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
            const sortOrd = order === 'ASC' ? 'ASC' : 'DESC';
            query += ` ORDER BY ${sortCol} ${sortOrd} LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

            const tickets = await db.allAsync(query, params);

            const countResult = await db.getAsync(
                'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?',
                [guildId]
            );

            // Add SLA status to each ticket
            const now = new Date();
            const enriched = (tickets || []).map(t => ({
                ...t,
                tags: t.tags ? JSON.parse(t.tags) : [],
                notes: t.notes ? JSON.parse(t.notes) : [],
                sla_status: t.resolution_deadline
                    ? (new Date(t.resolution_deadline) < now ? 'breached' : 'on_track')
                    : 'none',
            }));

            res.json({
                tickets: enriched,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult?.count || 0,
                    pages: Math.ceil((countResult?.count || 0) / parseInt(limit))
                }
            });
        } catch (error) {
            bot.logger?.error('Error fetching tickets:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/tickets/:ticketId
     * Get a specific ticket
     */
    router.get('/guilds/:guildId/tickets/:ticketId', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Get ticket messages/history
            const messages = await db.allAsync(
                'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC',
                [ticketId]
            );

            res.json({ ticket, messages });
        } catch (error) {
            bot.logger?.error('Error fetching ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * PATCH /api/guilds/:guildId/tickets/:ticketId
     * Update a ticket (status, assignee, etc.)
     */
    router.patch('/guilds/:guildId/tickets/:ticketId', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { status, assignee, priority, severity, category, notes, tags } = req.body;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            const updates = [];
            const params = [];

            if (status !== undefined) {
                updates.push('status = ?');
                params.push(status);
                // Track first_response_at for SLA
                if (status === 'in_progress' && !ticket.first_response_at) {
                    updates.push('first_response_at = ?');
                    params.push(new Date().toISOString());
                }
                // Track resolved_at
                if (status === 'closed' || status === 'resolved') {
                    updates.push('resolved_at = ?');
                    params.push(new Date().toISOString());
                }
            }
            if (assignee !== undefined) {
                updates.push('assignee_id = ?');
                params.push(assignee);
            }
            if (priority !== undefined) {
                if (!PRIORITY_LEVELS[priority]) return res.status(400).json({ error: 'Invalid priority' });
                updates.push('priority = ?');
                params.push(priority);
            }
            if (severity !== undefined) {
                if (!SEVERITY_LEVELS[severity]) return res.status(400).json({ error: 'Invalid severity' });
                updates.push('severity = ?');
                params.push(severity);
                // Recalculate SLA deadline based on new severity
                const settings = await db.getAsync('SELECT * FROM ticket_settings WHERE guild_id = ?', [guildId]);
                if (settings?.severity_enabled) {
                    const deadline = calcDeadline(settings, severity);
                    if (deadline) {
                        updates.push('sla_deadline = ?');
                        params.push(deadline);
                    }
                }
            }
            if (category !== undefined) {
                updates.push('category = ?');
                params.push(category);
            }
            if (notes !== undefined) {
                updates.push('notes = ?');
                params.push(notes);
            }

            if (updates.length === 0 && !tags) {
                return res.status(400).json({ error: t('dashboard.errors.noChanges') });
            }

            if (updates.length > 0) {
                updates.push('updated_at = ?');
                params.push(new Date().toISOString());
                params.push(ticketId, guildId);

                await db.runAsync(
                    `UPDATE tickets SET ${updates.join(', ')} WHERE id = ? AND guild_id = ?`,
                    params
                );
            }

            // Handle tag updates
            if (Array.isArray(tags)) {
                await db.runAsync('DELETE FROM ticket_tag_map WHERE ticket_id = ?', [ticketId]);
                for (const tagId of tags) {
                    await db.runAsync(
                        'INSERT OR IGNORE INTO ticket_tag_map (ticket_id, tag_id) VALUES (?, ?)',
                        [ticketId, tagId]
                    );
                }
            }

            await dashboard.logAction(guildId, req.user.userId, 'TICKET_UPDATE', {
                ticketId,
                changes: req.body
            });

            res.json({ success: true, message: t('dashboard.tickets.updated') });
        } catch (error) {
            bot.logger?.error('Error updating ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/close
     * Close a ticket
     */
    router.post('/guilds/:guildId/tickets/:ticketId/close', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { reason, generateTranscript = true } = req.body;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            if (ticket.status === 'closed') {
                return res.status(400).json({ error: t('dashboard.tickets.alreadyClosed') });
            }

            // Generate transcript if requested
            let transcriptUrl = null;
            if (generateTranscript) {
                transcriptUrl = await dashboard.generateTicketTranscript(ticketId, guildId);
            }

            // Close the ticket
            await db.runAsync(
                `UPDATE tickets SET 
                    status = 'closed', 
                    closed_at = ?, 
                    closed_by = ?, 
                    close_reason = ?,
                    transcript_url = ?
                WHERE id = ? AND guild_id = ?`,
                [
                    new Date().toISOString(),
                    req.user.userId,
                    reason || null,
                    transcriptUrl,
                    ticketId,
                    guildId
                ]
            );

            // Close the Discord channel if it exists
            if (ticket.channel_id) {
                try {
                    const guild = bot.guilds.cache.get(guildId);
                    const channel = guild?.channels.cache.get(ticket.channel_id);
                    if (channel) {
                        await channel.delete(`Ticket closed by ${req.user.username}`);
                    }
                } catch (err) {
                    bot.logger?.warn('Could not delete ticket channel:', err.message);
                }
            }

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_CLOSE', {
                ticketId,
                reason
            });

            res.json({ 
                success: true, 
                message: t('dashboard.tickets.closed'),
                transcriptUrl
            });
        } catch (error) {
            bot.logger?.error('Error closing ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/reopen
     * Reopen a closed ticket
     */
    router.post('/guilds/:guildId/tickets/:ticketId/reopen', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            if (ticket.status !== 'closed') {
                return res.status(400).json({ error: t('dashboard.tickets.notClosed') });
            }

            await db.runAsync(
                `UPDATE tickets SET 
                    status = 'open', 
                    reopened_at = ?,
                    reopened_by = ?
                WHERE id = ? AND guild_id = ?`,
                [new Date().toISOString(), req.user.userId, ticketId, guildId]
            );

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_REOPEN', { ticketId });

            res.json({ success: true, message: t('dashboard.tickets.reopened') });
        } catch (error) {
            bot.logger?.error('Error reopening ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * DELETE /api/guilds/:guildId/tickets/:ticketId
     * Delete a ticket permanently
     */
    router.delete('/guilds/:guildId/tickets/:ticketId', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;

            // Require admin permission for deletion
            if (!checkPermission(req.guildAccess?.permissions, 'ADMINISTRATOR')) {
                return res.status(403).json({ error: t('dashboard.errors.insufficientPermissions') });
            }

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Delete ticket messages first
            await db.runAsync('DELETE FROM ticket_messages WHERE ticket_id = ?', [ticketId]);

            // Delete the ticket
            await db.runAsync('DELETE FROM tickets WHERE id = ?', [ticketId]);

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_DELETE', { ticketId });

            res.json({ success: true, message: t('dashboard.tickets.deleted') });
        } catch (error) {
            bot.logger?.error('Error deleting ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.deleteFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/tickets/stats
     * Enhanced: severity breakdown, SLA metrics, trending tags
     */
    router.get('/guilds/:guildId/tickets/stats', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { period = '30d' } = req.query;

            const now = new Date();
            let startDate = new Date();
            switch (period) {
                case '7d': startDate.setDate(now.getDate() - 7); break;
                case '30d': startDate.setDate(now.getDate() - 30); break;
                case '90d': startDate.setDate(now.getDate() - 90); break;
                default: startDate.setDate(now.getDate() - 30);
            }

            const stats = await db.getAsync(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
                    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress
                FROM tickets 
                WHERE guild_id = ? AND created_at >= ?
            `, [guildId, startDate.toISOString()]);

            const avgResolution = await db.getAsync(`
                SELECT AVG(
                    (julianday(closed_at) - julianday(created_at)) * 24 * 60
                ) as avg_minutes
                FROM tickets 
                WHERE guild_id = ? AND status = 'closed' AND closed_at IS NOT NULL AND created_at >= ?
            `, [guildId, startDate.toISOString()]);

            const byCategory = await db.allAsync(`
                SELECT category, COUNT(*) as count
                FROM tickets WHERE guild_id = ? AND created_at >= ?
                GROUP BY category ORDER BY count DESC
            `, [guildId, startDate.toISOString()]);

            // Severity breakdown
            const bySeverity = await db.allAsync(`
                SELECT COALESCE(severity, 'normal') as severity, COUNT(*) as count
                FROM tickets WHERE guild_id = ? AND created_at >= ?
                GROUP BY severity ORDER BY 
                    CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
            `, [guildId, startDate.toISOString()]);

            // SLA metrics
            const slaStats = await db.getAsync(`
                SELECT 
                    COUNT(*) as total_with_sla,
                    SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) as breached,
                    AVG(CASE WHEN first_response_at IS NOT NULL 
                        THEN (julianday(first_response_at) - julianday(created_at)) * 24 * 60 
                        ELSE NULL END) as avg_first_response_minutes
                FROM tickets 
                WHERE guild_id = ? AND created_at >= ? AND resolution_deadline IS NOT NULL
            `, [guildId, startDate.toISOString()]);

            // Top assignees
            const topAssignees = await db.allAsync(`
                SELECT assignee_id, COUNT(*) as count,
                    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as resolved
                FROM tickets WHERE guild_id = ? AND assignee_id IS NOT NULL AND created_at >= ?
                GROUP BY assignee_id ORDER BY count DESC LIMIT 10
            `, [guildId, startDate.toISOString()]);

            // Daily trend for charts
            const dailyTrend = await db.allAsync(`
                SELECT date(created_at) as date, COUNT(*) as opened,
                    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed
                FROM tickets WHERE guild_id = ? AND created_at >= ?
                GROUP BY date(created_at) ORDER BY date ASC
            `, [guildId, startDate.toISOString()]);

            res.json({
                ...stats,
                avgResolutionMinutes: avgResolution?.avg_minutes || null,
                byCategory,
                bySeverity,
                sla: {
                    totalWithSla: slaStats?.total_with_sla || 0,
                    breached: slaStats?.breached || 0,
                    complianceRate: slaStats?.total_with_sla > 0
                        ? (((slaStats.total_with_sla - (slaStats.breached || 0)) / slaStats.total_with_sla) * 100).toFixed(1)
                        : 100,
                    avgFirstResponseMinutes: slaStats?.avg_first_response_minutes || null,
                },
                topAssignees,
                dailyTrend,
                period
            });
        } catch (error) {
            bot.logger?.error('Error fetching ticket stats:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/ticket-settings
     * Enhanced: includes severity config, SLA timers, premium features
     */
    router.get('/guilds/:guildId/ticket-settings', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;

            const settings = await db.getAsync(
                'SELECT * FROM ticket_settings WHERE guild_id = ?',
                [guildId]
            );

            const categories = await db.allAsync(
                'SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY sort_order',
                [guildId]
            );

            const tags = await db.allAsync(
                'SELECT * FROM ticket_tags WHERE guild_id = ? ORDER BY name',
                [guildId]
            ).catch(() => []);

            const premium = await isPremium(db, guildId);

            res.json({
                settings: settings || {
                    enabled: false,
                    category_id: null,
                    support_role_id: null,
                    log_channel_id: null,
                    ticket_limit: 3,
                    auto_close_hours: null,
                    transcript_channel_id: null,
                    severity_enabled: false,
                    default_severity: 'normal',
                    sla_response_minutes_critical: 30,
                    sla_response_minutes_high: 120,
                    sla_response_minutes_normal: 480,
                    sla_response_minutes_low: 1440,
                    sla_resolution_minutes_critical: 240,
                    sla_resolution_minutes_high: 720,
                    sla_resolution_minutes_normal: 2880,
                    sla_resolution_minutes_low: 10080,
                    custom_embed_color: '#5865F2',
                    custom_open_emoji: '🎫',
                    custom_close_emoji: '🔒',
                    custom_labels: '[]',
                    auto_tags: '[]',
                    require_reason: false,
                    require_severity: false,
                    allow_user_close: true,
                    dm_on_update: true,
                    dm_on_close: true,
                    thread_mode: false,
                    panel_title: 'Support Tickets',
                    panel_description: null,
                    panel_thumbnail_url: null,
                    panel_footer: null,
                },
                categories,
                tags,
                premium,
                severityLevels: SEVERITY_LEVELS,
                priorityLevels: PRIORITY_LEVELS,
            });
        } catch (error) {
            bot.logger?.error('Error fetching ticket settings:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * PUT /api/guilds/:guildId/ticket-settings
     * Enhanced: all severity + SLA + premium customization fields
     */
    router.put('/guilds/:guildId/ticket-settings', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const premium = await isPremium(db, guildId);
            const b = req.body;

            // Gate premium-only fields
            const severityEnabled = premium ? (b.severity_enabled ? 1 : 0) : 0;
            const customColor = premium ? (b.custom_embed_color || '#5865F2') : '#5865F2';

            await db.runAsync(`
                INSERT INTO ticket_settings (
                    guild_id, enabled, category_id, support_role_id, log_channel_id,
                    ticket_limit, auto_close_hours, transcript_channel_id,
                    welcome_message, close_confirmation,
                    severity_enabled, default_severity,
                    sla_response_minutes_critical, sla_response_minutes_high,
                    sla_response_minutes_normal, sla_response_minutes_low,
                    sla_resolution_minutes_critical, sla_resolution_minutes_high,
                    sla_resolution_minutes_normal, sla_resolution_minutes_low,
                    custom_embed_color, custom_open_emoji, custom_close_emoji,
                    custom_labels, auto_tags,
                    require_reason, require_severity, allow_user_close,
                    dm_on_update, dm_on_close, thread_mode,
                    panel_title, panel_description, panel_thumbnail_url, panel_footer,
                    updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    enabled=excluded.enabled, category_id=excluded.category_id,
                    support_role_id=excluded.support_role_id, log_channel_id=excluded.log_channel_id,
                    ticket_limit=excluded.ticket_limit, auto_close_hours=excluded.auto_close_hours,
                    transcript_channel_id=excluded.transcript_channel_id,
                    welcome_message=excluded.welcome_message, close_confirmation=excluded.close_confirmation,
                    severity_enabled=excluded.severity_enabled, default_severity=excluded.default_severity,
                    sla_response_minutes_critical=excluded.sla_response_minutes_critical,
                    sla_response_minutes_high=excluded.sla_response_minutes_high,
                    sla_response_minutes_normal=excluded.sla_response_minutes_normal,
                    sla_response_minutes_low=excluded.sla_response_minutes_low,
                    sla_resolution_minutes_critical=excluded.sla_resolution_minutes_critical,
                    sla_resolution_minutes_high=excluded.sla_resolution_minutes_high,
                    sla_resolution_minutes_normal=excluded.sla_resolution_minutes_normal,
                    sla_resolution_minutes_low=excluded.sla_resolution_minutes_low,
                    custom_embed_color=excluded.custom_embed_color,
                    custom_open_emoji=excluded.custom_open_emoji,
                    custom_close_emoji=excluded.custom_close_emoji,
                    custom_labels=excluded.custom_labels, auto_tags=excluded.auto_tags,
                    require_reason=excluded.require_reason, require_severity=excluded.require_severity,
                    allow_user_close=excluded.allow_user_close,
                    dm_on_update=excluded.dm_on_update, dm_on_close=excluded.dm_on_close,
                    thread_mode=excluded.thread_mode,
                    panel_title=excluded.panel_title, panel_description=excluded.panel_description,
                    panel_thumbnail_url=excluded.panel_thumbnail_url, panel_footer=excluded.panel_footer,
                    updated_at=excluded.updated_at
            `, [
                guildId,
                b.enabled ? 1 : 0,
                b.category_id || null,
                b.support_role_id || null,
                b.log_channel_id || null,
                b.ticket_limit || 3,
                b.auto_close_hours || null,
                b.transcript_channel_id || null,
                b.welcome_message || null,
                b.close_confirmation ? 1 : 0,
                severityEnabled,
                b.default_severity || 'normal',
                premium ? (b.sla_response_minutes_critical ?? 30) : 30,
                premium ? (b.sla_response_minutes_high ?? 120) : 120,
                premium ? (b.sla_response_minutes_normal ?? 480) : 480,
                premium ? (b.sla_response_minutes_low ?? 1440) : 1440,
                premium ? (b.sla_resolution_minutes_critical ?? 240) : 240,
                premium ? (b.sla_resolution_minutes_high ?? 720) : 720,
                premium ? (b.sla_resolution_minutes_normal ?? 2880) : 2880,
                premium ? (b.sla_resolution_minutes_low ?? 10080) : 10080,
                customColor,
                premium ? (b.custom_open_emoji || '🎫') : '🎫',
                premium ? (b.custom_close_emoji || '🔒') : '🔒',
                JSON.stringify(premium ? (b.custom_labels || []) : []),
                JSON.stringify(premium ? (b.auto_tags || []) : []),
                premium ? (b.require_reason ? 1 : 0) : 0,
                premium ? (b.require_severity ? 1 : 0) : 0,
                b.allow_user_close ? 1 : 0,
                b.dm_on_update ? 1 : 0,
                b.dm_on_close ? 1 : 0,
                premium ? (b.thread_mode ? 1 : 0) : 0,
                premium ? (b.panel_title || 'Support Tickets') : 'Support Tickets',
                premium ? (b.panel_description || null) : null,
                premium ? (b.panel_thumbnail_url || null) : null,
                premium ? (b.panel_footer || null) : null,
                new Date().toISOString()
            ]);

            await dashboard.logAction(guildId, req.user.userId, 'TICKET_SETTINGS_UPDATE', req.body);

            res.json({ success: true, message: t('dashboard.settings.saved'), premium });
        } catch (error) {
            bot.logger?.error('Error updating ticket settings:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/ticket-categories
     * Create a new ticket category
     */
    router.post('/guilds/:guildId/ticket-categories', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { name, description, emoji, support_roles, auto_assign } = req.body;

            if (!name) {
                return res.status(400).json({ error: t('dashboard.errors.nameRequired') });
            }

            // Get next sort order
            const lastCategory = await db.getAsync(
                'SELECT MAX(sort_order) as max_order FROM ticket_categories WHERE guild_id = ?',
                [guildId]
            );

            const result = await db.runAsync(`
                INSERT INTO ticket_categories (
                    guild_id, name, description, emoji, support_roles, auto_assign, sort_order, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                guildId,
                name,
                description || null,
                emoji || '🎫',
                JSON.stringify(support_roles || []),
                auto_assign || null,
                (lastCategory?.max_order || 0) + 1,
                new Date().toISOString()
            ]);

            res.json({ 
                success: true, 
                categoryId: result.lastID,
                message: t('dashboard.tickets.categoryCreated')
            });
        } catch (error) {
            bot.logger?.error('Error creating ticket category:', error);
            res.status(500).json({ error: t('dashboard.errors.createFailed') });
        }
    });

    /**
     * DELETE /api/guilds/:guildId/ticket-categories/:categoryId
     * Delete a ticket category
     */
    router.delete('/guilds/:guildId/ticket-categories/:categoryId', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, categoryId } = req.params;

            await db.runAsync(
                'DELETE FROM ticket_categories WHERE id = ? AND guild_id = ?',
                [categoryId, guildId]
            );

            res.json({ success: true, message: t('dashboard.tickets.categoryDeleted') });
        } catch (error) {
            bot.logger?.error('Error deleting ticket category:', error);
            res.status(500).json({ error: t('dashboard.errors.deleteFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/message
     * Send a DM to the ticket creator
     */
    router.post('/guilds/:guildId/tickets/:ticketId/message', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { message } = req.body;

            if (!message || message.trim().length === 0) {
                return res.status(400).json({ error: 'Message is required' });
            }

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Try to DM the user
            try {
                const user = await bot.users.fetch(ticket.user_id);
                const guild = bot.guilds.cache.get(guildId);
                
                await user.send({
                    embeds: [{
                        title: `📩 Message from ${guild?.name || 'Server'} Support`,
                        description: message,
                        color: 0x5865F2,
                        fields: [
                            { name: 'Ticket', value: `#${ticket.id}`, inline: true },
                            { name: 'Subject', value: ticket.subject || 'N/A', inline: true }
                        ],
                        footer: { text: `Sent by staff member` },
                        timestamp: new Date().toISOString()
                    }]
                });

                // Log the message in ticket_messages
                await db.runAsync(`
                    INSERT INTO ticket_messages (ticket_id, user_id, content, is_staff, created_at)
                    VALUES (?, ?, ?, 1, ?)
                `, [ticketId, req.user.userId, message, new Date().toISOString()]);

                // Log the action
                await dashboard.logAction(guildId, req.user.userId, 'TICKET_DM_SENT', {
                    ticketId,
                    userId: ticket.user_id
                });

                res.json({ success: true, message: 'DM sent successfully' });
            } catch (dmError) {
                bot.logger?.warn('Failed to DM ticket user:', dmError.message);
                res.status(400).json({ error: 'Could not send DM - user may have DMs disabled' });
            }
        } catch (error) {
            bot.logger?.error('Error sending ticket message:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/assign
     * Assign a ticket to a staff member
     */
    router.post('/guilds/:guildId/tickets/:ticketId/assign', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { assigneeId } = req.body;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            await db.runAsync(
                `UPDATE tickets SET assignee_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?`,
                [assigneeId || req.user.userId, new Date().toISOString(), ticketId]
            );

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_ASSIGNED', {
                ticketId,
                assigneeId: assigneeId || req.user.userId
            });

            res.json({ success: true, message: 'Ticket assigned successfully' });
        } catch (error) {
            bot.logger?.error('Error assigning ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/priority
     * Set ticket priority
     */
    router.post('/guilds/:guildId/tickets/:ticketId/priority', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { priority, severity } = req.body;

            const updates = [];
            const params = [];

            if (priority) {
                if (!PRIORITY_LEVELS[priority]) return res.status(400).json({ error: 'Invalid priority level' });
                updates.push('priority = ?');
                params.push(priority);
            }
            if (severity) {
                if (!SEVERITY_LEVELS[severity]) return res.status(400).json({ error: 'Invalid severity level' });
                updates.push('severity = ?');
                params.push(severity);
                // Recalculate SLA deadline
                const settings = await db.getAsync('SELECT * FROM ticket_settings WHERE guild_id = ?', [guildId]);
                if (settings?.severity_enabled) {
                    const deadline = calcDeadline(settings, severity);
                    if (deadline) {
                        updates.push('sla_deadline = ?');
                        params.push(deadline);
                    }
                }
            }

            if (updates.length === 0) return res.status(400).json({ error: 'Provide priority or severity' });

            updates.push('updated_at = ?');
            params.push(new Date().toISOString());
            params.push(ticketId, guildId);

            await db.runAsync(
                `UPDATE tickets SET ${updates.join(', ')} WHERE id = ? AND guild_id = ?`,
                params
            );

            res.json({ success: true, message: 'Priority/severity updated' });
        } catch (error) {
            bot.logger?.error('Error updating priority:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/note
     * Add internal note to ticket
     */
    router.post('/guilds/:guildId/tickets/:ticketId/note', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { note } = req.body;

            if (!note || note.trim().length === 0) {
                return res.status(400).json({ error: 'Note is required' });
            }

            const ticket = await db.getAsync(
                'SELECT notes FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Append note with timestamp
            const existingNotes = ticket.notes ? JSON.parse(ticket.notes) : [];
            existingNotes.push({
                author: req.user.userId,
                authorName: req.user.username,
                content: note,
                timestamp: new Date().toISOString()
            });

            await db.runAsync(
                `UPDATE tickets SET notes = ?, updated_at = ? WHERE id = ? AND guild_id = ?`,
                [JSON.stringify(existingNotes), new Date().toISOString(), ticketId, guildId]
            );

            res.json({ success: true, message: 'Note added' });
        } catch (error) {
            bot.logger?.error('Error adding note:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    // ──────── Tag CRUD ────────

    /**
     * GET /api/guilds/:guildId/ticket-tags
     */
    router.get('/guilds/:guildId/ticket-tags', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const tags = await db.allAsync(
                'SELECT * FROM ticket_tags WHERE guild_id = ? ORDER BY name ASC',
                [req.params.guildId]
            );
            res.json({ tags });
        } catch (error) {
            bot.logger?.error('Error fetching ticket tags:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/ticket-tags
     */
    router.post('/guilds/:guildId/ticket-tags', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { name, color } = req.body;
            if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Tag name is required' });
            if (name.length > 32) return res.status(400).json({ error: 'Tag name max 32 characters' });

            const existing = await db.getAsync(
                'SELECT id FROM ticket_tags WHERE guild_id = ? AND LOWER(name) = LOWER(?)',
                [guildId, name.trim()]
            );
            if (existing) return res.status(409).json({ error: 'Tag already exists' });

            const result = await db.runAsync(
                'INSERT INTO ticket_tags (guild_id, name, color) VALUES (?, ?, ?)',
                [guildId, name.trim(), color || '#5865F2']
            );

            res.json({ success: true, tag: { id: result.lastID, guild_id: guildId, name: name.trim(), color: color || '#5865F2' } });
        } catch (error) {
            bot.logger?.error('Error creating ticket tag:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * DELETE /api/guilds/:guildId/ticket-tags/:tagId
     */
    router.delete('/guilds/:guildId/ticket-tags/:tagId', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, tagId } = req.params;
            await db.runAsync('DELETE FROM ticket_tag_map WHERE tag_id = ?', [tagId]);
            await db.runAsync('DELETE FROM ticket_tags WHERE id = ? AND guild_id = ?', [tagId, guildId]);
            res.json({ success: true, message: 'Tag deleted' });
        } catch (error) {
            bot.logger?.error('Error deleting ticket tag:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    // ──────── Satisfaction Rating ────────

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/rate
     * User can rate a closed ticket 1-5
     */
    router.post('/guilds/:guildId/tickets/:ticketId/rate', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { rating, feedback } = req.body;

            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return res.status(400).json({ error: 'Rating must be 1-5' });
            }

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );
            if (!ticket) return res.status(404).json({ error: t('dashboard.errors.notFound') });
            if (ticket.status !== 'closed' && ticket.status !== 'resolved') {
                return res.status(400).json({ error: 'Can only rate closed tickets' });
            }

            await db.runAsync(
                'UPDATE tickets SET satisfaction_rating = ?, satisfaction_feedback = ?, updated_at = ? WHERE id = ? AND guild_id = ?',
                [rating, feedback || null, new Date().toISOString(), ticketId, guildId]
            );

            res.json({ success: true, message: 'Rating submitted' });
        } catch (error) {
            bot.logger?.error('Error rating ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    return router;
};
