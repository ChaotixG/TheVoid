const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionsBitField } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Short waits so pings can be tested quickly
const gameConfig = require('../src/config/games');
gameConfig.TURN_PING_SECONDS = 0.05;

const GameStats = require('../src/models/GameStats');
const { games, createGame, endGame, editGame } = require('../src/features/games/sessions');
const router = require('../src/events/interactionCreate/router');
const chat = require('../src/features/games/chat');
const { openView, trackView, refreshViews } = require('../src/features/games/privateViews');
const { announceTurn, clearTurn } = require('../src/features/games/turns');
const { recordGame, statsFor } = require('../src/features/games/stats');
const { gamePayload } = require('../src/features/games/common');

before(startDatabase);
after(stopDatabase);
beforeEach(async () => {
    await clearDatabase();
    for (const g of games.values()) { clearTimeout(g.timer); clearTimeout(g.pingTimer); }
    games.clear();
    chat.listening.clear();
});

const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const friend = '200000000000000002'; // opponents are real user IDs

let screens = [];
beforeEach(() => { screens = []; });
const latest = () => text(screens.at(-1));

// A stand-in interaction on a message (m1 unless given) that records what the bot answered
function fake({ userId = 'p1', customId, values, users, options = {}, messageId = 'm1', appPermissions, ephemeralMessage = false } = {}) {
    const calls = { replies: [], shown: [], deleted: [] };
    const show = (p) => { calls.shown.push(p); screens.push(p); };
    const i = {
        user: { id: userId }, guildId: 'g1', channelId: 'c1', customId, values, users, appPermissions,
        guild: { members: { me: {} } }, channel: { permissionsFor: () => ({ has: () => true }) },
        message: { id: messageId, edit: async (p) => show(p), flags: { has: () => ephemeralMessage } },
        createdTimestamp: Date.now(),
        client: { user: { id: 'me' } },
        options: { getString: (n) => options[n] ?? null },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => true, isModalSubmit: () => false, isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); i.replied = true; return { resource: { message: { id: 'new' } } }; },
        update: async (p) => { show(p); i.replied = true; },
        deferUpdate: async () => { i.deferred = true; },
        deferReply: async () => { i.deferred = true; calls.newMessage = true; },
        editReply: async (p) => { show(p); },
        followUp: async (p) => { calls.replies.push(p); return { id: `f${calls.replies.length}`, flags: { has: () => (p.flags & 64) === 64 } }; },
        deleteReply: async (id = '@original') => { calls.deleted.push(id); },
        webhook: { editMessage: async (id, p) => { calls.edited = { id, p }; } },
    };
    return { i, calls };
}
const press = async (customId, userId = 'p1', extra = {}) => {
    const f = fake({ userId, customId, ...extra });
    await router(null, f.i);
    return f.calls;
};
const click = (game, userId, action, arg = '', extra = {}) => press(`game:${game.id}:${action}:${arg}`, userId, extra);
const onlyGame = () => [...games.values()][0];
const notice = (calls) => calls.replies[0]?.content;

// ─── Finished games ───────────────────────────────────────────
test('finished games get Play again and Games; Play again starts a new game below, for whoever pressed it', async () => {
    await press('games:play:p1:wordle', 'p1');
    const game = onlyGame();
    await click(game, 'p1', 'giveup');
    assert.match(latest(), new RegExp(`games:again:wordle:${game.id}:`));
    assert.match(latest(), new RegExp(`games:menu:${game.id}`));

    const again = await press(`games:again:wordle:${game.id}:`, 'p2');
    assert.equal(again.newMessage, true, 'a new message, so the finished board stays');
    assert.deepEqual(onlyGame().players, ['p2']);
    assert.equal(onlyGame().replay.type, 'wordle', 'it can be played again too');

    const menu = await press(`games:menu:${game.id}`, 'p3');
    assert.match(text(menu.replies[0]), /games:tab:p3:solo/);
    assert.equal(menu.replies[0].flags & 64, 64, 'the menu is private');
});

// ─── Who sees what ────────────────────────────────────────────
test('the menu is private; party games and challenges are posted for everyone; solo games and games against me stay private', async () => {
    const menu = fake({ userId: 'p1' });
    await require('../src/features/games/menu').openMenu(menu.i);
    assert.equal(menu.calls.replies[0].flags & 64, 64, 'only the opener sees the menu');

    // A lobby is posted in the channel and the private menu closes; later edits go to that post
    const party = await press('games:start:p1:triviaParty:any', 'p1', { ephemeralMessage: true });
    assert.equal(party.replies[0].flags & 64, 0, 'the lobby is public');
    assert.deepEqual(party.deleted, ['@original'], 'the private menu is gone');
    const lobby = onlyGame();
    assert.equal(lobby.private, false);
    await editGame(lobby, gamePayload(['an update'], 0));
    assert.equal(party.edited.id, 'f1', 'timers edit the posted lobby, not the closed menu');
    games.clear();

    const challenge = await press(`games:start:p1:connect4:${friend}`, 'p1', { ephemeralMessage: true });
    assert.equal(challenge.replies[0].flags & 64, 0, 'a challenge is public');
    assert.deepEqual(challenge.replies[1].allowedMentions, { users: [friend] });
    games.clear();

    for (const [id, state] of [['wordle', ''], ['connect4', 'bot'], ['trivia', 'solo.any']]) {
        const solo = await press(`games:start:p1:${id}:${state}`, 'p1', { ephemeralMessage: true });
        assert.equal(solo.replies.length, 0, `${id}: nothing posted in the channel`);
        assert.equal(solo.deleted.length, 0, `${id}: the menu becomes the game`);
        if (games.size) assert.equal(onlyGame().private, true, `${id}: a private game`);
        for (const g of games.values()) clearTimeout(g.timer);
        games.clear();
    }
});

test('Show in channel posts a stats card everyone can see', async () => {
    await recordGame({ type: 'wordle', players: ['p1'] }, { winners: ['p1'], scores: { p1: 3 } });
    await recordGame({ type: 'crazyEights', players: ['p1', 'p2'] }, { winners: ['p1'] });
    const shared = await press('games:share:p1', 'p1', { ephemeralMessage: true });
    const card = shared.replies[0];
    assert.equal(card.flags & 64, 0, 'public');
    assert.match(text(card), /Game stats/);
    assert.match(text(card), /<@p1> · 2 games · 2 wins/);
    assert.match(text(card), /Solo\*\*\\n🟩 \*\*Wordle\*\* · 1 game · best 3 guesses/);
    assert.match(text(card), /Party\*\*\\n🎴 \*\*Crazy Eights\*\* · 1 game · 1 win/);
    assert.deepEqual(card.allowedMentions, { parse: [] }, 'nobody is pinged');
    assert.match(latest(), /posted in the channel/);
    assert.ok(inspectPanel(card).count <= 40);
});

test('rematch: a party lobby invites the same players back (they choose to join); a two-player rematch challenges the other player', async () => {
    await press('games:start:p1:triviaParty:any', 'p1');
    const lobby = onlyGame();
    await click(lobby, 'p2', 'join');
    await click(lobby, 'p3', 'join');
    await click(lobby, 'p1', 'cancel');
    assert.match(latest(), /Rematch/);

    // A bystander gets a lobby of their own, without pinging anyone
    const bystander = await press(`games:again:triviaParty:${lobby.id}:any`, 'p9');
    assert.equal(bystander.replies.length, 0);
    games.clear();

    const rematch = await press(`games:again:triviaParty:${lobby.id}:any`, 'p2');
    const next = onlyGame();
    assert.equal(next.host, 'p2', 'whoever pressed it hosts');
    assert.deepEqual(next.players, ['p2'], 'nobody is added without pressing Join');
    assert.deepEqual(rematch.replies[0].allowedMentions, { users: ['p1', 'p3'] });
    assert.match(rematch.replies[0].content, /wants a rematch! Press \*\*Join\*\*/);
    games.clear();

    // Invited back once: pressing it again doesn't ping them again
    const twice = await press(`games:again:triviaParty:${lobby.id}:any`, 'p1');
    assert.equal(twice.replies.length, 0);
    games.clear();

    await press(`games:start:p1:tictactoe:${friend}`, 'p1');
    const duel = onlyGame();
    await click(duel, friend, 'decline');
    const back = await press(`games:again:tictactoe:${duel.id}:${friend}`, friend);
    assert.deepEqual(onlyGame().players, [friend, 'p1'], 'the other player is challenged back');
    assert.deepEqual(back.replies[0].allowedMentions, { users: ['p1'] });
});

test('Play again refuses privately, before posting anything, where the game can\'t run', async () => {
    await press('games:play:p1:scramble', 'p1', { messageId: 'm9' }); // claims the channel for chat games
    const refused = await press('games:again:wordChain:nope:', 'p2');
    assert.match(notice(refused), /already running/);
    assert.equal(refused.replies[0].flags, 64, 'only they see it');
    assert.equal(refused.newMessage, undefined, 'no placeholder message was posted');

    const blind = await press('games:again:crazyEights:nope:', 'p2', { appPermissions: new PermissionsBitField(0n) });
    assert.match(notice(blind), /can't see this channel/);
    assert.equal(blind.newMessage, undefined);
});

// ─── Lobbies ──────────────────────────────────────────────────
test('lobby invites ping the people picked (not bots, not players); party games need a channel I can see', async () => {
    await press('games:start:p1:triviaParty:any', 'p1');
    const lobby = onlyGame();
    const users = new Collection([['p1', { id: 'p1', bot: false }], ['p5', { id: 'p5', bot: false }], ['b1', { id: 'b1', bot: true }]]);
    const invited = await click(lobby, 'p1', 'invite', '', { users });
    assert.deepEqual(invited.replies[0].allowedMentions, { users: ['p5'] });
    assert.match(invited.replies[0].content, /invited you to play/);
    assert.match(notice(await click(lobby, 'p9', 'invite', '', { users })), /Join first/);
    assert.ok(inspectPanel(screens.at(-1)).count <= 40);
    games.clear();

    const blind = await press('games:start:p1:triviaParty:any', 'p1', { appPermissions: new PermissionsBitField(0n) });
    assert.match(notice(blind), /can't see this channel/);
    assert.equal(games.size, 0);
});

// ─── Private views, turn pings, long games ───────────────────
test('private views refresh themselves until their 15 minutes are up', async () => {
    const game = createGame('test', { players: ['p1', 'p2'] });
    const opened = fake({ userId: 'p1' });
    await openView(game, opened.i, gamePayload(['Your hand: 🟥7'], 0));
    assert.equal(opened.calls.replies[0].flags & 64, 64, 'only that player sees it');
    assert.equal(game.lastInteraction, opened.i, 'opening a view renews the game message\'s 15 minutes');

    const inView = fake({ userId: 'p2' });
    inView.i.message.flags = { has: () => true }; // a click inside an ephemeral view
    trackView(game, inView.i);

    await refreshViews(game, (g, userId) => gamePayload([`hand of ${userId}`], 0));
    assert.equal(opened.calls.edited.id, 'f1');
    assert.match(text(opened.calls.edited.p), /hand of p1/);
    assert.match(text(inView.calls.shown.at(-1)), /hand of p2/);

    opened.i.createdTimestamp = Date.now() - 20 * 60_000;
    opened.calls.edited = null;
    await refreshViews(game, () => gamePayload(['later'], 0));
    assert.equal(opened.calls.edited, null, 'too old to edit: left alone');
    assert.equal(game.views.has('p1'), false);
    endGame(game);
});

test('turn pings go out only if the player hasn\'t moved, and are removed when the turn ends', async () => {
    const game = createGame('test', { players: ['p1', 'p2'], title: 'Crazy Eights' });
    const board = fake({ userId: 'p1' });
    game.lastInteraction = board.i;

    announceTurn(game, 'p1');
    clearTurn(game); // moved right away
    await wait(120);
    assert.equal(board.calls.replies.length, 0);

    announceTurn(game, 'p2');
    await wait(120);
    assert.deepEqual(board.calls.replies[0].allowedMentions, { users: ['p2'] });
    announceTurn(game, 'p1'); // the next turn removes the last ping
    assert.deepEqual(board.calls.deleted, ['f1']);
    endGame(game);
});

test('after 15 minutes, the game message is edited by the bot itself (loading the channel if needed)', async () => {
    const game = createGame('test', { players: ['p1'] });
    game.lastInteraction = { createdTimestamp: Date.now() - 16 * 60_000, editReply: async () => { throw new Error('token expired'); } };
    let fetched = false;
    let edited = null;
    game.message = { channelId: 'c1', channel: null, client: { channels: { fetch: async () => { fetched = true; } } }, edit: async (p) => { edited = p; } };
    await editGame(game, gamePayload(['still going'], 0));
    assert.equal(fetched, true);
    assert.match(text(edited), /still going/);
    endGame(game);
});

// ─── Stats ────────────────────────────────────────────────────
test('stats: played, wins and best score add up across games; the Stats tab shows them', async () => {
    await recordGame({ type: 'wordle', players: ['p1'] }, { winners: ['p1'], scores: { p1: 4 } });
    await recordGame({ type: 'wordle', players: ['p1'] }, { winners: ['p1'], scores: { p1: 2 } });
    await recordGame({ type: 'wordle', players: ['p1'] });
    await recordGame({ type: 'tictactoe', players: ['p1', 'bot'] }, { winners: ['p1'] });
    const wordle = await GameStats.findOne({ userId: 'p1', game: 'wordle' }).lean();
    assert.deepEqual([wordle.played, wordle.wins, wordle.best], [3, 2, 2], 'fewest guesses is best');
    assert.equal(await GameStats.countDocuments({ userId: 'bot' }), 0, 'the bot isn\'t a player');
    const stats = await statsFor('p1');
    assert.equal(stats.lines.get('wordle'), '3 games · best 2 guesses');
    assert.deepEqual([stats.played, stats.wins], [4, 3]);

    await press('games:tab:p1:stats', 'p1');
    assert.match(latest(), /Wordle\*\* · 3 games · best 2 guesses/);
    assert.match(latest(), /Tic-tac-toe\*\* · 1 game · 1 win/);

    // A finished game records itself
    await press('games:play:p2:wordle', 'p2');
    await click(onlyGame(), 'p2', 'giveup');
    assert.equal((await GameStats.findOne({ userId: 'p2', game: 'wordle' }).lean()).played, 1);
});
