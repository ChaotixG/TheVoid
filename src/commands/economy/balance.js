const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getWallet } = require('../../services/wallet');
const { isPremium } = require('../../services/premium');
const { coins } = require('../../utils/coins');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('See how many coins you (or someone else) have. One wallet for every server.')
        .addUserOption(o => o.setName('user').setDescription('Whose balance to show'))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const self = user.id === interaction.user.id;
        const [wallet, premium] = await Promise.all([getWallet(user.id), isPremium(client, user.id)]);

        await interaction.reply({
            content: [
                `💰 ${self ? 'You have' : `<@${user.id}> has`} ${coins(wallet.balance)} coins${premium ? ' · ⭐ Premium' : ''}`,
                `-# Earned ${wallet.earned.toLocaleString()} · spent ${wallet.spent.toLocaleString()} · daily streak ${wallet.dailyStreak || 0}`,
            ].join('\n'),
            flags: MessageFlags.Ephemeral, // economy replies are private
            allowedMentions: { parse: [] },
        });
    },
};
