const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const game = require('../../features/games/minesweeper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('minesweeper')
        .setDescription('Clear the board without hitting a mine')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Moves are handled in features/games/minesweeper.js
    callback: (client, interaction) => game.start(interaction),
};
