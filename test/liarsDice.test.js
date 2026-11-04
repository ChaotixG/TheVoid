const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Short reveals so rounds can be played through quickly; turns (and "your turn" pings) stay long
// unless a test shortens them
const gameConfig = require('../src/config/games');
const SETTINGS = gameConfig.PARTY.liarsDice;
Object.assign(SETTINGS, { turnSeconds: 60, revealSeconds: 0.05 });
gameConfig.TURN_PING_SECONDS = 60;

const Wallet = require('../src/models/Wallet');
const GameStats = require('../src/models/GameStats');
const { games } = require('../src/features/games/sessions');
const gamesRouter = require('../src/features/games');
const menu = require('../src/features/games/menu');
const liarsDice = require('../src/features/games/liarsDice');

const clearGames = () => {
    for (const g of games.values()) { clearTimeout(g.timer); clearTimeout(g.pingTimer); }
    games.clear();
};

before(startDatabase);
after(async () => {
    clearGames();
    await stopDatabase();
});
beforeEach(async () => {
    await clearDatabase();
    clearGames();
});

// Chosen dice: planned[userId] is what that player rolls (any player not planned rolls for real)
let planned = {};
const realRoll = liarsDice.roller.roll;
liarsDice.roller.roll = (count, userId) => (planned[userId] ? planned[userId].slice(0, count) : realRoll(count));
beforeEach(() => { planned = {}; });

const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;
const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

let screens = [];      // every edit of the shared game message, from any interaction, in order
let views = new Map(); // userId → what their private view showed, in order
let posts = [];        // public follow-ups (turn pings)
let deleted = [];      // follow-ups deleted again
beforeEach(() => { screens = []; views = new Map(); posts = []; deleted = []; });
const latest = () => text(screens.at(-1));
const showView = (userId, p) => views.set(userId, [...(views.get(userId) ?? []), p]);
const viewOf = (userId) => text(views.get(userId).at(-1));
const KEYCAP = /\d️⃣/; // a dice face: 1️⃣ to 6️⃣

// A button on the latest board, by its action
function boardButton(action) {
    const found = [];
    const walk = (c) => {
        if (c.custom_id?.split(':')[2] === action) found.push(c);
        (c.components ?? []).forEach(walk);
    };
    screens.at(-1).components.map(c => c.toJSON()).forEach(walk);
    return found[0];
}

// A stand-in interaction that records what the bot answered. By default it's a click on the game
// message (m1); `modal` makes it a form submit from that message, `ephemeral` a click in a private view.
let messageIds = 0;
function fake({ userId = 'p1', customId, fields = {}, modal = false, ephemeral = false } = {}) {
    const calls = { replies: [], shown: [], modal: null };
    const show = (p) => { calls.shown.push(p); if (ephemeral) showView(userId, p); else screens.push(p); };
    const i = {
        user: { id: userId }, guildId: 'g1', channelId: 'c1', customId,
        message: { id: ephemeral ? 'e1' : 'm1', flags: { has: (f) => ephemeral && f === MessageFlags.Ephemeral }, edit: async (p) => show(p) },
        fields: { getStringSelectValues: (id) => fields[id] ?? [] },
        createdTimestamp: Date.now(),
        client: { user: { id: 'me' } },
        options: { getString: () => null },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => !modal, isModalSubmit: () => modal, isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); i.replied = true; },
        update: async (p) => { show(p); i.replied = true; },
        deferUpdate: async () => { i.deferred = true; },
        editReply: async (p) => { show(p); },
        followUp: async (p) => {
            calls.replies.push(p);
            if (!(p.flags & MessageFlags.Ephemeral)) posts.push(p);
            else if (p.components) showView(userId, p); // a private view (openView)
            return { id: `f${++messageIds}` };
        },
        webhook: { editMessage: async (id, p) => showView(userId, p) }, // redrawing a view opened by this click
        deleteReply: async (id) => { deleted.push(id); },
        showModal: async (m) => { calls.modal = m; i.replied = true; },
    };
    calls.interaction = i;
    return { i, calls };
}
// Routes like the interaction router, but lets errors through so a failing test shows them
const press = async (customId, userId = 'p1', extra = {}) => {
    const f = fake({ userId, customId, ...extra });
    await (customId.startsWith('games:') ? menu.handleInteraction(null, f.i) : gamesRouter.handleInteraction(null, f.i));
    return f.calls;
};
const click = (game, userId, action, arg = '') => press(`game:${game.id}:${action}:${arg}`, userId);
const clickPrivate = (game, userId, action) => press(`game:${game.id}:${action}:`, userId, { ephemeral: true });
const bid = (game, userId, quantity, face, turnNo = game.turnNo) =>
    press(`game:${game.id}:submit:${turnNo}`, userId, { modal: true, fields: { quantity: [String(quantity)], face: [String(face)] } });
const notice = (calls) => calls.replies[0]?.content;
const onlyGame = () => [...games.values()][0];
const formOptions = (calls) => calls.modal.toJSON().components.map(label => label.component.options.map(o => o.value));

// Opens a lobby from the /games menu, lets everyone join, and starts it
async function startGame(players) {
    await press('games:start:p1:liarsDice:', 'p1');
    const game = onlyGame();
    for (const p of players.slice(1)) await click(game, p, 'join');
    await click(game, 'p1', 'begin');
    return game;
}

// ─── Rules ────────────────────────────────────────────────────
test('liar\'s dice: bids must go up, ones are wild, and no bid can be more than the dice in play', () => {
    const { bidProblem, countMatches } = liarsDice;
    assert.equal(bidProblem(null, 1, 2, 10), null, 'any opening bid on 2-6');
    assert.match(bidProblem(null, 2, 1, 10), /can't be bid on/, 'ones are wild, not a face to bid on');
    assert.match(bidProblem(null, 2, 7, 10), /face from/);
    assert.match(bidProblem(null, 0, 3, 10), /at least one die/);
    assert.match(bidProblem(null, 11, 3, 10), /only 10 dice/);

    const current = { quantity: 3, face: 4 };
    assert.equal(bidProblem(current, 3, 5, 10), null, 'as many of a higher face');
    assert.equal(bidProblem(current, 4, 2, 10), null, 'more dice of any face');
    assert.match(bidProblem(current, 3, 4, 10), /has to beat/, 'the same bid');
    assert.match(bidProblem(current, 3, 3, 10), /has to beat/, 'a lower face');
    assert.match(bidProblem(current, 2, 6, 10), /has to beat/, 'fewer dice');

    const rolls = new Map([['a', [1, 5, 5, 2]], ['b', [1, 3]]]);
    assert.equal(countMatches(rolls, 5), 4, 'two 5s and two wild ones');
    assert.equal(countMatches(rolls, 3), 3);
    assert.equal(countMatches(rolls, 6), 2, 'just the ones');
});

// ─── Turns and bids ───────────────────────────────────────────
test('liar\'s dice: only the current player bids or calls; the form offers only legal choices; a bid passes the turn', async () => {
    const game = await startGame(['p1', 'p2', 'p3']);
    assert.equal(game.state, 'bidding');
    assert.match(latest(), /Liar's Dice · Round 1/);
    assert.match(latest(), /<@p1>, make the opening bid/);
    assert.equal(boardButton('liar').disabled, true, 'nothing to call yet');

    assert.match(notice(await click(game, 'p9', 'bid')), /not in this game/);
    assert.match(notice(await click(game, 'p2', 'bid')), /It's <@p1>'s turn/);
    assert.match(notice(await click(game, 'p2', 'liar')), /It's <@p1>'s turn/);
    assert.match(notice(await click(game, 'p1', 'liar')), /no bid to call/);

    // Opening bid: any quantity up to the 15 dice in play, faces 2-6
    const [quantities, faces] = formOptions(await click(game, 'p1', 'bid'));
    assert.deepEqual(quantities, Array.from({ length: 15 }, (_, n) => String(n + 1)));
    assert.deepEqual(faces, ['2', '3', '4', '5', '6']);
    await bid(game, 'p1', 3, 4);
    assert.match(latest(), /Current bid: \*\*3 × 4️⃣\*\* by <@p1>/);
    assert.match(latest(), /<@p2>, raise the bid or call \*\*Liar!\*\*/);
    assert.equal(game.turn, 'p2');
    assert.equal(boardButton('liar').disabled, false);

    // 3 × 4 can be beaten by 3 of a higher face, so the form still starts at 3
    assert.equal(formOptions(await click(game, 'p2', 'bid'))[0][0], '3');
    assert.match(notice(await bid(game, 'p2', 3, 4)), /has to beat/);
    assert.match(notice(await bid(game, 'p2', 2, 6)), /has to beat/);
    assert.match(notice(await bid(game, 'p2', 16, 2)), /only 15 dice/);
    assert.match(notice(await bid(game, 'p1', 4, 4)), /It's <@p2>'s turn/);
    assert.match(notice(await bid(game, 'p2', 4, 4, game.turnNo - 1)), /Too late/, 'a form from an earlier turn');
    await bid(game, 'p2', 3, 6);
    assert.equal(game.turn, 'p3');

    // After sixes, the next bid needs more dice
    assert.equal(formOptions(await click(game, 'p3', 'bid'))[0][0], '4');
    await bid(game, 'p3', 15, 6); // the highest bid there is
    assert.match(latest(), /nobody can bid higher, so call \*\*Liar!\*\*/);
    assert.match(latest(), /Before that: <@p1> 3 × 4️⃣ · <@p2> 3 × 6️⃣/);
    assert.equal(boardButton('bid').disabled, true);
    assert.match(notice(await click(game, 'p1', 'bid')), /Nobody can bid higher/);
});

// ─── Calling liar ─────────────────────────────────────────────
test('liar\'s dice: calling a good bid costs the caller a die, calling a bluff costs the bidder one; the loser opens the next round', async () => {
    planned = { p1: [1, 5, 5, 2, 3], p2: [5, 6, 6, 2, 2], p3: [4, 4, 4, 3, 1] }; // five dice count as 5s: 5, 5, 5 and two ones
    const game = await startGame(['p1', 'p2', 'p3']);
    await bid(game, 'p1', 5, 5);
    await click(game, 'p2', 'liar');
    assert.equal(game.state, 'reveal');
    assert.equal(game.dice.get('p2'), 4, 'the bid was good, so the caller loses a die');
    assert.equal(game.dice.get('p1'), 5);
    assert.match(latest(), /<@p2> called \*\*Liar!\*\* on <@p1>'s \*\*5 × 5️⃣\*\*/);
    assert.match(latest(), /<@p1> · 1️⃣ 2️⃣ 3️⃣ 5️⃣ 5️⃣ · \*\*3\*\*/, 'everyone\'s dice are shown, sorted, with how many counted');
    assert.match(latest(), /\*\*5\*\* counted.*the bid was good! <@p2> loses a die/);
    assert.equal(boardButton('bid').disabled, true);
    assert.equal(boardButton('liar').disabled, true);
    assert.match(notice(await click(game, 'p3', 'liar')), /round is over/);

    planned = { p1: [2, 2, 3, 3, 4], p2: [6, 6, 6, 6], p3: [3, 3, 3, 4, 5] }; // a single 5 and no ones
    await wait(150);
    assert.equal(game.round, 2);
    assert.equal(game.turn, 'p2', 'the loser opens the next round');
    assert.match(latest(), /Round 2/);
    assert.match(latest(), /<@p2> · 🎲🎲🎲🎲\\n/u);
    assert.match(latest(), /<@p2>, make the opening bid/);

    await bid(game, 'p2', 3, 5);
    await click(game, 'p3', 'liar');
    assert.equal(game.dice.get('p2'), 3, 'a bluff costs the bidder a die');
    assert.equal(game.dice.get('p3'), 5);
    assert.match(latest(), /\*\*1\*\* counted.*it was a bluff! <@p2> loses a die/);
    await wait(150);
    assert.equal(game.turn, 'p2');
});

test('liar\'s dice: running out of time costs a die, and the next round starts', async () => {
    Object.assign(SETTINGS, { turnSeconds: 0.2, revealSeconds: 0.3 });
    try {
        const game = await startGame(['p1', 'p2']);
        await click(game, 'p1', 'bid'); // p1 opens the form but doesn't send it in time
        const formTurn = game.turnNo;
        await wait(300);
        assert.equal(game.state, 'reveal');
        assert.equal(game.dice.get('p1'), 4);
        assert.equal(game.dice.get('p2'), 5);
        assert.match(latest(), /⌛ <@p1> ran out of time/);
        assert.match(latest(), /<@p1> loses a die/);
        assert.match(notice(await bid(game, 'p1', 2, 2, formTurn)), /round is over/, 'the form arrives during the reveal');

        SETTINGS.turnSeconds = 60; // so the next turn doesn't run out during the test
        await wait(300);
        assert.equal(game.round, 2);
        assert.equal(game.state, 'bidding');
        assert.equal(game.turn, 'p1', 'the player who timed out opens the next round');
        assert.match(notice(await bid(game, 'p1', 2, 2, formTurn)), /Too late/, 'a form from the last round is refused');
        assert.equal(game.bid, null);
    } finally {
        Object.assign(SETTINGS, { turnSeconds: 60, revealSeconds: 0.05 });
    }
});

// ─── A whole game ─────────────────────────────────────────────
test('liar\'s dice: a full game: out players are skipped, the last with dice wins, and the winner and runner-up are paid', async () => {
    SETTINGS.dice = 1;
    try {
        planned = { p1: [2], p2: [3], p3: [4] };
        const game = await startGame(['p1', 'p2', 'p3']);
        await bid(game, 'p1', 2, 2); // only one 2 on the table
        await click(game, 'p2', 'liar');
        assert.equal(game.dice.get('p1'), 0);
        assert.match(latest(), /💀 <@p1> is out!/);

        planned = { p2: [5], p3: [1] };
        await wait(150);
        assert.equal(game.turn, 'p2', 'p1 lost but is out, so the next player opens');
        assert.match(latest(), /💀 ~~<@p1>~~ · out/);
        assert.match(notice(await click(game, 'p1', 'dice')), /out of dice/);
        assert.match(notice(await click(game, 'p1', 'bid')), /out of dice/);
        await bid(game, 'p2', 1, 5);
        await bid(game, 'p3', 2, 5);
        assert.equal(game.turn, 'p2', 'p1 is skipped');
        await click(game, 'p2', 'liar'); // p2's 5 and p3's wild 1: the bid was good
        assert.equal(game.state, 'over');
        assert.equal(games.size, 0);

        const r = gameConfig.REWARDS.liarsDice;
        const winnerCoins = r.winner + 2 * r.perOpponent;
        assert.match(latest(), /Liar's Dice · <@p3> wins!/);
        assert.match(latest(), new RegExp(`🏆 <@p3> · 🎲 left · \\+${winnerCoins} 🪙`));
        assert.match(latest(), new RegExp(`🥈 <@p2> · out in round 2 · \\+${r.runnerUp} 🪙`));
        assert.match(latest(), /🥉 <@p1> · out in round 1(\\n|")/);
        assert.equal(await balanceOf('p3'), winnerCoins);
        assert.equal(await balanceOf('p2'), r.runnerUp);
        assert.equal(await balanceOf('p1'), 0);

        // Stats: one game played for everyone, one win for p3
        const stats = await GameStats.find({ game: 'liarsDice' }).lean();
        assert.deepEqual(stats.map(s => [s.userId, s.played, s.wins]).sort(), [['p1', 1, 0], ['p2', 1, 0], ['p3', 1, 1]]);
        assert.match(notice(await click(game, 'p3', 'bid')), /has ended/);
        assert.equal((await GameStats.findOne({ userId: 'p3', game: 'liarsDice' }).lean()).played, 1, 'recorded once');
    } finally {
        SETTINGS.dice = 5;
    }
});

// ─── Private view and leaving ─────────────────────────────────
test('liar\'s dice: your dice are private; leaving knocks you out and rerolls, and the last one in wins', async () => {
    planned = { p1: [2, 2, 2, 2, 2], p2: [3, 3, 3, 3, 3], p3: [4, 4, 4, 4, 4] };
    const game = await startGame(['p1', 'p2', 'p3']);

    const view = await click(game, 'p1', 'dice');
    const reply = view.replies[0];
    assert.equal(reply.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    assert.match(text(reply), /2️⃣ 2️⃣ 2️⃣ 2️⃣ 2️⃣/);
    assert.match(text(reply), /:quit"/);
    assert.equal(game.lastInteraction, view.interaction, 'opening your dice is acknowledged on the board, which renews its token');
    assert.match(notice(await click(game, 'p9', 'dice')), /not in this game/);

    await bid(game, 'p1', 2, 3);
    await clickPrivate(game, 'p3', 'quit');
    assert.equal(game.dice.get('p3'), 5, 'Leave game asks first');
    const left = await clickPrivate(game, 'p3', 'quityes');
    assert.match(text(left.shown[0]), /You left the game/);
    assert.equal(game.views.has('p3'), false, 'a leaver\'s view stops updating');
    assert.equal(game.dice.get('p3'), 0);
    assert.equal(game.round, 2, 'the dice changed, so everyone rolled again');
    assert.equal(game.bid, null);
    assert.equal(game.turn, 'p2', 'it stays the turn of whoever was up');
    assert.match(latest(), /💀 ~~<@p3>~~ · left/);
    assert.match(latest(), /<@p3> left the game, so everyone rolled again/);
    assert.match(notice(await clickPrivate(game, 'p3', 'quityes')), /already out/);

    await clickPrivate(game, 'p2', 'quityes');
    assert.equal(games.size, 0);
    assert.match(latest(), /<@p1> wins!/);
    assert.match(viewOf('p1'), /You won!/, 'open views show the result too');
    assert.match(latest(), /<@p2> left the game/);
    assert.match(latest(), /🥈 <@p2> · left in round 2/);
    assert.match(latest(), /🥉 <@p3> · left in round 1/);
    assert.equal(await balanceOf('p1'), 0, 'nobody was beaten (they left), so the win pays nothing');
    assert.equal(await balanceOf('p2'), 0, 'leaving forfeits');
    assert.equal(await balanceOf('p3'), 0);
});

// ─── Live private views ───────────────────────────────────────
test('liar\'s dice: private views redraw themselves as the game moves on; views too old to edit are dropped', async () => {
    planned = { p1: [2, 2, 2, 2, 2], p2: [3, 3, 3, 3, 3], p3: [4, 4, 4, 4, 4] };
    const game = await startGame(['p1', 'p2', 'p3']);
    const p2Opened = await click(game, 'p2', 'dice');
    await click(game, 'p1', 'dice');
    assert.match(viewOf('p1'), /Your dice · round 1/);
    assert.match(viewOf('p1'), /2️⃣ 2️⃣ 2️⃣ 2️⃣ 2️⃣/);
    assert.match(viewOf('p1'), /\*\*your turn\*\*/);
    assert.doesNotMatch(viewOf('p1'), /doesn't update/);

    await bid(game, 'p1', 4, 2);
    assert.match(viewOf('p2'), /Current bid: \*\*4 × 2️⃣\*\* by <@p1> · \*\*your turn\*\*/, 'a bid redraws everyone\'s view');
    assert.match(viewOf('p1'), /<@p2>'s turn/);

    // Discord can't edit p2's view any more: it's dropped instead of edited
    p2Opened.interaction.createdTimestamp = Date.now() - 15 * 60_000;
    const p2Shown = views.get('p2').length;
    await click(game, 'p2', 'liar'); // p1's five 2s: the bid was good
    assert.equal(game.views.has('p2'), false);
    assert.equal(views.get('p2').length, p2Shown);
    assert.match(viewOf('p1'), /Round over: <@p2> loses a die · new dice/);

    planned = { p1: [6, 6, 5, 5, 4], p2: [3, 3, 3, 3], p3: [4, 4, 4, 4, 4] };
    await wait(150);
    assert.equal(game.round, 2);
    assert.match(viewOf('p1'), /Your dice · round 2/);
    assert.match(viewOf('p1'), /4️⃣ 5️⃣ 5️⃣ 6️⃣ 6️⃣/, 'the new dice, without pressing My dice again');
});

test('liar\'s dice: a click inside a private view keeps that view live (Leave game asks, Stay goes back)', async () => {
    planned = { p1: [2, 2, 2, 2, 2], p2: [3, 3, 3, 3, 3], p3: [4, 4, 4, 4, 4] };
    const game = await startGame(['p1', 'p2', 'p3']);
    await click(game, 'p3', 'dice');
    const asked = await clickPrivate(game, 'p3', 'quit');
    assert.match(viewOf('p3'), /leave the game\?/);
    assert.match(viewOf('p3'), /:quityes"/);
    assert.equal(game.views.get('p3').interaction, asked.interaction, 'the view now redraws through the click made in it');

    await bid(game, 'p1', 2, 3); // the game moves on while p3 decides
    assert.equal(asked.shown.length, 2, 'redrawn through that click');
    assert.match(viewOf('p3'), /leave the game\?/, 'still asking');

    const stayed = await clickPrivate(game, 'p3', 'stay');
    assert.equal(game.views.get('p3').interaction, stayed.interaction);
    assert.match(viewOf('p3'), /4️⃣ 4️⃣ 4️⃣ 4️⃣ 4️⃣/);
    assert.match(viewOf('p3'), /Current bid: \*\*2 × 3️⃣\*\*/);
    assert.equal(game.dice.get('p3'), 5, 'still playing');
});

// ─── Turn pings ───────────────────────────────────────────────
test('liar\'s dice: whoever\'s turn it is gets pinged after a while; the ping goes once they bid, and none goes out during a reveal', async () => {
    gameConfig.TURN_PING_SECONDS = 0.1;
    SETTINGS.revealSeconds = 0.3;
    try {
        const game = await startGame(['p1', 'p2']);
        assert.ok(game.pingTimer, 'a ping is waiting for p1');
        await bid(game, 'p1', 1, 2); // before it goes out
        await wait(150);
        assert.equal(posts.length, 1, 'p1 moved in time, so only p2 was pinged');
        assert.match(posts[0].content, /<@p2>, it's your turn in \*\*🎲 Liar's Dice\*\*/);
        assert.deepEqual(posts[0].allowedMentions, { users: ['p2'] });
        assert.equal(deleted.length, 0);

        await bid(game, 'p2', 2, 2);
        assert.equal(deleted.length, 1, 'p2\'s ping is removed once they bid');
        await click(game, 'p1', 'liar'); // a reveal starts before p1's ping is due
        await wait(150);
        assert.equal(game.state, 'reveal');
        assert.equal(posts.length, 1, 'no ping during the reveal');
    } finally {
        gameConfig.TURN_PING_SECONDS = 60;
        SETTINGS.revealSeconds = 0.05;
    }
});

// ─── Privacy ──────────────────────────────────────────────────
test('liar\'s dice: while bidding, nobody\'s dice show anywhere public, and each view shows only its owner\'s dice', async () => {
    gameConfig.TURN_PING_SECONDS = 0.05; // so pings go out too
    try {
        planned = { p1: [6, 6, 6, 6, 6], p2: [5, 5, 5, 5, 5], p3: [4, 4, 4, 4, 4] };
        const game = await startGame(['p1', 'p2', 'p3']);
        for (const p of ['p1', 'p2', 'p3']) await click(game, p, 'dice');
        const form = (await click(game, 'p1', 'bid')).modal;
        await bid(game, 'p1', 2, 2);
        await wait(100); // p2 is pinged
        const refusals = [await click(game, 'p3', 'bid'), await click(game, 'p3', 'liar'), await bid(game, 'p2', 1, 2), await click(game, 'p9', 'dice')];
        await bid(game, 'p2', 3, 2);
        assert.equal(game.state, 'bidding');

        // On the game message, a face only ever appears in a bid
        assert.ok(screens.length >= 4);
        for (const s of screens) assert.doesNotMatch(text(s).replace(/\d+ × \d️⃣/g, ''), KEYCAP);
        assert.ok(posts.length >= 1, 'a ping went out');
        for (const p of posts) assert.doesNotMatch(JSON.stringify(p), KEYCAP);
        for (const r of refusals) assert.doesNotMatch(notice(r), /6️⃣|5️⃣|4️⃣/);
        // The bid form shows the five faces to choose from, nothing else
        assert.equal(JSON.stringify(form.toJSON()).match(/\d️⃣/g).length, 5);

        // Each view shows its owner's dice and nobody else's (the 2s and 3s are bids)
        assert.match(viewOf('p1'), /6️⃣ 6️⃣ 6️⃣ 6️⃣ 6️⃣/);
        assert.doesNotMatch(viewOf('p1'), /5️⃣|4️⃣/);
        assert.match(viewOf('p2'), /5️⃣ 5️⃣ 5️⃣ 5️⃣ 5️⃣/);
        assert.doesNotMatch(viewOf('p2'), /6️⃣|4️⃣/);
        assert.match(viewOf('p3'), /4️⃣ 4️⃣ 4️⃣ 4️⃣ 4️⃣/);
        assert.doesNotMatch(viewOf('p3'), /6️⃣|5️⃣/);
    } finally {
        gameConfig.TURN_PING_SECONDS = 60;
    }
});

// ─── Discord's limits ─────────────────────────────────────────
test('liar\'s dice: the board, the private view and the bid form fit Discord\'s limits with 6 players', async () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const game = await startGame(players);
    assert.equal(game.players.length, 6);
    const check = (payload, label) => {
        const { count, textLength, ids } = inspectPanel(payload);
        assert.ok(count <= 40 && textLength <= 4000, `${label}: ${count} components, ${textLength} characters`);
        assert.equal(new Set(ids).size, ids.length, `${label}: duplicate custom_id`);
        assert.ok(ids.every(id => id.length <= 100), `${label}: custom_id too long`);
    };

    // 30 dice in play, but a select holds 25 choices
    const form = (await click(game, 'p1', 'bid')).modal.toJSON(); // toJSON validates
    assert.ok(form.components.length <= 5 && form.title.length <= 45);
    assert.deepEqual(form.components[0].component.options.map(o => o.value), Array.from({ length: 25 }, (_, n) => String(n + 1)));

    for (const [n, p] of players.entries()) await bid(game, p, n + 1, 6);
    check(screens.at(-1), 'bidding');
    check((await click(game, 'p2', 'dice')).replies[0], 'private view');

    await click(game, 'p1', 'liar');
    assert.equal(game.state, 'reveal');
    check(screens.at(-1), 'reveal');
    assert.match(latest(), /<@p6> · (.️⃣ ){4}.️⃣ · \*\*\d\*\*/u, 'everyone\'s dice are revealed');

    check((await clickPrivate(game, 'p2', 'quit')).shown[0], 'leave prompt');
    for (const p of players.slice(1)) if (game.dice.get(p) > 0 && games.size) await clickPrivate(game, p, 'quityes');
    assert.equal(game.state, 'over');
    check(screens.at(-1), 'final');
});
