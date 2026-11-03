const { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { hierarchyProblem, notifyUser, logModAction } = require('../../features/moderation/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server (they can rejoin with an invite)')
        .addUserOption(o => o.setName('user').setDescription('Who to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Shown in the audit log and the mod log').setMaxLength(400))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    botPermissions: [PermissionFlagsBits.KickMembers],

    callback: async (client, interaction) => {
        const member = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') ?? 'No reason given';
        if (!member) return interaction.reply({ content: 'They\'re not in this server.', flags: MessageFlags.Ephemeral });

        const problem = hierarchyProblem(interaction, member);
        if (problem) return interaction.reply({ content: problem, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        if (!member.kickable) return interaction.reply({ content: 'I can\'t kick them: their highest role is above mine.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // the mod log is the shared record
        await notifyUser(member.user, `You were kicked from **${interaction.guild.name}**. Reason: ${reason}`);
        await member.kick(`${reason} (by ${interaction.user.tag})`);

        await logModAction(interaction.guild, { action: 'kick', target: member.user, moderator: interaction.user, reason });
        await interaction.editReply({ content: `👢 Kicked <@${member.id}>. Reason: ${reason}`, allowedMentions: { parse: [] } });
    },
};
