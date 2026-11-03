const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { renderLeaderboard } = require('../../features/leveling/leaderboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('See who has the most XP or coins in this server')
        .addStringOption(o => o
            .setName('type')
            .setDescription('Which leaderboard to show')
            .addChoices({ name: 'XP', value: 'xp' }, { name: 'Coins', value: 'coins' }))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // Tabs and page buttons are handled in features/leveling/leaderboard.js
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const board = interaction.options.getString('type') ?? 'xp';
        await interaction.editReply(await renderLeaderboard(interaction.guild, 0, interaction.user.id, { convert: true }, board));
    },
};
