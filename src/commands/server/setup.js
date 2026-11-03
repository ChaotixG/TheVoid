const { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { openPanel } = require('../../features/settings/handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Step-by-step server setup: roles, log channels, tickets, voice hubs and leveling')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // The wizard is the settings panel in step-by-step mode (features/settings)
    callback: (client, interaction) => openPanel(interaction, { wizard: true }),
};
