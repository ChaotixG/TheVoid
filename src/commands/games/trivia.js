const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const game = require('../../features/games/trivia');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Answer trivia questions for coins')
        .addStringOption(o => o.setName('mode').setDescription('Solo, or a race where anyone can answer').addChoices({ name: 'Solo', value: 'solo' }, { name: 'Race (first correct answer wins)', value: 'race' }))
        .addStringOption(o => o.setName('difficulty').setDescription('How hard the questions are').addChoices({ name: 'Any', value: 'any' }, { name: 'Easy', value: 'easy' }, { name: 'Medium', value: 'medium' }, { name: 'Hard', value: 'hard' }))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Moves are handled in features/games/trivia.js
    callback: (client, interaction) => game.start(interaction),
};
