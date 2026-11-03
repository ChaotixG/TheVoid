const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const Transaction = require('../../models/Transaction');
const { coins } = require('../../utils/coins');

const LABELS = {
    daily: 'Daily reward',
    weekly: 'Weekly reward',
    pay_in: 'Payment received',
    pay_out: 'Payment sent',
    shop_role: 'Bought a role',
    shop_theme: 'Bought a card theme',
    refund: 'Refund',
    migration: 'Moved from old balance',
    game: 'Game win',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Your last 15 coin transactions')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        const entries = await Transaction.find({ userId: interaction.user.id }).sort({ createdAt: -1 }).limit(15).lean();
        const lines = entries.map(t => {
            const sign = t.amount >= 0 ? '+' : '−';
            const detail = t.note && (t.type.startsWith('shop') || t.type === 'game') ? ` (${t.note})` : '';
            return `<t:${Math.floor(t.createdAt / 1000)}:d> ${sign}${coins(Math.abs(t.amount))} · ${LABELS[t.type] ?? t.type}${detail}`;
        });

        await interaction.reply({
            content: [
                '## 🧾 Your coin history',
                lines.length ? lines.join('\n') : 'Nothing yet. Try **/daily**!',
                '-# Coins from chatting and voice aren\'t listed one by one. Entries are kept for 90 days.',
            ].join('\n'),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
    },
};
