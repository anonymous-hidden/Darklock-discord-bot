/**
 * Multi-Server Moderation (Enterprise)
 * ------------------------------------
 * Lets trusted server admins link multiple Discord servers together under one
 * moderation network. When a user is actioned (ban/kick/timeout/warn) in one
 * linked server, the action can be propagated to the other linked servers.
 *
 * SECURITY IS THE #1 PRIORITY. Design principles enforced throughout:
 *   - Double opt-in: a server is only linked after an admin of the TARGET
 *     server explicitly approves via a button. There is no force-linking.
 *   - One network per guild (UNIQUE(guild_id) at the DB layer).
 *   - Manual review is the DEFAULT for cross-server enforcement. Automatic
 *     enforcement only happens when a server explicitly opts in.
 *   - Every cross-server action is validated: bot presence, bot permissions,
 *     role hierarchy, guild-owner protection, and user/role exemptions.
 *   - A network-wide panic switch instantly halts all propagation.
 *   - Every meaningful event is written to an append-only audit trail.
 *   - All IDs are snowflake-validated. Client-supplied data is never trusted.
 */

const crypto = require('crypto');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');

// Discord snowflakes are 17-20 digit numeric strings.
const SNOWFLAKE_RE = /^\d{17,20}$/;

// How long a pending link invitation stays valid.
const LINK_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Rate limiting to prevent a compromised/misbehaving server from mass-banning
// across an entire network. Per-network sliding window.
const PROPAGATION_WINDOW_MS = 60 * 1000;
const PROPAGATION_MAX_PER_WINDOW = 30;

// Valid action types we are willing to synchronise.
const SYNC_ACTION_TYPES = new Set(['ban', 'unban', 'kick', 'timeout', 'warn']);

// Column on msm_network_members that gates each action type.
const SYNC_COLUMN_BY_ACTION = {
    ban: 'sync_bans',
    unban: 'sync_unbans',
    kick: 'sync_kicks',
    timeout: 'sync_timeouts',
    warn: 'sync_warns'
};

// Announcement taxonomy.
const ANNOUNCEMENT_TYPES = new Set([
    'security_alert', 'raid_warning', 'phishing_warning', 'rule_update',
    'network_update', 'maintenance', 'emergency'
]);
const ANNOUNCEMENT_URGENCIES = new Set(['normal', 'urgent']);

// Per-source abuse guard for the shared watchlist.
const WATCHLIST_WINDOW_MS = 60 * 60 * 1000;      // 1 hour
const WATCHLIST_MAX_PER_WINDOW = 25;             // max new entries per source guild / hour

// Per-network announcement abuse guard.
const ANNOUNCEMENT_WINDOW_MS = 60 * 60 * 1000;   // 1 hour
const ANNOUNCEMENT_MAX_PER_WINDOW = 20;

class MultiServerModeration {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database;
        this.logger = bot.logger || console;
        // network_id -> array of recent propagation timestamps (rate limiting)
        this._propagationHistory = new Map();
        // Loop guard: keys of actions THIS bot just applied cross-server, so the
        // resulting gateway events (guildBanAdd, etc.) don't re-propagate.
        // key = `${guildId}:${userId}:${actionType}` -> expiry timestamp.
        this._suppressed = new Map();
        // Abuse guards: `${networkId}:${sourceGuildId}` -> timestamps (watchlist),
        // and `${networkId}` -> timestamps (announcements).
        this._watchlistHistory = new Map();
        this._announcementHistory = new Map();
    }

    // ─────────────────────────────────────────────────────────────────────
    // LOOP GUARD
    // ─────────────────────────────────────────────────────────────────────

    _suppressKey(guildId, userId, actionType) {
        return `${guildId}:${userId}:${actionType}`;
    }

    _suppress(guildId, userId, actionType, ttlMs = 15000) {
        this._suppressed.set(this._suppressKey(guildId, userId, actionType), Date.now() + ttlMs);
    }

    _isSuppressed(guildId, userId, actionType) {
        const key = this._suppressKey(guildId, userId, actionType);
        const exp = this._suppressed.get(key);
        if (!exp) return false;
        if (Date.now() > exp) { this._suppressed.delete(key); return false; }
        this._suppressed.delete(key);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // VALIDATION HELPERS
    // ─────────────────────────────────────────────────────────────────────

    isValidSnowflake(id) {
        return typeof id === 'string' && SNOWFLAKE_RE.test(id);
    }

    assertSnowflake(id, label = 'id') {
        if (!this.isValidSnowflake(id)) {
            throw new Error(`Invalid ${label}`);
        }
        return id;
    }

    // ─────────────────────────────────────────────────────────────────────
    // AUDIT
    // ─────────────────────────────────────────────────────────────────────

    async logAudit({ networkId = null, guildId = null, eventType, actorId = null, actorTag = null, targetGuildId = null, targetUserId = null, details = null }) {
        try {
            await this.db.run(
                `INSERT INTO msm_audit_log
                    (network_id, guild_id, event_type, actor_id, actor_tag, target_guild_id, target_user_id, details)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [networkId, guildId, eventType, actorId, actorTag, targetGuildId, targetUserId,
                 details ? JSON.stringify(details) : null]
            );
        } catch (err) {
            this.logger.error?.('[MSM] Failed to write audit log:', err.message || err);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // NETWORK CRUD
    // ─────────────────────────────────────────────────────────────────────

    async getNetworkByGuild(guildId) {
        if (!this.isValidSnowflake(guildId)) return null;
        const member = await this.db.get(
            `SELECT * FROM msm_network_members WHERE guild_id = ?`,
            [guildId]
        );
        if (!member) return null;
        const network = await this.db.get(`SELECT * FROM msm_networks WHERE id = ?`, [member.network_id]);
        if (!network) return null;
        return { network, membership: member };
    }

    async getNetworkById(networkId) {
        return this.db.get(`SELECT * FROM msm_networks WHERE id = ?`, [networkId]);
    }

    async getNetworkMembers(networkId) {
        return this.db.all(
            `SELECT * FROM msm_network_members WHERE network_id = ? ORDER BY (role = 'main') DESC, joined_at ASC`,
            [networkId]
        );
    }

    /**
     * Create a network with `guildId` as the main (top) server.
     * Enforces the one-network-per-guild rule for the main guild.
     */
    async createNetwork(guildId, ownerUserId, name, actor) {
        this.assertSnowflake(guildId, 'guild id');
        this.assertSnowflake(ownerUserId, 'owner id');

        const existing = await this.getNetworkByGuild(guildId);
        if (existing) {
            throw new Error('This server is already part of a moderation network.');
        }

        const safeName = String(name || '').trim().slice(0, 80) || 'Moderation Network';
        const result = await this.db.run(
            `INSERT INTO msm_networks (name, main_guild_id, owner_user_id, created_by)
             VALUES (?, ?, ?, ?)`,
            [safeName, guildId, ownerUserId, actor?.id || ownerUserId]
        );
        const networkId = result.id;

        await this.db.run(
            `INSERT INTO msm_network_members (network_id, guild_id, role, status, added_by)
             VALUES (?, ?, 'main', 'active', ?)`,
            [networkId, guildId, actor?.id || ownerUserId]
        );

        await this.logAudit({
            networkId, guildId, eventType: 'network_created',
            actorId: actor?.id || ownerUserId, actorTag: actor?.tag || null,
            details: { name: safeName }
        });

        return this.getNetworkById(networkId);
    }

    /**
     * Fully dissolve a network. Only callable by the main guild's authorized admin.
     */
    async deleteNetwork(networkId, actor) {
        const network = await this.getNetworkById(networkId);
        if (!network) return;
        // FK-free schema: delete children explicitly, in a safe order.
        await this.db.run(`DELETE FROM msm_synced_actions WHERE network_id = ?`, [networkId]);
        await this.db.run(`DELETE FROM msm_exempt_users WHERE network_id = ?`, [networkId]);
        await this.db.run(`DELETE FROM msm_exempt_roles WHERE network_id = ?`, [networkId]);
        await this.db.run(`UPDATE msm_link_requests SET status = 'cancelled' WHERE network_id = ? AND status = 'pending'`, [networkId]);
        await this.db.run(`DELETE FROM msm_network_members WHERE network_id = ?`, [networkId]);
        await this.db.run(`DELETE FROM msm_networks WHERE id = ?`, [networkId]);
        await this.logAudit({
            networkId, guildId: network.main_guild_id, eventType: 'network_deleted',
            actorId: actor?.id || null, actorTag: actor?.tag || null
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // LINK REQUEST FLOW (double opt-in)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Ask a target server to join the network. Sends an approval message with a
     * "Join" button into the target guild (system channel or first sendable
     * channel) and DMs the target guild owner. The link is NOT created here —
     * it only becomes active once a target-server admin clicks Approve.
     */
    async requestLink(networkId, targetGuildId, actor) {
        this.assertSnowflake(targetGuildId, 'target guild id');
        const network = await this.getNetworkById(networkId);
        if (!network) throw new Error('Network not found.');

        // The target must not already be in ANY network.
        const targetMembership = await this.db.get(
            `SELECT * FROM msm_network_members WHERE guild_id = ?`, [targetGuildId]
        );
        if (targetMembership) {
            throw new Error('That server is already part of a moderation network.');
        }
        if (targetGuildId === network.main_guild_id) {
            throw new Error('The main server is already in the network.');
        }

        // The bot must actually be in the target guild for a link to be meaningful.
        const targetGuild = this.bot.client?.guilds?.cache?.get(targetGuildId);
        if (!targetGuild) {
            throw new Error('Darklock is not in that server, so it cannot be linked.');
        }

        // Reuse an existing pending request instead of spamming duplicates.
        const pending = await this.db.get(
            `SELECT * FROM msm_link_requests WHERE network_id = ? AND target_guild_id = ? AND status = 'pending'`,
            [networkId, targetGuildId]
        );
        if (pending) {
            throw new Error('There is already a pending invitation for that server.');
        }

        const token = crypto.randomBytes(12).toString('hex');
        const expiresAt = new Date(Date.now() + LINK_REQUEST_TTL_MS).toISOString();

        const result = await this.db.run(
            `INSERT INTO msm_link_requests
                (network_id, source_guild_id, target_guild_id, status, token, requested_by, expires_at)
             VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
            [networkId, network.main_guild_id, targetGuildId, token, actor?.id || null, expiresAt]
        );
        const requestId = result.id;

        const mainGuild = this.bot.client?.guilds?.cache?.get(network.main_guild_id);
        const sent = await this._deliverLinkInvite(targetGuild, network, mainGuild, token);

        if (sent?.messageId) {
            await this.db.run(
                `UPDATE msm_link_requests SET message_id = ?, dm_channel_id = ? WHERE id = ?`,
                [sent.messageId, sent.channelId || null, requestId]
            );
        }

        await this.logAudit({
            networkId, guildId: network.main_guild_id, eventType: 'link_requested',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetGuildId,
            details: { delivered: !!sent, via: sent?.via || 'none' }
        });

        return { requestId, delivered: !!sent, via: sent?.via || 'none' };
    }

    /**
     * Build and deliver the invite message + Join/Deny buttons to the target
     * guild. Tries the system channel first, then any channel the bot can post
     * in, and also attempts to DM the guild owner as a courtesy.
     */
    async _deliverLinkInvite(targetGuild, network, mainGuild, token) {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔗 Moderation Network Invitation')
            .setDescription(
                `**${mainGuild?.name || 'A server'}** has invited **${targetGuild.name}** to join its ` +
                `Darklock moderation network **"${network.name}"**.`
            )
            .addFields(
                {
                    name: 'What does joining do?',
                    value:
                        'When a user is banned (and optionally kicked, timed out, or warned) in a ' +
                        'server on this network, that action can also be applied here. ' +
                        'You stay in full control: you choose which action types sync and whether ' +
                        'they apply automatically or require manual review.'
                },
                {
                    name: 'Safety',
                    value:
                        '• Server owners are never actioned.\n' +
                        '• Manual review is the default.\n' +
                        '• You can add exempt users/roles and leave the network at any time.'
                }
            )
            .setFooter({ text: 'Only a server admin (Manage Server) can approve this invitation.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`msmod_link_approve_${token}`)
                .setLabel('Approve & Join')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId(`msmod_link_deny_${token}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger)
        );

        // 1) Try to post publicly in the target guild so admins can act on it.
        const channel = this._findSendableChannel(targetGuild);
        let posted = null;
        if (channel) {
            try {
                const msg = await channel.send({ embeds: [embed], components: [row] });
                posted = { via: 'channel', messageId: msg.id, channelId: channel.id };
            } catch (err) {
                this.logger.debug?.('[MSM] Could not post invite in channel:', err.message);
            }
        }

        // 2) Best-effort DM to the guild owner (buttons work in DMs too).
        try {
            const owner = await targetGuild.fetchOwner();
            if (owner) {
                await owner.send({ embeds: [embed], components: [row] }).catch(() => {});
                if (!posted) posted = { via: 'owner_dm', messageId: null, channelId: null };
            }
        } catch (err) {
            this.logger.debug?.('[MSM] Could not DM owner:', err.message);
        }

        return posted;
    }

    _findSendableChannel(guild) {
        const me = guild.members.me;
        if (!me) return null;
        // Prefer the configured system channel.
        if (guild.systemChannel && guild.systemChannel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
            return guild.systemChannel;
        }
        // Otherwise the first text channel we can post in.
        return guild.channels.cache.find(ch =>
            ch.isTextBased?.() &&
            !ch.isThread?.() &&
            ch.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages) &&
            ch.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel)
        ) || null;
    }

    /**
     * Handle the Approve/Deny button clicks from a link invitation.
     * SECURITY: only a Manage-Server / Administrator member (or the owner in DM)
     * of the target guild may approve.
     */
    async handleLinkButton(interaction) {
        const customId = interaction.customId || '';
        const approve = customId.startsWith('msmod_link_approve_');
        const deny = customId.startsWith('msmod_link_deny_');
        if (!approve && !deny) return false;

        const token = customId.replace('msmod_link_approve_', '').replace('msmod_link_deny_', '');
        const request = await this.db.get(
            `SELECT * FROM msm_link_requests WHERE token = ?`, [token]
        );

        const reply = (content) => interaction.reply({ content, ephemeral: true }).catch(() => {});

        if (!request) return reply('⚠️ This invitation is no longer valid.');
        if (request.status !== 'pending') {
            return reply(`⚠️ This invitation was already **${request.status}**.`);
        }
        if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
            await this.db.run(`UPDATE msm_link_requests SET status = 'expired' WHERE id = ?`, [request.id]);
            return reply('⚠️ This invitation has expired.');
        }

        const targetGuild = this.bot.client?.guilds?.cache?.get(request.target_guild_id);
        if (!targetGuild) return reply('⚠️ Darklock is no longer in the target server.');

        // Authorization: resolve the clicker as a member of the target guild and
        // require Manage Server / Administrator. This works whether the button
        // was clicked in the guild or in the owner's DM.
        let member = null;
        try {
            member = await targetGuild.members.fetch(interaction.user.id);
        } catch {
            return reply('⛔ Only an admin of the target server can respond to this invitation.');
        }
        const authorized = member.permissions.has(PermissionFlagsBits.Administrator) ||
                           member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                           targetGuild.ownerId === interaction.user.id;
        if (!authorized) {
            return reply('⛔ You need the **Manage Server** permission to approve this.');
        }

        const actor = { id: interaction.user.id, tag: interaction.user.tag };

        if (deny) {
            await this.db.run(
                `UPDATE msm_link_requests SET status = 'denied', responded_by = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [actor.id, request.id]
            );
            await this.logAudit({
                networkId: request.network_id, guildId: request.target_guild_id,
                eventType: 'link_denied', actorId: actor.id, actorTag: actor.tag,
                targetGuildId: request.target_guild_id
            });
            await this._disableInviteButtons(interaction);
            return interaction.reply({ content: '❌ Invitation declined. No link was created.', ephemeral: false }).catch(() => {});
        }

        // Approve — re-check the one-network-per-guild invariant right before commit.
        const already = await this.db.get(
            `SELECT 1 FROM msm_network_members WHERE guild_id = ?`, [request.target_guild_id]
        );
        if (already) {
            await this.db.run(`UPDATE msm_link_requests SET status = 'cancelled' WHERE id = ?`, [request.id]);
            return reply('⚠️ This server is already part of a moderation network.');
        }

        await this.db.run(
            `INSERT INTO msm_network_members
                (network_id, guild_id, role, status, added_by)
             VALUES (?, ?, 'member', 'active', ?)`,
            [request.network_id, request.target_guild_id, actor.id]
        );
        await this.db.run(
            `UPDATE msm_link_requests SET status = 'approved', responded_by = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [actor.id, request.id]
        );
        await this.logAudit({
            networkId: request.network_id, guildId: request.target_guild_id,
            eventType: 'link_approved', actorId: actor.id, actorTag: actor.tag,
            targetGuildId: request.target_guild_id
        });

        await this._disableInviteButtons(interaction);
        return interaction.reply({
            content: '✅ This server has joined the moderation network. Cross-server enforcement ' +
                     'defaults to **manual review** — an admin can adjust sync settings in the Darklock dashboard.',
            ephemeral: false
        }).catch(() => {});
    }

    async _disableInviteButtons(interaction) {
        try {
            if (interaction.message?.editable !== false && interaction.message?.edit) {
                await interaction.message.edit({ components: [] }).catch(() => {});
            }
        } catch { /* non-fatal */ }
    }

    async cancelLinkRequest(requestId, networkId, actor) {
        const req = await this.db.get(
            `SELECT * FROM msm_link_requests WHERE id = ? AND network_id = ? AND status = 'pending'`,
            [requestId, networkId]
        );
        if (!req) return false;
        await this.db.run(`UPDATE msm_link_requests SET status = 'cancelled' WHERE id = ?`, [requestId]);
        await this.logAudit({
            networkId, guildId: req.source_guild_id, eventType: 'link_cancelled',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetGuildId: req.target_guild_id
        });
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // MEMBERSHIP + SYNC SETTINGS
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Remove a member guild from the network. The main guild cannot be removed
     * this way (dissolve the network instead).
     */
    async removeMember(networkId, guildId, actor) {
        const network = await this.getNetworkById(networkId);
        if (!network) throw new Error('Network not found.');
        if (guildId === network.main_guild_id) {
            throw new Error('The main server cannot be removed. Delete the network instead.');
        }
        await this.db.run(
            `DELETE FROM msm_network_members WHERE network_id = ? AND guild_id = ?`,
            [networkId, guildId]
        );
        await this.logAudit({
            networkId, guildId, eventType: 'member_removed',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetGuildId: guildId
        });
    }

    /**
     * Update a member guild's sync settings. Whitelisted keys only.
     */
    async updateSyncSettings(networkId, guildId, settings, actor) {
        const member = await this.db.get(
            `SELECT * FROM msm_network_members WHERE network_id = ? AND guild_id = ?`,
            [networkId, guildId]
        );
        if (!member) throw new Error('That server is not part of this network.');

        const updates = {};
        const boolKeys = [
            'sync_bans', 'sync_unbans', 'sync_kicks', 'sync_timeouts', 'sync_warns',
            'accept_watchlist', 'staff_only_review', 'enabled', 'paused_in', 'paused_out'
        ];
        for (const key of boolKeys) {
            if (key in settings) updates[key] = settings[key] ? 1 : 0;
        }
        if ('enforcement_mode' in settings) {
            // Only two valid modes; anything else falls back to the safe default.
            updates.enforcement_mode = settings.enforcement_mode === 'auto' ? 'auto' : 'manual';
        }
        if ('announce_mode' in settings) {
            const m = String(settings.announce_mode || '').toLowerCase();
            updates.announce_mode = ['off', 'review', 'auto'].includes(m) ? m : 'review';
        }
        if ('announce_min_urgency' in settings) {
            updates.announce_min_urgency = settings.announce_min_urgency === 'urgent' ? 'urgent' : 'normal';
        }
        if ('announce_channel_id' in settings) {
            const ch = String(settings.announce_channel_id || '').trim();
            if (ch === '') updates.announce_channel_id = null;
            else if (this.isValidSnowflake(ch)) updates.announce_channel_id = ch;
            else throw new Error('Invalid announcement channel ID.');
        }
        if ('min_severity' in settings) {
            const sev = Math.min(Math.max(parseInt(settings.min_severity, 10) || 1, 1), 5);
            updates.min_severity = sev;
        }
        if (Object.keys(updates).length === 0) return member;

        const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        await this.db.run(
            `UPDATE msm_network_members SET ${setClause}, updated_at = CURRENT_TIMESTAMP
             WHERE network_id = ? AND guild_id = ?`,
            [...Object.values(updates), networkId, guildId]
        );
        await this.logAudit({
            networkId, guildId, eventType: 'settings_updated',
            actorId: actor?.id || null, actorTag: actor?.tag || null,
            details: updates
        });
        return this.db.get(
            `SELECT * FROM msm_network_members WHERE network_id = ? AND guild_id = ?`,
            [networkId, guildId]
        );
    }

    /**
     * Update network-level metadata / defaults. Main-server admins only (enforced
     * at the API layer). Whitelisted keys, all validated.
     */
    async updateNetworkSettings(networkId, settings, actor) {
        const network = await this.getNetworkById(networkId);
        if (!network) throw new Error('Network not found.');

        const updates = {};
        if ('name' in settings) {
            const name = String(settings.name || '').trim().slice(0, 80);
            if (name) updates.name = name;
        }
        if ('description' in settings) {
            updates.description = String(settings.description || '').trim().slice(0, 500) || null;
        }
        if ('status' in settings) {
            const st = String(settings.status || '').toLowerCase();
            if (!['active', 'paused', 'disabled'].includes(st)) throw new Error('Invalid network status.');
            updates.status = st;
            // Keep the legacy panic flag in sync so propagation halts consistently.
            updates.disabled = st === 'active' ? 0 : 1;
            if (st !== 'active') updates.disabled_reason = `Network status: ${st}`;
            else updates.disabled_reason = null;
        }
        if ('default_action_mode' in settings) {
            const m = String(settings.default_action_mode || '').toLowerCase();
            if (!['log', 'review', 'auto'].includes(m)) throw new Error('Invalid default action mode.');
            updates.default_action_mode = m;
        }
        if (Object.keys(updates).length === 0) return network;

        const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        await this.db.run(
            `UPDATE msm_networks SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...Object.values(updates), networkId]
        );
        await this.logAudit({
            networkId, guildId: network.main_guild_id, eventType: 'network_settings_updated',
            actorId: actor?.id || null, actorTag: actor?.tag || null,
            details: { old: { name: network.name, status: network.status, default_action_mode: network.default_action_mode }, new: updates }
        });
        return this.getNetworkById(networkId);
    }

    /**
     * Per-server panic controls. A joined server can pause its own incoming
     * and/or outgoing sync without affecting the rest of the network. This is
     * distinct from the network-wide panic switch (setPanic).
     */
    async setServerPause(networkId, guildId, { paused_in, paused_out }, actor) {
        const member = await this.db.get(
            `SELECT * FROM msm_network_members WHERE network_id = ? AND guild_id = ?`,
            [networkId, guildId]
        );
        if (!member) throw new Error('That server is not part of this network.');
        const pin = paused_in ? 1 : 0;
        const pout = paused_out ? 1 : 0;
        await this.db.run(
            `UPDATE msm_network_members SET paused_in = ?, paused_out = ?, updated_at = CURRENT_TIMESTAMP
             WHERE network_id = ? AND guild_id = ?`,
            [pin, pout, networkId, guildId]
        );
        await this.logAudit({
            networkId, guildId, eventType: 'server_pause_updated',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetGuildId: guildId,
            details: { paused_in: !!pin, paused_out: !!pout }
        });
        return this.db.get(
            `SELECT * FROM msm_network_members WHERE network_id = ? AND guild_id = ?`,
            [networkId, guildId]
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // EXEMPTIONS
    // ─────────────────────────────────────────────────────────────────────

    async addExemptUser(networkId, guildId, userId, reason, actor) {
        this.assertSnowflake(userId, 'user id');
        const scope = guildId === '*' ? '*' : this.assertSnowflake(guildId, 'guild id');
        await this.db.run(
            `INSERT OR IGNORE INTO msm_exempt_users (network_id, guild_id, user_id, reason, added_by)
             VALUES (?, ?, ?, ?, ?)`,
            [networkId, scope, userId, reason || null, actor?.id || null]
        );
        await this.logAudit({
            networkId, guildId: scope === '*' ? null : scope, eventType: 'exempt_user_added',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetUserId: userId
        });
    }

    async removeExemptUser(networkId, guildId, userId, actor) {
        await this.db.run(
            `DELETE FROM msm_exempt_users WHERE network_id = ? AND guild_id = ? AND user_id = ?`,
            [networkId, guildId, userId]
        );
        await this.logAudit({
            networkId, eventType: 'exempt_user_removed',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetUserId: userId
        });
    }

    async addExemptRole(networkId, guildId, roleId, reason, actor) {
        this.assertSnowflake(guildId, 'guild id');
        this.assertSnowflake(roleId, 'role id');
        await this.db.run(
            `INSERT OR IGNORE INTO msm_exempt_roles (network_id, guild_id, role_id, reason, added_by)
             VALUES (?, ?, ?, ?, ?)`,
            [networkId, guildId, roleId, reason || null, actor?.id || null]
        );
        await this.logAudit({
            networkId, guildId, eventType: 'exempt_role_added',
            actorId: actor?.id || null, actorTag: actor?.tag || null, details: { roleId }
        });
    }

    async removeExemptRole(networkId, guildId, roleId, actor) {
        await this.db.run(
            `DELETE FROM msm_exempt_roles WHERE network_id = ? AND guild_id = ? AND role_id = ?`,
            [networkId, guildId, roleId]
        );
        await this.logAudit({
            networkId, guildId, eventType: 'exempt_role_removed',
            actorId: actor?.id || null, actorTag: actor?.tag || null, details: { roleId }
        });
    }

    async listExemptUsers(networkId) {
        return this.db.all(`SELECT * FROM msm_exempt_users WHERE network_id = ? ORDER BY created_at DESC`, [networkId]);
    }

    async listExemptRoles(networkId) {
        return this.db.all(`SELECT * FROM msm_exempt_roles WHERE network_id = ? ORDER BY created_at DESC`, [networkId]);
    }

    /**
     * Determine whether a user is exempt from enforcement in a specific guild.
     * Checks network-wide + guild-scoped user exemptions and role exemptions.
     */
    async isExempt(networkId, guildId, userId, member = null) {
        const userExempt = await this.db.get(
            `SELECT 1 FROM msm_exempt_users
             WHERE network_id = ? AND user_id = ? AND (guild_id = '*' OR guild_id = ?)`,
            [networkId, userId, guildId]
        );
        if (userExempt) return true;

        if (member) {
            const roleRows = await this.db.all(
                `SELECT role_id FROM msm_exempt_roles WHERE network_id = ? AND guild_id = ?`,
                [networkId, guildId]
            );
            if (roleRows.length && member.roles?.cache) {
                for (const row of roleRows) {
                    if (member.roles.cache.has(row.role_id)) return true;
                }
            }
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────
    // PANIC SWITCH
    // ─────────────────────────────────────────────────────────────────────

    async setPanic(networkId, disabled, reason, actor) {
        await this.db.run(
            `UPDATE msm_networks SET disabled = ?, disabled_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [disabled ? 1 : 0, disabled ? (reason || 'Manually disabled') : null, networkId]
        );
        await this.logAudit({
            networkId, eventType: disabled ? 'panic_enabled' : 'panic_disabled',
            actorId: actor?.id || null, actorTag: actor?.tag || null, details: { reason: reason || null }
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // ACTION PROPAGATION (the core cross-server executor)
    // ─────────────────────────────────────────────────────────────────────

    _rateLimited(networkId) {
        const now = Date.now();
        const hist = (this._propagationHistory.get(networkId) || []).filter(t => now - t < PROPAGATION_WINDOW_MS);
        if (hist.length >= PROPAGATION_MAX_PER_WINDOW) {
            this._propagationHistory.set(networkId, hist);
            return true;
        }
        hist.push(now);
        this._propagationHistory.set(networkId, hist);
        return false;
    }

    /**
     * Entry point called by bot event hooks when a moderation action happens.
     * Fans the action out to every other member guild whose settings opt in.
     *
     * @param {Object} opts
     * @param {string} opts.originGuildId  Guild where the action originally happened.
     * @param {string} opts.actionType     'ban' | 'kick' | 'timeout' | 'warn'
     * @param {string} opts.targetUserId   User being actioned.
     * @param {string} [opts.targetUserTag]
     * @param {string} [opts.moderatorId]  Original moderator ('system' for automated).
     * @param {string} [opts.reason]
     * @param {number} [opts.durationMs]   For timeouts.
     */
    async propagateAction(opts) {
        const { originGuildId, actionType, targetUserId, moderatorId = 'system', reason = null, durationMs = null, targetUserTag = null } = opts || {};
        try {
            if (!SYNC_ACTION_TYPES.has(actionType)) return;
            if (!this.isValidSnowflake(originGuildId) || !this.isValidSnowflake(targetUserId)) return;

            // Loop guard: ignore events caused by our own cross-server enforcement.
            if (this._isSuppressed(originGuildId, targetUserId, actionType)) return;
            // Secondary guard: our synced actions carry a recognizable reason prefix.
            if (typeof reason === 'string' && reason.startsWith('[Network:')) return;

            const link = await this.getNetworkByGuild(originGuildId);
            if (!link) return; // origin not in a network
            const { network } = link;

            // Panic switch / network status halts everything.
            if (network.disabled || (network.status && network.status !== 'active')) {
                this.logger.info?.(`[MSM] Network ${network.id} is not active (panic/paused). Skipping propagation.`);
                return;
            }

            const members = await this.getNetworkMembers(network.id);

            // Origin-side pause: a server can stop exporting its actions.
            const originMember = members.find(m => m.guild_id === originGuildId);
            if (originMember) {
                if (originMember.enabled === 0) return;
                if (originMember.paused_out) {
                    this.logger.info?.(`[MSM] Origin ${originGuildId} has paused outgoing sync. Skipping.`);
                    return;
                }
            }

            if (this._rateLimited(network.id)) {
                this.logger.warn?.(`[MSM] Network ${network.id} hit propagation rate limit. Action queued for review.`);
            }

            const syncColumn = SYNC_COLUMN_BY_ACTION[actionType];
            if (!syncColumn) return;

            for (const m of members) {
                if (m.guild_id === originGuildId) continue;        // don't echo back to origin
                if (m.status !== 'active') continue;
                if (m.enabled === 0) continue;                      // server temporarily disabled
                if (m.paused_in) continue;                          // server paused incoming sync
                if (!m[syncColumn]) continue;                       // this server didn't opt into this action type

                await this._propagateToGuild({ network, member: m, actionType, targetUserId, targetUserTag, moderatorId, reason, durationMs, originGuildId });
            }
        } catch (err) {
            this.logger.error?.('[MSM] propagateAction error:', err.message || err);
        }
    }

    async _propagateToGuild({ network, member, actionType, targetUserId, targetUserTag, moderatorId, reason, durationMs, originGuildId }) {
        const targetGuildId = member.guild_id;

        // Record the intended action first so nothing is silently lost.
        const rec = await this.db.run(
            `INSERT INTO msm_synced_actions
                (network_id, origin_guild_id, target_guild_id, action_type, target_user_id, target_user_tag, moderator_id, reason, status, review_required)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
            [network.id, originGuildId, targetGuildId, actionType, targetUserId, targetUserTag, moderatorId,
             reason || null, member.enforcement_mode === 'manual' ? 1 : 0]
        );
        const actionId = rec.id;

        // Manual review is the safe default: hold the action, don't execute.
        if (member.enforcement_mode !== 'auto') {
            await this.db.run(
                `UPDATE msm_synced_actions SET status = 'awaiting_review' WHERE id = ?`, [actionId]
            );
            await this.logAudit({
                networkId: network.id, guildId: targetGuildId, eventType: 'action_queued',
                actorId: moderatorId, targetGuildId, targetUserId,
                details: { actionType, actionId, reason }
            });
            return;
        }

        // Automatic enforcement: run the full safety gauntlet, then execute.
        const outcome = await this.executeCrossServerAction({
            network, targetGuildId, actionType, targetUserId, reason, durationMs, moderatorId
        });

        await this.db.run(
            `UPDATE msm_synced_actions SET status = ?, failure_reason = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [outcome.status, outcome.reason || null, actionId]
        );
        await this.logAudit({
            networkId: network.id, guildId: targetGuildId,
            eventType: outcome.status === 'applied' ? 'action_synced' : 'action_failed',
            actorId: moderatorId, targetGuildId, targetUserId,
            details: { actionType, actionId, result: outcome.status, reason: outcome.reason }
        });
    }

    /**
     * Execute a single cross-server action with ALL safety checks. Returns
     * { status: 'applied'|'failed'|'skipped', reason }.
     *
     * This function is the security heart of the feature. Every guard here
     * exists to prevent a linked server from abusing the network.
     */
    async executeCrossServerAction({ network, targetGuildId, actionType, targetUserId, reason, durationMs, moderatorId }) {
        // 1) The bot must still be in the target guild.
        const guild = this.bot.client?.guilds?.cache?.get(targetGuildId);
        if (!guild) return { status: 'failed', reason: 'Bot is no longer in the target server.' };

        // 2) Never touch the guild owner.
        if (guild.ownerId === targetUserId) {
            return { status: 'skipped', reason: 'Target is the server owner (protected).' };
        }

        // 3) Exemption checks (user + role). Fetch member if present.
        let targetMember = null;
        try {
            targetMember = await guild.members.fetch(targetUserId);
        } catch {
            targetMember = null; // user may not be in the guild (fine for bans)
        }
        if (await this.isExempt(network.id, targetGuildId, targetUserId, targetMember)) {
            return { status: 'skipped', reason: 'Target is exempt in this server.' };
        }

        const me = guild.members.me;
        if (!me) return { status: 'failed', reason: 'Bot member not resolvable in target server.' };

        // 4) Role hierarchy: the bot must outrank the target. Only relevant when
        //    the target is actually present in the guild.
        if (targetMember) {
            if (targetMember.roles.highest.position >= me.roles.highest.position) {
                return { status: 'skipped', reason: 'Target has an equal or higher role than the bot.' };
            }
            if (!targetMember.manageable) {
                return { status: 'skipped', reason: 'Target is not manageable by the bot.' };
            }
        }

        const auditReason = `[Network: ${network.name}] ${reason || 'Synced moderation action'}`.slice(0, 500);

        try {
            switch (actionType) {
                case 'ban': {
                    if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
                        return { status: 'failed', reason: 'Bot lacks Ban Members permission.' };
                    }
                    // Suppress the resulting guildBanAdd so it doesn't re-propagate.
                    this._suppress(targetGuildId, targetUserId, 'ban');
                    await guild.members.ban(targetUserId, { reason: auditReason });
                    break;
                }
                case 'unban': {
                    if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
                        return { status: 'failed', reason: 'Bot lacks Ban Members permission.' };
                    }
                    // Only attempt if the user is actually banned here.
                    let existing = null;
                    try { existing = await guild.bans.fetch(targetUserId); } catch { existing = null; }
                    if (!existing) return { status: 'skipped', reason: 'User is not banned in this server.' };
                    this._suppress(targetGuildId, targetUserId, 'unban');
                    await guild.members.unban(targetUserId, auditReason);
                    break;
                }
                case 'kick': {
                    if (!targetMember) return { status: 'skipped', reason: 'Target not in server (cannot kick).' };
                    if (!me.permissions.has(PermissionFlagsBits.KickMembers)) {
                        return { status: 'failed', reason: 'Bot lacks Kick Members permission.' };
                    }
                    this._suppress(targetGuildId, targetUserId, 'kick');
                    await targetMember.kick(auditReason);
                    break;
                }
                case 'timeout': {
                    if (!targetMember) return { status: 'skipped', reason: 'Target not in server (cannot timeout).' };
                    if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                        return { status: 'failed', reason: 'Bot lacks Moderate Members permission.' };
                    }
                    const ms = Math.min(Math.max(Number(durationMs) || 10 * 60 * 1000, 60 * 1000), 28 * 24 * 60 * 60 * 1000);
                    this._suppress(targetGuildId, targetUserId, 'timeout');
                    await targetMember.timeout(ms, auditReason);
                    break;
                }
                case 'warn': {
                    // Warnings are internal — record against the target guild.
                    await this.db.run(
                        `INSERT INTO mod_actions (guild_id, action_type, target_user_id, moderator_id, reason)
                         VALUES (?, 'warn', ?, ?, ?)`,
                        [targetGuildId, targetUserId, moderatorId || 'system', auditReason]
                    ).catch(() => {});
                    break;
                }
                default:
                    return { status: 'skipped', reason: 'Unsupported action type.' };
            }
            return { status: 'applied', reason: null };
        } catch (err) {
            return { status: 'failed', reason: (err.message || 'Unknown error').slice(0, 300) };
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // REVIEW QUEUE
    // ─────────────────────────────────────────────────────────────────────

    async getReviewQueue(networkId) {
        return this.db.all(
            `SELECT * FROM msm_synced_actions WHERE network_id = ? AND status = 'awaiting_review' ORDER BY created_at ASC`,
            [networkId]
        );
    }

    /**
     * Approve a queued action — runs it through the same safety executor.
     */
    async approveReviewAction(networkId, actionId, actor) {
        const action = await this.db.get(
            `SELECT * FROM msm_synced_actions WHERE id = ? AND network_id = ? AND status = 'awaiting_review'`,
            [actionId, networkId]
        );
        if (!action) throw new Error('Review item not found.');
        const network = await this.getNetworkById(networkId);
        if (!network) throw new Error('Network not found.');
        if (network.disabled) throw new Error('Network is disabled (panic mode).');

        const outcome = await this.executeCrossServerAction({
            network,
            targetGuildId: action.target_guild_id,
            actionType: action.action_type,
            targetUserId: action.target_user_id,
            reason: action.reason,
            durationMs: null,
            moderatorId: action.moderator_id
        });
        await this.db.run(
            `UPDATE msm_synced_actions SET status = ?, failure_reason = ?, reviewed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [outcome.status, outcome.reason || null, actor?.id || null, actionId]
        );
        await this.logAudit({
            networkId, guildId: action.target_guild_id, eventType: 'action_reviewed',
            actorId: actor?.id || null, actorTag: actor?.tag || null,
            targetGuildId: action.target_guild_id, targetUserId: action.target_user_id,
            details: { decision: 'approved', result: outcome.status, actionId }
        });
        return outcome;
    }

    async denyReviewAction(networkId, actionId, actor) {
        const action = await this.db.get(
            `SELECT * FROM msm_synced_actions WHERE id = ? AND network_id = ? AND status = 'awaiting_review'`,
            [actionId, networkId]
        );
        if (!action) throw new Error('Review item not found.');
        await this.db.run(
            `UPDATE msm_synced_actions SET status = 'denied', reviewed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [actor?.id || null, actionId]
        );
        await this.logAudit({
            networkId, guildId: action.target_guild_id, eventType: 'action_reviewed',
            actorId: actor?.id || null, actorTag: actor?.tag || null,
            targetGuildId: action.target_guild_id, targetUserId: action.target_user_id,
            details: { decision: 'denied', actionId }
        });
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // DASHBOARD STATUS / READ MODELS
    // ─────────────────────────────────────────────────────────────────────

    _guildSummary(guildId) {
        const g = this.bot.client?.guilds?.cache?.get(guildId);
        return {
            id: guildId,
            name: g?.name || 'Unknown Server',
            icon: g?.iconURL?.({ size: 64 }) || null,
            memberCount: g?.memberCount || null,
            present: !!g
        };
    }

    /**
     * Full status object consumed by the dashboard view.
     */
    async getStatusForGuild(guildId) {
        const link = await this.getNetworkByGuild(guildId);
        if (!link) {
            return { hasNetwork: false, isMain: false };
        }
        const { network, membership } = link;
        const members = await this.getNetworkMembers(network.id);
        const isMain = membership.role === 'main';

        const linkedServers = members.map(m => ({
            ...this._guildSummary(m.guild_id),
            role: m.role,
            status: m.status,
            enabled: m.enabled === 0 ? false : true,
            enforcement_mode: m.enforcement_mode,
            sync_bans: !!m.sync_bans,
            sync_unbans: !!m.sync_unbans,
            sync_kicks: !!m.sync_kicks,
            sync_timeouts: !!m.sync_timeouts,
            sync_warns: !!m.sync_warns,
            accept_watchlist: m.accept_watchlist === 0 ? false : true,
            paused_in: !!m.paused_in,
            paused_out: !!m.paused_out,
            announce_mode: m.announce_mode || 'review',
            joined_at: m.joined_at
        }));

        const pendingRequests = isMain ? await this.db.all(
            `SELECT id, target_guild_id, status, created_at, expires_at FROM msm_link_requests
             WHERE network_id = ? AND status = 'pending' ORDER BY created_at DESC`,
            [network.id]
        ) : [];
        const pendingResolved = pendingRequests.map(r => ({ ...r, target: this._guildSummary(r.target_guild_id) }));

        const recentActions = await this.db.all(
            `SELECT * FROM msm_synced_actions WHERE network_id = ? ORDER BY created_at DESC LIMIT 25`,
            [network.id]
        );
        const failedActions = await this.db.all(
            `SELECT * FROM msm_synced_actions WHERE network_id = ? AND status IN ('failed','skipped') ORDER BY created_at DESC LIMIT 25`,
            [network.id]
        );
        const reviewQueue = await this.getReviewQueue(network.id);
        const exemptUsers = await this.listExemptUsers(network.id);
        const exemptRoles = await this.listExemptRoles(network.id);

        // Announcements: main sees everything it published; members see their own
        // delivery state (including anything pending their review).
        const announcements = await this.listAnnouncements(network.id, guildId, isMain);
        const pendingAnnouncements = isMain
            ? []
            : await this.db.all(
                `SELECT d.*, a.title, a.body, a.type, a.urgency, a.created_at AS announced_at
                 FROM msm_announcement_deliveries d
                 JOIN msm_announcements a ON a.id = d.announcement_id
                 WHERE d.network_id = ? AND d.target_guild_id = ? AND d.status = 'pending_review'
                 ORDER BY d.created_at DESC`,
                [network.id, guildId]
            );

        // Watchlist is network-wide (all members can see it, but only add from
        // their own server). Include recent + count.
        const watchlist = await this.listWatchlist(network.id, { limit: 50 });

        // Build a simple hierarchy chart: main at the top, members below.
        const mainMember = members.find(m => m.role === 'main');
        const hierarchy = {
            main: mainMember ? this._guildSummary(mainMember.guild_id) : null,
            children: members.filter(m => m.role !== 'main').map(m => this._guildSummary(m.guild_id))
        };

        return {
            hasNetwork: true,
            isMain,
            network: {
                id: network.id,
                name: network.name,
                description: network.description || null,
                main_guild_id: network.main_guild_id,
                status: network.status || (network.disabled ? 'disabled' : 'active'),
                default_action_mode: network.default_action_mode || 'review',
                disabled: !!network.disabled,
                disabled_reason: network.disabled_reason || null,
                created_at: network.created_at
            },
            membership: {
                role: membership.role,
                enabled: membership.enabled === 0 ? false : true,
                enforcement_mode: membership.enforcement_mode,
                sync_bans: !!membership.sync_bans,
                sync_unbans: !!membership.sync_unbans,
                sync_kicks: !!membership.sync_kicks,
                sync_timeouts: !!membership.sync_timeouts,
                sync_warns: !!membership.sync_warns,
                accept_watchlist: membership.accept_watchlist === 0 ? false : true,
                staff_only_review: !!membership.staff_only_review,
                min_severity: membership.min_severity || 1,
                paused_in: !!membership.paused_in,
                paused_out: !!membership.paused_out,
                announce_mode: membership.announce_mode || 'review',
                announce_min_urgency: membership.announce_min_urgency || 'normal',
                announce_channel_id: membership.announce_channel_id || null
            },
            linkedServers,
            pendingRequests: pendingResolved,
            recentActions,
            failedActions,
            reviewQueue,
            exemptUsers,
            exemptRoles,
            announcements,
            pendingAnnouncements,
            watchlist,
            hierarchy
        };
    }

    async getAuditLog(networkId, limit = 50) {
        const rows = await this.db.all(
            `SELECT * FROM msm_audit_log WHERE network_id = ? ORDER BY created_at DESC LIMIT ?`,
            [networkId, Math.min(Math.max(Number(limit) || 50, 1), 200)]
        );
        return rows.map(r => ({ ...r, details: r.details ? safeParse(r.details) : null }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // ANNOUNCEMENTS
    // ─────────────────────────────────────────────────────────────────────

    _announcementRateLimited(networkId) {
        const now = Date.now();
        const hist = (this._announcementHistory.get(networkId) || []).filter(t => now - t < ANNOUNCEMENT_WINDOW_MS);
        if (hist.length >= ANNOUNCEMENT_MAX_PER_WINDOW) {
            this._announcementHistory.set(networkId, hist);
            return true;
        }
        hist.push(now);
        this._announcementHistory.set(networkId, hist);
        return false;
    }

    /**
     * Create and publish a network announcement. Only the main server can do
     * this (enforced at the API layer). Each member server's announce_mode
     * decides whether it is auto-posted, held for review, or ignored.
     */
    async createAnnouncement(networkId, originGuildId, { type, urgency, title, body }, actor) {
        const network = await this.getNetworkById(networkId);
        if (!network) throw new Error('Network not found.');
        if (originGuildId !== network.main_guild_id) {
            throw new Error('Only the main server can publish announcements.');
        }
        const t = ANNOUNCEMENT_TYPES.has(type) ? type : 'network_update';
        const u = ANNOUNCEMENT_URGENCIES.has(urgency) ? urgency : 'normal';
        const cleanTitle = String(title || '').trim().slice(0, 200);
        const cleanBody = String(body || '').trim().slice(0, 3000);
        if (!cleanTitle) throw new Error('Announcement title is required.');
        if (!cleanBody) throw new Error('Announcement body is required.');
        if (this._announcementRateLimited(networkId)) {
            throw new Error('Announcement rate limit reached. Please wait before publishing more.');
        }

        const rec = await this.db.run(
            `INSERT INTO msm_announcements
                (network_id, origin_guild_id, type, urgency, title, body, created_by, created_by_tag)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [networkId, originGuildId, t, u, cleanTitle, cleanBody, actor?.id || null, actor?.tag || null]
        );
        const announcementId = rec.id;

        await this.logAudit({
            networkId, guildId: originGuildId, eventType: 'announcement_published',
            actorId: actor?.id || null, actorTag: actor?.tag || null,
            details: { announcementId, type: t, urgency: u, title: cleanTitle }
        });

        // Create per-member delivery rows and (for auto members) deliver now.
        const members = await this.getNetworkMembers(networkId);
        for (const m of members) {
            if (m.guild_id === originGuildId) continue;       // don't deliver to the author
            if (m.status !== 'active' || m.enabled === 0) continue;

            const mode = m.announce_mode || 'review';
            if (mode === 'off') {
                await this.db.run(
                    `INSERT OR IGNORE INTO msm_announcement_deliveries
                        (announcement_id, network_id, target_guild_id, status, processed_at)
                     VALUES (?, ?, ?, 'skipped', CURRENT_TIMESTAMP)`,
                    [announcementId, networkId, m.guild_id]
                );
                continue;
            }

            // Respect the member's urgency floor.
            const minUrg = m.announce_min_urgency || 'normal';
            if (minUrg === 'urgent' && u !== 'urgent') {
                await this.db.run(
                    `INSERT OR IGNORE INTO msm_announcement_deliveries
                        (announcement_id, network_id, target_guild_id, status, processed_at, failure_reason)
                     VALUES (?, ?, ?, 'skipped', CURRENT_TIMESTAMP, 'Below server urgency threshold')`,
                    [announcementId, networkId, m.guild_id]
                );
                continue;
            }

            await this.db.run(
                `INSERT OR IGNORE INTO msm_announcement_deliveries
                    (announcement_id, network_id, target_guild_id, status)
                 VALUES (?, ?, ?, 'pending_review')`,
                [announcementId, networkId, m.guild_id]
            );

            if (mode === 'auto') {
                await this._deliverAnnouncementToGuild(announcementId, networkId, m.guild_id, null);
            }
        }

        return { id: announcementId };
    }

    async listAnnouncements(networkId, guildId, isMain, limit = 30) {
        const rows = await this.db.all(
            `SELECT * FROM msm_announcements WHERE network_id = ? ORDER BY created_at DESC LIMIT ?`,
            [networkId, Math.min(Math.max(Number(limit) || 30, 1), 100)]
        );
        // Attach delivery summary (main) or this guild's own delivery (member).
        const out = [];
        for (const a of rows) {
            if (isMain) {
                const deliveries = await this.db.all(
                    `SELECT target_guild_id, status FROM msm_announcement_deliveries WHERE announcement_id = ?`,
                    [a.id]
                );
                out.push({
                    ...a,
                    deliveries: deliveries.map(d => ({ ...this._guildSummary(d.target_guild_id), status: d.status })),
                    postedCount: deliveries.filter(d => d.status === 'posted').length,
                    pendingCount: deliveries.filter(d => d.status === 'pending_review').length,
                    origin: this._guildSummary(a.origin_guild_id)
                });
            } else {
                const d = await this.db.get(
                    `SELECT status, channel_id, message_id FROM msm_announcement_deliveries
                     WHERE announcement_id = ? AND target_guild_id = ?`,
                    [a.id, guildId]
                );
                out.push({ ...a, delivery: d || null, origin: this._guildSummary(a.origin_guild_id) });
            }
        }
        return out;
    }

    async getAnnouncement(networkId, announcementId) {
        return this.db.get(
            `SELECT * FROM msm_announcements WHERE id = ? AND network_id = ?`,
            [announcementId, networkId]
        );
    }

    /**
     * A member server approves an announcement it was reviewing → post it.
     */
    async approveAnnouncementDelivery(networkId, guildId, announcementId, actor) {
        const delivery = await this.db.get(
            `SELECT * FROM msm_announcement_deliveries
             WHERE announcement_id = ? AND network_id = ? AND target_guild_id = ? AND status = 'pending_review'`,
            [announcementId, networkId, guildId]
        );
        if (!delivery) throw new Error('No pending announcement to approve.');
        const outcome = await this._deliverAnnouncementToGuild(announcementId, networkId, guildId, actor?.id || null);
        await this.logAudit({
            networkId, guildId, eventType: 'announcement_reviewed',
            actorId: actor?.id || null, actorTag: actor?.tag || null,
            details: { announcementId, decision: 'approved', result: outcome.status }
        });
        return outcome;
    }

    async denyAnnouncementDelivery(networkId, guildId, announcementId, actor) {
        const res = await this.db.run(
            `UPDATE msm_announcement_deliveries SET status = 'denied', reviewed_by = ?, processed_at = CURRENT_TIMESTAMP
             WHERE announcement_id = ? AND network_id = ? AND target_guild_id = ? AND status = 'pending_review'`,
            [actor?.id || null, announcementId, networkId, guildId]
        );
        await this.logAudit({
            networkId, guildId, eventType: 'announcement_reviewed',
            actorId: actor?.id || null, actorTag: actor?.tag || null,
            details: { announcementId, decision: 'denied' }
        });
        return { changed: res?.changes || 0 };
    }

    /**
     * Post an announcement into a member server's configured channel.
     */
    async _deliverAnnouncementToGuild(announcementId, networkId, targetGuildId, reviewerId) {
        const announcement = await this.getAnnouncement(networkId, announcementId);
        if (!announcement) return { status: 'failed', reason: 'Announcement not found.' };

        const member = await this.db.get(
            `SELECT * FROM msm_network_members WHERE network_id = ? AND guild_id = ?`,
            [networkId, targetGuildId]
        );
        const network = await this.getNetworkById(networkId);

        const fail = async (reason) => {
            await this.db.run(
                `UPDATE msm_announcement_deliveries SET status = 'failed', failure_reason = ?, reviewed_by = ?, processed_at = CURRENT_TIMESTAMP
                 WHERE announcement_id = ? AND target_guild_id = ?`,
                [String(reason).slice(0, 300), reviewerId || null, announcementId, targetGuildId]
            );
            return { status: 'failed', reason };
        };

        const guild = this.bot.client?.guilds?.cache?.get(targetGuildId);
        if (!guild) return fail('Bot is no longer in the target server.');

        const channelId = member?.announce_channel_id;
        if (!channelId) return fail('No announcement channel configured for this server.');

        let channel = null;
        try { channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId); } catch { channel = null; }
        if (!channel || !channel.isTextBased?.()) return fail('Announcement channel not found or not text-based.');

        const me = guild.members.me;
        if (me && channel.permissionsFor && !channel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
            return fail('Bot lacks permission to send messages in the announcement channel.');
        }

        try {
            const colorMap = { emergency: 0xE11D48, raid_warning: 0xE11D48, security_alert: 0xF59E0B, phishing_warning: 0xF59E0B };
            const embed = {
                title: `📢 ${announcement.title}`.slice(0, 256),
                description: announcement.body.slice(0, 4000),
                color: announcement.urgency === 'urgent' ? 0xE11D48 : (colorMap[announcement.type] || 0x6366F1),
                footer: { text: `Network announcement • ${network?.name || 'Network'}` },
                timestamp: new Date().toISOString()
            };
            const sent = await channel.send({ embeds: [embed] });
            await this.db.run(
                `UPDATE msm_announcement_deliveries SET status = 'posted', channel_id = ?, message_id = ?, reviewed_by = ?, processed_at = CURRENT_TIMESTAMP
                 WHERE announcement_id = ? AND target_guild_id = ?`,
                [channel.id, sent.id, reviewerId || null, announcementId, targetGuildId]
            );
            return { status: 'posted', reason: null };
        } catch (err) {
            return fail(err.message || 'Failed to send announcement.');
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SHARED WATCHLIST
    // ─────────────────────────────────────────────────────────────────────

    _watchlistRateLimited(networkId, sourceGuildId) {
        const now = Date.now();
        const key = `${networkId}:${sourceGuildId}`;
        const hist = (this._watchlistHistory.get(key) || []).filter(t => now - t < WATCHLIST_WINDOW_MS);
        if (hist.length >= WATCHLIST_MAX_PER_WINDOW) {
            this._watchlistHistory.set(key, hist);
            return true;
        }
        hist.push(now);
        this._watchlistHistory.set(key, hist);
        return false;
    }

    /**
     * Add a user to the shared watchlist. This is an ALERT / context signal —
     * it is never automatic guilt. action_mode controls how far a member server
     * is willing to go: 'alert' (default), 'auto_flag', or 'auto_action'.
     */
    async addWatchlistEntry(networkId, sourceGuildId, { userId, reason, severity, evidence, actionMode, expiresAt }, actor) {
        const network = await this.getNetworkById(networkId);
        if (!network) throw new Error('Network not found.');
        this.assertSnowflake(userId, 'user ID');
        // Never allow watchlisting the guild owner or the bot itself.
        if (userId === this.bot.client?.user?.id) throw new Error('Cannot watchlist the bot.');

        if (this._watchlistRateLimited(networkId, sourceGuildId)) {
            throw new Error('Watchlist rate limit reached for this server. Please wait before adding more entries.');
        }

        const sev = Math.min(Math.max(parseInt(severity, 10) || 1, 1), 5);
        const mode = ['alert', 'auto_flag', 'auto_action'].includes(actionMode) ? actionMode : 'alert';
        const cleanReason = String(reason || '').trim().slice(0, 500) || null;
        const cleanEvidence = String(evidence || '').trim().slice(0, 1000) || null;
        let expiry = null;
        if (expiresAt) {
            const d = new Date(expiresAt);
            if (!isNaN(d.getTime())) expiry = d.toISOString();
        }

        await this.db.run(
            `INSERT INTO msm_watchlist
                (network_id, user_id, source_guild_id, reason, severity, evidence, action_mode, status, added_by, added_by_tag, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
             ON CONFLICT(network_id, user_id, source_guild_id) DO UPDATE SET
                reason = excluded.reason, severity = excluded.severity, evidence = excluded.evidence,
                action_mode = excluded.action_mode, status = 'active', added_by = excluded.added_by,
                added_by_tag = excluded.added_by_tag, expires_at = excluded.expires_at,
                removed_by = NULL, removed_at = NULL, created_at = CURRENT_TIMESTAMP`,
            [networkId, userId, sourceGuildId, cleanReason, sev, cleanEvidence, mode, actor?.id || null, actor?.tag || null, expiry]
        );
        await this.logAudit({
            networkId, guildId: sourceGuildId, eventType: 'watchlist_added',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetUserId: userId,
            details: { severity: sev, action_mode: mode, reason: cleanReason }
        });
        return { userId, severity: sev, action_mode: mode };
    }

    async removeWatchlistEntry(networkId, sourceGuildId, userId, actor) {
        this.assertSnowflake(userId, 'user ID');
        // Only the server that added an entry (or the main server) can remove it.
        const network = await this.getNetworkById(networkId);
        const isMain = network && sourceGuildId === network.main_guild_id;
        const res = await this.db.run(
            `UPDATE msm_watchlist SET status = 'removed', removed_by = ?, removed_at = CURRENT_TIMESTAMP
             WHERE network_id = ? AND user_id = ? AND status = 'active'
               AND (source_guild_id = ? OR ?)`,
            [actor?.id || null, networkId, userId, sourceGuildId, isMain ? 1 : 0]
        );
        await this.logAudit({
            networkId, guildId: sourceGuildId, eventType: 'watchlist_removed',
            actorId: actor?.id || null, actorTag: actor?.tag || null, targetUserId: userId,
            details: { removed: res?.changes || 0 }
        });
        return { changed: res?.changes || 0 };
    }

    async listWatchlist(networkId, { limit = 50, includeRemoved = false } = {}) {
        const rows = await this.db.all(
            `SELECT * FROM msm_watchlist WHERE network_id = ? ${includeRemoved ? '' : "AND status = 'active'"}
             ORDER BY severity DESC, created_at DESC LIMIT ?`,
            [networkId, Math.min(Math.max(Number(limit) || 50, 1), 200)]
        );
        return rows.map(r => ({ ...r, source: this._guildSummary(r.source_guild_id) }));
    }

    /**
     * Check whether a user is on the active watchlist (used on member join).
     * Honours expiry. Returns the highest-severity active entry, or null.
     */
    async checkWatchlist(networkId, userId) {
        if (!this.isValidSnowflake(userId)) return null;
        const row = await this.db.get(
            `SELECT * FROM msm_watchlist
             WHERE network_id = ? AND user_id = ? AND status = 'active'
               AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
             ORDER BY severity DESC, created_at DESC LIMIT 1`,
            [networkId, userId]
        );
        return row || null;
    }

    /**
     * Called on member join. If the joining user is watchlisted and this server
     * accepts watchlist alerts, post a NON-destructive alert to the server's
     * announcement channel (falls back to a sendable channel). Never auto-punishes.
     */
    async handleMemberJoin(member) {
        try {
            const guildId = member?.guild?.id;
            const userId = member?.id || member?.user?.id;
            if (!guildId || !userId) return;

            const link = await this.getNetworkByGuild(guildId);
            if (!link) return;
            const { network, membership } = link;
            if (network.disabled || (network.status && network.status !== 'active')) return;
            if (membership.status !== 'active' || membership.enabled === 0) return;
            if (membership.accept_watchlist === 0) return;

            const entry = await this.checkWatchlist(network.id, userId);
            if (!entry) return;
            // Don't alert on the same server that flagged the user (avoid noise on origin).
            if (entry.source_guild_id === guildId) return;

            const guild = this.bot.client?.guilds?.cache?.get(guildId);
            if (!guild) return;

            let channel = null;
            if (membership.announce_channel_id) {
                try { channel = guild.channels.cache.get(membership.announce_channel_id) || await guild.channels.fetch(membership.announce_channel_id); } catch { channel = null; }
            }
            if (!channel || !channel.isTextBased?.()) channel = this._findSendableChannel(guild);
            if (!channel) return;

            const me = guild.members.me;
            if (me && channel.permissionsFor && !channel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) return;

            const sourceName = this._guildSummary(entry.source_guild_id).name;
            const embed = {
                title: '⚠️ Watchlisted user joined',
                description: `<@${userId}> (\`${userId}\`) is on the network watchlist.`,
                color: entry.severity >= 4 ? 0xE11D48 : (entry.severity >= 2 ? 0xF59E0B : 0x6366F1),
                fields: [
                    { name: 'Severity', value: String(entry.severity), inline: true },
                    { name: 'Flagged by', value: sourceName || entry.source_guild_id, inline: true },
                    { name: 'Reason', value: (entry.reason || 'No reason provided').slice(0, 1000) }
                ],
                footer: { text: `Network watchlist • ${network.name} • This is an alert only — no action was taken.` },
                timestamp: new Date().toISOString()
            };
            await channel.send({ embeds: [embed] }).catch(() => {});

            await this.logAudit({
                networkId: network.id, guildId, eventType: 'watchlist_alert',
                actorId: 'system', targetUserId: userId,
                details: { severity: entry.severity, source: entry.source_guild_id }
            });
        } catch (err) {
            this.logger.error?.('[MSM] handleMemberJoin error:', err.message || err);
        }
    }
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
}

module.exports = MultiServerModeration;
