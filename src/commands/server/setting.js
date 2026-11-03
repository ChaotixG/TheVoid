const { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { openPanel } = require('../../features/settings/handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure the bot for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Every click on the panel is handled in features/settings/handler.js
    callback: (client, interaction) => openPanel(interaction),
};
