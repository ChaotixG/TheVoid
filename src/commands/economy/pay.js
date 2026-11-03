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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // economy replies are private
        const result = await transfer(interaction.user.id, target.id, amount, interaction.guildId);
        if (!result) return interaction.editReply(`You don't have ${coins(amount)} coins.`);

        await interaction.editReply({
            content: `💸 You sent ${coins(result.received)} coins to <@${target.id}> (tax: ${result.tax.toLocaleString()}). You have ${coins(result.balance)} left.`,
            allowedMentions: { parse: [] },
        });
        // The reply is private, so let the receiver know by DM (if they accept DMs)
        await target.send(`💰 <@${interaction.user.id}> sent you ${coins(result.received)} coins in **${interaction.guild?.name ?? 'a server'}**.`).catch(() => {});
    },
};
