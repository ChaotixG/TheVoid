const { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { hierarchyProblem, notifyUser, logModAction } = require('../../features/moderation/moderation');

const DURATIONS = [
    { name: '1 minute', value: 60 },
    { name: '5 minutes', value: 300 },
    { name: '10 minutes', value: 600 },
    { name: '1 hour', value: 3600 },
    { name: '1 day', value: 86400 },
    { name: '1 week', value: 604800 },
    { name: 'Remove timeout', value: 0 },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Stop a member from chatting, speaking and reacting for a while')
        .addUserOption(o => o.setName('user').setDescription('Who to time out').setRequired(true))
        .addIntegerOption(o => o.setName('duration').setDescription('How long').setRequired(true).addChoices(...DURATIONS))
        .addStringOption(o => o.setName('reason').setDescription('Shown in the audit log and the mod log').setMaxLength(400))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    botPermissions: [PermissionFlagsBits.ModerateMembers],

    callback: async (client, interaction) => {
        const member = interaction.options.getMember('user');
        const seconds = interaction.options.getInteger('duration', true);
        const reason = interaction.options.getString('reason') ?? 'No reason given';
        if (!member) return interaction.reply({ content: 'They\'re not in this server.', flags: MessageFlags.Ephemeral });

        const problem = hierarchyProblem(interaction, member);
        if (problem) return interaction.reply({ content: problem, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        // Administrators can't be timed out, and neither can anyone above the bot
        if (!member.moderatable) return interaction.reply({ content: 'I can\'t time them out: they\'re an administrator or their highest role is above mine.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // the mod log is the shared record
        const label = DURATIONS.find(d => d.value === seconds)?.name ?? `${seconds}s`;

        if (seconds === 0) {
            await member.timeout(null, `${reason} (by ${interaction.user.tag})`);
            await logModAction(interaction.guild, { action: 'untimeout', target: member.user, moderator: interaction.user, reason });
            return interaction.editReply({ content: `✅ Removed the timeout for <@${member.id}>.`, allowedMentions: { parse: [] } });
        }

        await member.timeout(seconds * 1000, `${reason} (by ${interaction.user.tag})`);
        await notifyUser(member.user, `You were timed out in **${interaction.guild.name}** for ${label}. Reason: ${reason}`);
        await logModAction(interaction.guild, { action: 'timeout', target: member.user, moderator: interaction.user, reason, details: label });
        await interaction.editReply({ content: `⏳ Timed out <@${member.id}> for ${label}. Reason: ${reason}`, allowedMentions: { parse: [] } });
    },
};
