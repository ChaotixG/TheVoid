const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { isBotOwner } = require('../../services/owner');
const { premiumUntil, isForever, grantPremium, removePremium } = require('../../services/premium');

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const until = (date) => (isForever(date) ? 'for good' : `until <t:${Math.floor(date / 1000)}:F>`);

module.exports = {
    // Registered only in the bot owner's own server (OWNER_GUILD_ID), so nobody else ever sees it.
    // See events/clientReady/01registerCommands.js.
    botOwnerOnly: true,

    data: new SlashCommandBuilder()
        .setName('botowner')
        .setDescription('Bot owner tools')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setContexts(InteractionContextType.Guild)
        .addSubcommandGroup(g => g
            .setName('premium')
            .setDescription('Give or take premium (works in every server)')
            .addSubcommand(s => s
                .setName('give')
                .setDescription('Give someone premium')
                .addUserOption(o => o.setName('user').setDescription('Who gets premium').setRequired(true))
                .addIntegerOption(o => o.setName('days').setDescription('How many days, added to any they still have (leave empty: for good)').setMinValue(1).setMaxValue(3650)))
            .addSubcommand(s => s
                .setName('remove')
                .setDescription('Take someone\'s premium away')
                .addUserOption(o => o.setName('user').setDescription('Whose premium').setRequired(true)))
            .addSubcommand(s => s
                .setName('check')
                .setDescription('See whether someone has premium, and until when')
                .addUserOption(o => o.setName('user').setDescription('Who to check').setRequired(true)))),

    callback: async (client, interaction) => {
        // Checked on every use: only the bot's owner, never a server owner or admin
        if (!await isBotOwner(client, interaction.user.id)) return reply(interaction, 'Only the bot\'s owner can use this.');

        const user = interaction.options.getUser('user');
        if (user.bot) return reply(interaction, 'Bots can\'t have premium.');

        switch (interaction.options.getSubcommand()) {
            case 'give': {
                const end = await grantPremium(user.id, interaction.options.getInteger('days'));
                user.send(`⭐ You've been given **premium** ${until(end)}! It works in every server I'm in. See **/premium** for your perks.`).catch(() => {});
                return reply(interaction, `✅ <@${user.id}> has premium ${until(end)}.`);
            }
            case 'remove':
                return reply(interaction, await removePremium(user.id) ? `✅ Took premium away from <@${user.id}>.` : `<@${user.id}> didn't have premium.`);
            case 'check': {
                const end = await premiumUntil(user.id);
                return reply(interaction, end ? `⭐ <@${user.id}> has premium ${until(end)}.` : `<@${user.id}> doesn't have premium.`);
            }
        }
    },
};
