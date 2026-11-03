const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { openTicketMenu } = require('../../features/tickets/handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Open a ticket to get help, make a suggestion or report a problem')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // The type menu and the form are handled in features/tickets/handler.js
    callback: (client, interaction) => openTicketMenu(interaction),
};
