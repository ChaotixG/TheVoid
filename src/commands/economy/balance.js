const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const Member = require('../../models/Member');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('See how many coins you (or someone else) have')
        .addUserOption(o => o.setName('user').setDescription('Whose balance to show'))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const member = await Member.findOne({ guildId: interaction.guildId, userId: user.id }, { balance: 1 }).lean();
        const balance = (member?.balance ?? 0).toLocaleString();
        const who = user.id === interaction.user.id ? 'You have' : `<@${user.id}> has`;
        await interaction.reply({ content: `💰 ${who} **${balance}** coins.`, allowedMentions: { parse: [] } });
    },
};
