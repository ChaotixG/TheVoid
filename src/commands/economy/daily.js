const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { claimDaily } = require('../../features/economy/rewards');
const { DAILY } = require('../../config/economy');
const { coins } = require('../../utils/coins');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily coins (once every 24 hours; keep a streak for a bonus)')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        await interaction.deferReply(); // the database work below may take a moment
        const result = await claimDaily(client, interaction.user.id, interaction.guildId);

        if (!result.claimed) {
            // Keep "come back later" private: drop the public placeholder and answer privately
            await interaction.deleteReply().catch(() => {});
            return interaction.followUp({
                content: `⏳ You already claimed today's reward. Come back <t:${Math.ceil(result.nextAt / 1000)}:R>.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const streak = result.wallet.dailyStreak;
        const nextBonus = Math.min(streak * DAILY.streakBonus, DAILY.maxStreakBonus);
        await interaction.editReply([
            `💰 You claimed ${coins(result.amount)} coins!${result.premium ? ' (premium ×2)' : ''} You now have ${coins(result.wallet.balance)}.`,
            `🔥 Streak: **${streak} day${streak === 1 ? '' : 's'}** · tomorrow's bonus: +${nextBonus}. Claim within 48 hours to keep it.`,
        ].join('\n'));
    },
};
