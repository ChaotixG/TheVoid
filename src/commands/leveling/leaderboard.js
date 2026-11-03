const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { renderLeaderboard } = require('../../features/leveling/leaderboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('See who has the most XP in this server')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Page buttons are handled in features/leveling/leaderboard.js
    callback: async (client, interaction) => {
        await interaction.deferReply();
        await interaction.editReply(await renderLeaderboard(interaction.guild, 0, interaction.user.id, { convert: true }));
    },
};
