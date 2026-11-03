const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const game = require('../../features/games/connect4');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setDescription('Play Connect Four against someone or against me')
        .addUserOption(o => o.setName('opponent').setDescription('Who to challenge (leave empty to play against me)'))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Moves are handled in features/games/connect4.js
    callback: (client, interaction) => game.start(interaction),
};
