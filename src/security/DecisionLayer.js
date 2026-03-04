'use strict';

/**
 * DecisionLayer — Builds the admin-facing scan report and confirmation UI.
 *
 * Flow:
 *   ScanEngine.scan() → DecisionLayer.present() → ActionExecutor.execute()
 *
 * Rules:
 *  • Does NOT delete anything.
 *  • Stores pending decisions in memory (Map keyed by guild ID).
 *  • The interaction buttons it emits are handled by ActionExecutor via
 *    interactionCreate → customId prefix "scanaction:".
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');

// How long (ms) to keep a pending decision before it expires
const DECISION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const RISK_COLORS = {
    clean:  0x51cf66,   // green
    low:    0xffd43b,   // yellow
    medium: 0xff922b,   // orange
    high:   0xff6b6b,   // red
};

const RISK_LABELS = {
    clean:  '✅ Clean',
    low:    '🟡 Low Risk',
    medium: '🟠 Medium Risk',
    high:   '🔴 High Risk',
};

const TYPE_LABELS = {
    malicious_link:  '🔗 Malicious Links',
    phishing:        '🎣 Phishing Attempts',
    spam:            '📢 Spam Messages',
    toxic_content:   '☠️ Toxic Content',
    suspicious_file: '📎 Suspicious Files',
};

class DecisionLayer {
    constructor() {
        /** @type {Map<string, PendingDecision>} keyed by guild ID */
        this._pending = new Map();

        // Periodically expire old decisions
        setInterval(() => this._expireOld(), 5 * 60 * 1000);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Build the report embed + admin confirmation message and send it.
     *
     * @param {import('discord.js').Guild} guild
     * @param {import('./ScanEngine').ScanReport} report
     * @param {import('discord.js').TextChannel} channel  Where to post the report
     * @returns {Promise<void>}
     */
    async present(guild, report, channel) {
        const { flaggedItems, stats } = report;
        const total = flaggedItems.length;

        // ── Summary embed ────────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setTitle('🔍 Security Scan Complete — Admin Action Required')
            .setColor(RISK_COLORS[stats.riskLevel] ?? 0x888888)
            .setDescription([
                `Scan of **${guild.name}** finished in **${(stats.duration / 1000).toFixed(1)}s**.`,
                '',
                `**${total === 0 ? 'No threats found.' : `${total} item${total > 1 ? 's' : ''} flagged.`}**`,
                '',
                `Overall risk: **${RISK_LABELS[stats.riskLevel] ?? stats.riskLevel}**`,
            ].join('\n'))
            .addFields(
                { name: '📋 Channels Scanned', value: String(stats.scannedChannels), inline: true },
                { name: '💬 Messages Scanned', value: String(stats.scannedMessages), inline: true },
                { name: '⚠️ Total Flagged',    value: String(total), inline: true },
            )
            .setTimestamp()
            .setFooter({ text: 'DarkLock Security • Default mode: Report Only — no automatic deletions' });

        // ── Type breakdown ───────────────────────────────────────────────────
        if (total > 0) {
            const breakdownLines = Object.entries(stats.breakdown)
                .map(([type, count]) => `${TYPE_LABELS[type] ?? type}: **${count}**`);
            embed.addFields({ name: '📊 Breakdown', value: breakdownLines.join('\n'), inline: false });

            // Show up to 5 preview items
            const preview = flaggedItems.slice(0, 5).map(item =>
                `• [${TYPE_LABELS[item.type] ?? item.type}] <#${item.channelId}> by \`${item.username}\` — ${item.reason}`
            );
            if (preview.length) {
                embed.addFields({
                    name: `🔎 Preview (${Math.min(5, total)} of ${total})`,
                    value: preview.join('\n').substring(0, 1024),
                    inline: false,
                });
            }
        }

        // ── Safety notice ────────────────────────────────────────────────────
        embed.addFields({
            name: '🛡️ Safety Defaults',
            value: [
                '**Report Only** mode is active (default).',
                'PNGs and GIFs are **not** flagged unless they match a malicious pattern.',
                'Only Administrators may use the buttons below.',
            ].join('\n'),
            inline: false,
        });

        // ── Action buttons (only shown if there are flagged items) ───────────
        const decisionId = `${guild.id}-${Date.now()}`;
        const components = [];

        if (total > 0) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`scanaction:delete:${decisionId}`)
                    .setLabel('Delete Flagged Content')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId(`scanaction:review:${decisionId}`)
                    .setLabel('Review Items Individually')
                    .setEmoji('🔍')
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId(`scanaction:ignore:${decisionId}`)
                    .setLabel('Ignore Flagged Content')
                    .setEmoji('⚠️')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId(`scanaction:cancel:${decisionId}`)
                    .setLabel('Cancel')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Secondary),
            );
            components.push(row);
        }

        let sentMessage;
        try {
            sentMessage = await channel.send({ embeds: [embed], components });
        } catch (err) {
            // If we can't post there, try to DM the guild owner
            try {
                const owner = await guild.fetchOwner();
                sentMessage = await owner.send({ embeds: [embed], components });
            } catch {
                return; // nothing we can do
            }
        }

        // ── Store pending decision ───────────────────────────────────────────
        if (total > 0) {
            this._pending.set(guild.id, {
                decisionId,
                report,
                messageId: sentMessage?.id,
                channelId: sentMessage?.channel?.id,
                expiresAt: Date.now() + DECISION_TTL_MS,
            });
        }
    }

    /**
     * Retrieve and remove a pending decision for a guild.
     *
     * @param {string} guildId
     * @param {string} decisionId
     * @returns {PendingDecision|null}
     */
    pop(guildId, decisionId) {
        const entry = this._pending.get(guildId);
        if (!entry || entry.decisionId !== decisionId) return null;
        this._pending.delete(guildId);
        return entry;
    }

    /**
     * Check whether the interaction member has Administrator permission.
     * @param {import('discord.js').GuildMember} member
     */
    static isAdmin(member) {
        return member?.permissions?.has(PermissionFlagsBits.Administrator) ?? false;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _expireOld() {
        const now = Date.now();
        for (const [guildId, entry] of this._pending) {
            if (entry.expiresAt < now) {
                this._pending.delete(guildId);
            }
        }
    }
}

/**
 * @typedef {object} PendingDecision
 * @property {string}                              decisionId
 * @property {import('./ScanEngine').ScanReport}   report
 * @property {string}                              messageId
 * @property {string}                              channelId
 * @property {number}                              expiresAt
 */

module.exports = DecisionLayer;
