const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { claimWeekly } = require('../../features/economy/rewards');
const { coins } = require('../../utils/coins');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weekly')
        .setDescription('Claim your weekly coins (once every 7 days)')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        await interaction.deferReply();
        const result = await claimWeekly(client, interaction.user.id, interaction.guildId);

        if (!result.claimed) {
            await interaction.deleteReply().catch(() => {});
            return interaction.followUp({
                content: `⏳ You already claimed this week's reward. Come back <t:${Math.ceil(result.nextAt / 1000)}:R>.`,
                flags: MessageFlags.Ephemeral,
            });
        }
        await interaction.editReply(`💰 You claimed ${coins(result.amount)} coins!${result.premium ? ' (premium ×2)' : ''} You now have ${coins(result.wallet.balance)}.`);
    },
};
