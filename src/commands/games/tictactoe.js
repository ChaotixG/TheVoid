const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const game = require('../../features/games/tictactoe');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tictactoe')
        .setDescription('Play Tic-tac-toe against someone or against me')
        .addUserOption(o => o.setName('opponent').setDescription('Who to challenge (leave empty to play against me)'))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Moves are handled in features/games/tictactoe.js
    callback: (client, interaction) => game.start(interaction),
};
