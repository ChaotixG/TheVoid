const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const game = require('../../features/games/wordle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordle')
        .setDescription('Guess the 5-letter word in 6 tries')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Moves are handled in features/games/wordle.js
    callback: (client, interaction) => game.start(interaction),
};
