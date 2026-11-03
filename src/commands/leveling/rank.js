const { ApplicationIntegrationType, AttachmentBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const Member = require('../../models/Member');
const { cardForMember } = require('../../features/leveling/rankCard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription("Shows your/someone's player Card")
        .addUserOption(o => o.setName('user').setDescription('Whose card to show'))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    // The card itself is drawn in features/leveling/rankCard.js (shared with the /shop preview)
    callback: async (client, interaction) => {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const self = user.id === interaction.user.id;
        if (user.bot) return interaction.reply({ content: 'Bots don\'t earn XP.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply();

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply('They\'re not in this server.');

        const record = await Member.findOne({ guildId: interaction.guildId, userId: user.id }, { totalXp: 1 }).lean();
        if (!record?.totalXp) {
            return interaction.editReply({
                content: self ? "You don't have a profile yet. Chat a little more and try again." : `<@${user.id}> doesn't have a profile yet. Try again when they chat a little more.`,
                allowedMentions: { parse: [] },
            });
        }

        const card = await cardForMember(client, interaction.guild, member);
        await interaction.editReply({ files: [new AttachmentBuilder(card)] });
    },
};
