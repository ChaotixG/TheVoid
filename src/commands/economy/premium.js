const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isPremium, premiumEnabled, premiumConfig } = require('../../services/premium');
const { PREMIUM } = require('../../config/economy');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('See premium perks and whether you have them')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        if (!premiumEnabled()) {
            return interaction.reply({ content: 'Premium isn\'t available yet.', flags: MessageFlags.Ephemeral });
        }
        const premium = await isPremium(client, interaction.user.id);
        const { url } = premiumConfig();

        await interaction.reply({
            content: [
                `## ⭐ Premium${premium ? ' · you have it, thank you!' : ''}`,
                `- ×${PREMIUM.dailyMultiplier} **/daily** and **/weekly** rewards`,
                `- ×${PREMIUM.coinMultiplier} coins from chatting and voice`,
                `- +${Math.round((PREMIUM.xpMultiplier - 1) * 100)}% XP`,
                '-# Premium works in every server I\'m in.',
                !premium && url ? `**Get premium:** ${url}` : null,
            ].filter(Boolean).join('\n'),
            flags: MessageFlags.Ephemeral,
        });
    },
};
