const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { transfer } = require('../../services/wallet');
const { PAY } = require('../../config/economy');
const { coins } = require('../../utils/coins');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription(`Send coins to someone (${PAY.taxPercent}% tax)`)
        .addUserOption(o => o.setName('user').setDescription('Who to pay').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('How many coins to send').setRequired(true).setMinValue(PAY.min).setMaxValue(PAY.max))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        const target = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);
        if (target.id === interaction.user.id) return interaction.reply({ content: 'You can\'t pay yourself.', flags: MessageFlags.Ephemeral });
        if (target.bot) return interaction.reply({ content: 'Bots don\'t have wallets.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply();
        const result = await transfer(interaction.user.id, target.id, amount, interaction.guildId);
        if (!result) {
            await interaction.deleteReply().catch(() => {});
            return interaction.followUp({ content: `You don't have ${coins(amount)} coins.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.editReply({
            content: `💸 <@${interaction.user.id}> sent ${coins(result.received)} coins to <@${target.id}> (tax: ${result.tax.toLocaleString()}).`,
            allowedMentions: { users: [target.id] },
        });
    },
};
