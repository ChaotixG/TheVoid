const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const menu = require('../../features/games/menu');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('games')
        .setDescription('Play a game: solo, against someone, or with a group')
        .addStringOption(o => o.setName('game').setDescription('Go straight to a game').addChoices(...menu.CATALOG.map(g => ({ name: g.name, value: g.id }))))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // One menu for every game (features/games/menu.js); the menu message becomes the game
    callback: (client, interaction) => menu.openMenu(interaction),
};
