// /leaderboard panel: an XP board (this server's levels) and a Coins board (global wallets of this
// server's members), with tab buttons "lb:tab:<board>:<ownerId>" and page buttons
// "lb:page:<board>:<page>:<ownerId>" (separate actions, so a tab never shares an ID with a page button).
const { MessageFlags } = require('discord.js');
const Member = require('../../models/Member');
const { levelFromTotalXp } = require('../../utils/leveling');
const { coins } = require('../../utils/coins');
const { container, separator, row, button, panelPayload, ButtonStyle } = require('../../utils/panels');

const PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

// ─── Data: both boards return { total, rows: [{ userId, value }], own: { value, position } } ──
// Same order everywhere: highest first, ties broken by user ID

async function xpBoard(guildId, page, ownerId) {
    const filter = { guildId, totalXp: { $gt: 0 } };
    const [total, members, own] = await Promise.all([
        Member.countDocuments(filter),
        Member.find(filter, { userId: 1, totalXp: 1 }).sort({ totalXp: -1, userId: 1 }).skip(page * PAGE_SIZE).limit(PAGE_SIZE).lean(),
        Member.findOne({ guildId, userId: ownerId }, { totalXp: 1 }).lean(),
    ]);
    let ownEntry = null;
    if (own?.totalXp) {
        const ahead = await Member.countDocuments({ guildId, $or: [{ totalXp: { $gt: own.totalXp } }, { totalXp: own.totalXp, userId: { $lt: ownerId } }] });
        ownEntry = { value: own.totalXp, position: ahead + 1 };
    }
    return { total, rows: members.map(m => ({ userId: m.userId, value: m.totalXp })), own: ownEntry };
}

// Members of this server, joined with their global wallets
const walletsOfGuild = (guildId) => [
    { $match: { guildId } },
    { $lookup: { from: 'wallets', localField: 'userId', foreignField: 'userId', as: 'wallet' } },
    { $project: { _id: 0, userId: 1, value: { $ifNull: [{ $first: '$wallet.balance' }, 0] } } },
    { $match: { value: { $gt: 0 } } },
];

async function coinBoard(guildId, page, ownerId) {
    const [result] = await Member.aggregate([
        ...walletsOfGuild(guildId),
        { $sort: { value: -1, userId: 1 } },
        { $facet: {
            total: [{ $count: 'n' }],
            rows: [{ $skip: page * PAGE_SIZE }, { $limit: PAGE_SIZE }],
            own: [{ $match: { userId: ownerId } }],
        } },
    ]);
    const total = result.total[0]?.n ?? 0;
    let own = null;
    if (result.own[0]) {
        const value = result.own[0].value;
        const [ahead] = await Member.aggregate([
            ...walletsOfGuild(guildId),
            { $match: { $or: [{ value: { $gt: value } }, { value, userId: { $lt: ownerId } }] } },
            { $count: 'n' },
        ]);
        own = { value, position: (ahead?.n ?? 0) + 1 };
    }
    return { total, rows: result.rows, own };
}

const BOARDS = {
    xp: {
        title: 'leaderboard',
        load: xpBoard,
        line: (r) => `Level ${levelFromTotalXp(r.value)} · ${r.value.toLocaleString()} XP`,
        empty: 'Nobody has earned XP yet. Start chatting!',
        ownEmpty: 'You haven\'t earned any XP yet. Start chatting!',
    },
    coins: {
        title: 'richest members',
        load: coinBoard,
        line: (r) => `${coins(r.value)}`,
        empty: 'Nobody here has coins yet. Try **/daily**!',
        ownEmpty: 'You don\'t have any coins yet. Try **/daily**!',
    },
};

// ─── Rendering ────────────────────────────────────────────────
async function renderLeaderboard(guild, requestedPage, ownerId, payloadOptions, boardKey = 'xp') {
    const board = BOARDS[boardKey] ?? BOARDS.xp;
    const key = BOARDS[boardKey] ? boardKey : 'xp';

    let page = Math.max(0, requestedPage);
    let data = await board.load(guild.id, page, ownerId);
    const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (page > pages - 1) { // asked past the end (e.g. the board shrank): show the last page
        page = pages - 1;
        data = await board.load(guild.id, page, ownerId);
    }

    const lines = data.rows.map((r, i) => {
        const position = page * PAGE_SIZE + i + 1;
        return `${MEDALS[position - 1] ?? `**#${position}**`} <@${r.userId}> · ${board.line(r)}`;
    });
    const ownLine = data.own ? `Your rank: **#${data.own.position}** · ${board.line(data.own)}` : board.ownEmpty;

    return panelPayload(container([
        `## 🏆 ${guild.name} ${board.title}`,
        row(
            button(`lb:tab:xp:${ownerId}`, 'XP', key === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: '⭐' }),
            button(`lb:tab:coins:${ownerId}`, 'Coins', key === 'coins' ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: '🪙' }),
        ),
        lines.length ? lines.join('\n') : board.empty,
        separator(),
        `-# ${ownLine}`,
        pages > 1 ? row(
            button(`lb:page:${key}:${page - 1}:${ownerId}`, 'Previous', ButtonStyle.Secondary, { emoji: '◀️', disabled: page === 0 }),
            button('lb:noop', `Page ${page + 1} of ${pages}`, ButtonStyle.Secondary, { disabled: true }),
            button(`lb:page:${key}:${page + 1}:${ownerId}`, 'Next', ButtonStyle.Secondary, { emoji: '▶️', disabled: page >= pages - 1 }),
        ) : null,
    ], 0xF1C40F), payloadOptions);
}

async function handleInteraction(client, interaction) {
    const parts = interaction.customId.split(':');
    let boardKey, page, ownerId;
    if (parts[1] === 'tab') [boardKey, page, ownerId] = [parts[2], 0, parts[3]];
    else if (parts[1] === 'page' && parts.length === 4) [boardKey, page, ownerId] = ['xp', parts[2], parts[3]]; // from before the Coins board
    else if (parts[1] === 'page') [boardKey, page, ownerId] = [parts[2], parts[3], parts[4]];
    else return;

    // The person who ran /leaderboard turns the pages; anyone else gets their own private copy
    if (interaction.user.id === ownerId) {
        await interaction.deferUpdate();
        return interaction.editReply(await renderLeaderboard(interaction.guild, Number(page), ownerId, undefined, boardKey));
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await renderLeaderboard(interaction.guild, Number(page), interaction.user.id, { convert: true }, boardKey));
}

module.exports = { renderLeaderboard, handleInteraction };
