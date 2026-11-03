const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getGuildSettings } = require('../../services/guildSettings');
const { TicketError, getTicketInfo, canManageTicket, deleteTicket } = require('../../features/tickets/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Delete the ticket you\'re in (saves a transcript first if set up)')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        // Finding the ticket message takes an API call, so acknowledge first
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const thread = interaction.channel;
        const ticket = await getTicketInfo(thread);
        if (!ticket) return interaction.editReply('❌ This command only works inside a ticket.');

        const settings = await getGuildSettings(interaction.guildId);
        if (!canManageTicket(interaction, ticket.creatorId, settings.staffRoleIds)) {
            return interaction.editReply('❌ Only the ticket\'s creator or staff can delete it.');
        }

        try {
            // The thread (and this reply with it) is gone once this succeeds
            await deleteTicket(thread, interaction.user, { transcriptChannelId: settings.tickets.transcriptChannelId, creatorId: ticket.creatorId });
        } catch (err) {
            if (err instanceof TicketError) return interaction.editReply(`❌ ${err.message}`);
            throw err;
        }
    },
};
