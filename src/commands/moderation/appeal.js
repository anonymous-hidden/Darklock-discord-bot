const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('Ban appeal system commands')
        .addSubcommand(sub =>
            sub.setName('ticket')
                .setDescription('Submit an appeal ticket for this server')
        )
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Setup the appeal system')
                .addChannelOption(opt =>
                    opt.setName('review_channel')
                        .setDescription('Channel where appeals will be reviewed')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('cooldown')
                        .setDescription('Hours between appeal submissions (default: 168 = 1 week)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(720)
                )
                .addBooleanOption(opt =>
                    opt.setName('auto_dm')
                        .setDescription('Automatically DM banned users with appeal info')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('appeal_url')
                        .setDescription('Custom URL for appeals (optional)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable appeal system')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Enable or disable')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View appeals')
                .addStringOption(opt =>
                    opt.setName('status')
                        .setDescription('Filter by status')
                        .addChoices(
                            { name: 'Pending', value: 'pending' },
                            { name: 'Approved', value: 'approved' },
                            { name: 'Denied', value: 'denied' }
                        )
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View a specific appeal')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('Appeal ID')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('approve')
                .setDescription('Approve an appeal')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('Appeal ID')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('notes')
                        .setDescription('Notes for the user')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('deny')
                .setDescription('Deny an appeal')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('Appeal ID')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('notes')
                        .setDescription('Reason for denial')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('config')
                .setDescription('View appeal system configuration')
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: '❌ This command can only be used in a server.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const appeals = interaction.client.appealSystem;

        if (!appeals) {
            return interaction.reply({
                content: '❌ Appeal system is not available.',
                ephemeral: true
            });
        }

        if (subcommand === 'ticket') {
            return this.openAppealTicketModal(interaction, appeals);
        }

        if (!this.hasAppealStaffPermission(interaction)) {
            return interaction.reply({
                content: '❌ You need Ban Members permission to manage the appeal system.',
                ephemeral: true
            });
        }

        switch (subcommand) {
            case 'setup':
                return this.setup(interaction, appeals);
            case 'toggle':
                return this.toggle(interaction, appeals);
            case 'list':
                return this.list(interaction, appeals);
            case 'view':
                return this.view(interaction, appeals);
            case 'approve':
                return this.approve(interaction, appeals);
            case 'deny':
                return this.deny(interaction, appeals);
            case 'config':
                return this.viewConfig(interaction, appeals);
        }
    },

    hasAppealStaffPermission(interaction) {
        return Boolean(
            interaction.member?.permissions?.has(PermissionFlagsBits.BanMembers) ||
            interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
        );
    },

    async openAppealTicketModal(interaction, appeals) {
        const config = await appeals.getConfig(interaction.guild.id);
        if (!config?.enabled) {
            return interaction.reply({
                content: '❌ Appeal system is not enabled in this server. Ask staff to run /appeal setup first.',
                ephemeral: true
            });
        }

        const { allowed, reason } = await appeals.canSubmitAppeal(interaction.guild.id, interaction.user.id);
        if (!allowed) {
            return interaction.reply({ content: `❌ ${reason}`, ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`appeal_modal_${interaction.guild.id}`)
            .setTitle('Ban Appeal Ticket');

        const reasonInput = new TextInputBuilder()
            .setCustomId('appeal_reason')
            .setLabel('Why should this appeal be approved?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Explain the situation and why the ban should be removed...')
            .setRequired(true)
            .setMaxLength(1000);

        const additionalInput = new TextInputBuilder()
            .setCustomId('additional_info')
            .setLabel('Additional information (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Any extra context, references, or evidence...')
            .setRequired(false)
            .setMaxLength(500);

        modal.addComponents(
            new ActionRowBuilder().addComponents(reasonInput),
            new ActionRowBuilder().addComponents(additionalInput)
        );

        return interaction.showModal(modal);
    },

    async setup(interaction, appeals) {
        const reviewChannel = interaction.options.getChannel('review_channel');
        const cooldown = interaction.options.getInteger('cooldown') ?? 168;
        const autoDm = interaction.options.getBoolean('auto_dm') ?? true;
        const appealUrl = interaction.options.getString('appeal_url');

        await appeals.setup(interaction.guild.id, {
            reviewChannelId: reviewChannel.id,
            cooldownHours: cooldown,
            autoDmBanned: autoDm,
            appealUrl
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Appeal System Configured')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Review Channel', value: `${reviewChannel}`, inline: true },
                { name: 'Cooldown', value: `${cooldown} hours`, inline: true },
                { name: 'Auto DM', value: autoDm ? 'Yes' : 'No', inline: true }
            )
            .setDescription(
                [
                    appealUrl ? `Appeal URL: ${appealUrl}` : null,
                    'Users can submit appeals via /appeal ticket, or from the ban DM button if auto-DM is enabled.'
                ].filter(Boolean).join('\n')
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async toggle(interaction, appeals) {
        const enabled = interaction.options.getBoolean('enabled');
        await appeals.setEnabled(interaction.guild.id, enabled);

        await interaction.reply({
            content: `✅ Appeal system has been **${enabled ? 'enabled' : 'disabled'}**.`,
            ephemeral: true
        });
    },

    async list(interaction, appeals) {
        const status = interaction.options.getString('status');
        const appealList = await appeals.getGuildAppeals(interaction.guild.id, status, 15);

        if (appealList.length === 0) {
            return interaction.reply({
                content: '📋 No appeals found.',
                ephemeral: true
            });
        }

        const statusEmoji = {
            'pending': '⏳',
            'approved': '✅',
            'denied': '❌'
        };

        const embed = new EmbedBuilder()
            .setTitle('📋 Ban Appeals')
            .setColor(0x5865F2)
            .setTimestamp();

        let description = '';
        for (const appeal of appealList) {
            const emoji = statusEmoji[appeal.status] || '❓';
            const date = new Date(appeal.created_at);
            description += `${emoji} **#${appeal.id}** - <@${appeal.user_id}>\n`;
            description += `   ${appeal.status} | <t:${Math.floor(date.getTime() / 1000)}:R>\n`;
        }

        embed.setDescription(description);
        embed.setFooter({ text: `Showing ${appealList.length} appeals` });

        await interaction.reply({ embeds: [embed] });
    },

    async view(interaction, appeals) {
        const appealId = interaction.options.getInteger('id');
        const appeal = await appeals.getAppeal(appealId);

        if (!appeal) {
            return interaction.reply({
                content: '❌ Appeal not found.',
                ephemeral: true
            });
        }

        if (appeal.guild_id !== interaction.guild.id) {
            return interaction.reply({
                content: '❌ Appeal not found in this server.',
                ephemeral: true
            });
        }

        const user = await interaction.client.users.fetch(appeal.user_id).catch(() => null);

        const statusEmoji = {
            'pending': '⏳',
            'approved': '✅',
            'denied': '❌'
        };

        const embed = new EmbedBuilder()
            .setTitle(`${statusEmoji[appeal.status]} Appeal #${appeal.id}`)
            .setColor(appeal.status === 'approved' ? 0x00FF00 : appeal.status === 'denied' ? 0xFF0000 : 0xFFA500)
            .setThumbnail(user?.displayAvatarURL({ dynamic: true }) || null)
            .addFields(
                { name: 'User', value: user ? `${user.username}\n${user.id}` : appeal.user_id, inline: true },
                { name: 'Status', value: appeal.status, inline: true },
                { name: 'Submitted', value: `<t:${Math.floor(new Date(appeal.created_at).getTime() / 1000)}:R>`, inline: true },
                { name: 'Ban Reason', value: appeal.ban_reason || 'Not specified', inline: false },
                { name: 'Appeal Reason', value: appeal.appeal_reason.slice(0, 1000), inline: false }
            )
            .setTimestamp();

        if (appeal.additional_info) {
            embed.addFields({ name: 'Additional Info', value: appeal.additional_info.slice(0, 500), inline: false });
        }

        if (appeal.reviewer_id) {
            embed.addFields(
                { name: 'Reviewed By', value: `<@${appeal.reviewer_id}>`, inline: true },
                { name: 'Reviewed At', value: `<t:${Math.floor(new Date(appeal.reviewed_at).getTime() / 1000)}:R>`, inline: true }
            );
        }

        if (appeal.reviewer_notes) {
            embed.addFields({ name: 'Reviewer Notes', value: appeal.reviewer_notes.slice(0, 500), inline: false });
        }

        await interaction.reply({ embeds: [embed] });
    },

    async approve(interaction, appeals) {
        const appealId = interaction.options.getInteger('id');
        const notes = interaction.options.getString('notes');

        const appeal = await appeals.getAppeal(appealId);
        if (!appeal || appeal.guild_id !== interaction.guild.id) {
            return interaction.reply({
                content: '❌ Appeal not found.',
                ephemeral: true
            });
        }

        const result = await appeals.approveAppeal(appealId, interaction.user.id, notes);

        if (result.success) {
            await interaction.reply({
                content: `✅ Appeal #${appealId} has been **approved**. User has been unbanned and notified.`,
            });
        } else {
            await interaction.reply({
                content: `❌ Failed to approve appeal: ${result.error}`,
                ephemeral: true
            });
        }
    },

    async deny(interaction, appeals) {
        const appealId = interaction.options.getInteger('id');
        const notes = interaction.options.getString('notes');

        const appeal = await appeals.getAppeal(appealId);
        if (!appeal || appeal.guild_id !== interaction.guild.id) {
            return interaction.reply({
                content: '❌ Appeal not found.',
                ephemeral: true
            });
        }

        const result = await appeals.denyAppeal(appealId, interaction.user.id, notes);

        if (result.success) {
            await interaction.reply({
                content: `✅ Appeal #${appealId} has been **denied**. User has been notified.`,
            });
        } else {
            await interaction.reply({
                content: `❌ Failed to deny appeal: ${result.error}`,
                ephemeral: true
            });
        }
    },

    async viewConfig(interaction, appeals) {
        const config = await appeals.getConfig(interaction.guild.id);

        if (!config) {
            return interaction.reply({
                content: '❌ Appeal system is not configured. Use `/appeal setup` first.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Appeal System Configuration')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Review Channel', value: config.review_channel_id ? `<#${config.review_channel_id}>` : 'Not set', inline: true },
                { name: 'Cooldown', value: `${config.cooldown_hours} hours`, inline: true },
                { name: 'Auto DM Banned', value: config.auto_dm_banned ? 'Yes' : 'No', inline: true },
                { name: 'Appeal URL', value: config.appeal_url || 'Not set', inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
