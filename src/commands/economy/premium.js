const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { premiumUntil, isForever } = require('../../services/premium');
const { PREMIUM, CUSTOM_CARD_COLORS_ENABLED } = require('../../config/economy');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('See premium perks and whether you have them')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        const until = await premiumUntil(interaction.user.id);
        const status = !until ? ''
            : isForever(until) ? ' · yours for good, thank you!'
                : ` · yours until <t:${Math.floor(until / 1000)}:D> (<t:${Math.floor(until / 1000)}:R>)`;

        await interaction.reply({
            content: [
                `## ⭐ Premium${status}`,
                `- ×${PREMIUM.dailyMultiplier} **/daily** and **/weekly** rewards`,
                `- ×${PREMIUM.coinMultiplier} coins from chatting and voice`,
                `- +${Math.round((PREMIUM.xpMultiplier - 1) * 100)}% XP`,
                CUSTOM_CARD_COLORS_ENABLED ? '- The custom **/rank** card theme: your own colors, gradients and background picture (in **/shop**)' : null,
                `-# Premium works in every server I'm in.${until ? '' : ' It can\'t be bought yet, so stay tuned!'}`,
            ].filter(Boolean).join('\n'),
            flags: MessageFlags.Ephemeral,
        });
    },
};
