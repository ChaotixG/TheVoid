const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { openShop } = require('../../features/economy/shop');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Spend your coins on server roles and /rank card themes')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Tabs, picks and purchases are handled in features/economy/shop.js
    callback: (client, interaction) => openShop(interaction),
};
