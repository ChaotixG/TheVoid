// /leaderboard panel with page buttons ("lb:page:<page>:<ownerId>").
const { MessageFlags } = require('discord.js');
const Member = require('../../models/Member');
const { levelFromTotalXp } = require('../../utils/leveling');
const { container, separator, row, button, panelPayload, ButtonStyle } = require('../../utils/panels');

const PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

// Same order everywhere: most XP first, ties broken by user ID
async function positionOf(guildId, userId, totalXp) {
    const ahead = await Member.countDocuments({
        guildId,
        $or: [{ totalXp: { $gt: totalXp } }, { totalXp, userId: { $lt: userId } }],
    });
    return ahead + 1;
}

async function renderLeaderboard(guild, requestedPage, ownerId, payloadOptions) {
    const filter = { guildId: guild.id, totalXp: { $gt: 0 } };
    const total = await Member.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(0, requestedPage), pages - 1);

    const members = await Member.find(filter, { userId: 1, totalXp: 1 })
        .sort({ totalXp: -1, userId: 1 })
        .skip(page * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean();

    const lines = members.map((m, i) => {
        const position = page * PAGE_SIZE + i + 1;
        return `${MEDALS[position - 1] ?? `**#${position}**`} <@${m.userId}> · Level ${levelFromTotalXp(m.totalXp)} · ${m.totalXp.toLocaleString()} XP`;
    });

    const own = await Member.findOne({ guildId: guild.id, userId: ownerId }, { totalXp: 1 }).lean();
    const ownLine = own?.totalXp
        ? `Your rank: **#${await positionOf(guild.id, ownerId, own.totalXp)}** · Level ${levelFromTotalXp(own.totalXp)} · ${own.totalXp.toLocaleString()} XP`
        : 'You haven\'t earned any XP yet. Start chatting!';

    return panelPayload(container([
        `## 🏆 ${guild.name} leaderboard`,
        lines.length ? lines.join('\n') : 'Nobody has earned XP yet. Start chatting!',
        separator(),
        `-# ${ownLine}`,
        pages > 1 ? row(
            button(`lb:page:${page - 1}:${ownerId}`, 'Previous', ButtonStyle.Secondary, { emoji: '◀️', disabled: page === 0 }),
            button('lb:noop', `Page ${page + 1} of ${pages}`, ButtonStyle.Secondary, { disabled: true }),
            button(`lb:page:${page + 1}:${ownerId}`, 'Next', ButtonStyle.Secondary, { emoji: '▶️', disabled: page >= pages - 1 }),
        ) : null,
    ], 0xF1C40F), payloadOptions);
}

async function handleInteraction(client, interaction) {
    const [, action, page, ownerId] = interaction.customId.split(':');
    if (action !== 'page') return;

    // The person who ran /leaderboard turns the pages; anyone else gets their own private copy
    if (interaction.user.id === ownerId) {
        await interaction.deferUpdate();
        return interaction.editReply(await renderLeaderboard(interaction.guild, Number(page), ownerId));
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await renderLeaderboard(interaction.guild, Number(page), interaction.user.id, { convert: true }));
}

module.exports = { renderLeaderboard, handleInteraction };
