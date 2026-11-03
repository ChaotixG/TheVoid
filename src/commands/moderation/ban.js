const { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { hierarchyProblem, notifyUser, logModAction } = require('../../features/moderation/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .addUserOption(o => o.setName('user').setDescription('Who to ban (works for people who already left too)').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Shown in the audit log and the mod log').setMaxLength(400))
        .addIntegerOption(o => o
            .setName('delete-messages')
            .setDescription('Also delete their recent messages')
            .addChoices(
                { name: 'Don\'t delete any', value: 0 },
                { name: 'Last hour', value: 3600 },
                { name: 'Last 24 hours', value: 86400 },
                { name: 'Last 7 days', value: 604800 },
            ))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    botPermissions: [PermissionFlagsBits.BanMembers],

    callback: async (client, interaction) => {
        const user = interaction.options.getUser('user', true);
        const member = interaction.options.getMember('user'); // null when they're not in the server
        const reason = interaction.options.getString('reason') ?? 'No reason given';
        const deleteMessageSeconds = interaction.options.getInteger('delete-messages') ?? 0;

        if (member) {
            const problem = hierarchyProblem(interaction, member);
            if (problem) return interaction.reply({ content: problem, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            if (!member.bannable) return interaction.reply({ content: 'I can\'t ban them: their highest role is above mine.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // the mod log is the shared record
        if (member) await notifyUser(user, `You were banned from **${interaction.guild.name}**. Reason: ${reason}`);
        await interaction.guild.bans.create(user.id, { reason: `${reason} (by ${interaction.user.tag})`, deleteMessageSeconds });

        await logModAction(interaction.guild, { action: 'ban', target: user, moderator: interaction.user, reason });
        await interaction.editReply({ content: `🔨 Banned <@${user.id}>. Reason: ${reason}`, allowedMentions: { parse: [] } });
    },
};
