const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const game = require('../../features/games/hangman');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hangman')
        .setDescription('Guess the word one letter at a time')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Moves are handled in features/games/hangman.js
    callback: (client, interaction) => game.start(interaction),
};
