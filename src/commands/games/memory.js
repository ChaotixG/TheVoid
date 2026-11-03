const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const game = require('../../features/games/memory');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('memory')
        .setDescription('Flip cards to find all the matching pairs')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Moves are handled in features/games/memory.js
    callback: (client, interaction) => game.start(interaction),
};
