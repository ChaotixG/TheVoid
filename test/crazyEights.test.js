const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Turns are long unless a test shortens them (read when each turn starts)
const gameConfig = require('../src/config/games');
const settings = gameConfig.PARTY.crazyEights;
settings.turnSeconds = 60;

const Wallet = require('../src/models/Wallet');
const { games } = require('../src/features/games/sessions');
const router = require('../src/events/interactionCreate/router');
const crazyEights = require('../src/features/games/crazyEights');
const { winnerReward } = require('../src/features/games/scoring');

const stopGames = () => {
    for (const g of games.values()) clearTimeout(g.timer);
    games.clear();
};

before(startDatabase);
after(async () => {
    stopGames();
    await stopDatabase();
});
beforeEach(async () => {
    await clearDatabase();
    stopGames();
    settings.turnSeconds = 60;
    screens = [];
});

const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;
const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Every edit of the shared game message, from any interaction, in order
let screens = [];
const latest = () => text(screens.at(-1));

// A stand-in interaction that records what the bot answered. Clicks on the game message (m1) edit
// it; clicks in a private view (an ephemeral message, like the real one) only update that view.
function fake({ userId = 'p1', customId, values, privateView = false } = {}) {
    const calls = { replies: [], views: [] };
    const show = (p) => (privateView ? calls.views : screens).push(p);
    const i = {
        user: { id: userId }, guildId: 'g1', channelId: 'c1', customId, values,
        message: privateView
            ? { id: 'v1', flags: { has: (flag) => flag === MessageFlags.Ephemeral } }
            : { id: 'm1', edit: async (p) => { screens.push(p); } },
        createdTimestamp: Date.now(),
        client: { user: { id: 'me' } },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => true, isModalSubmit: () => false, isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); i.replied = true; },
        update: async (p) => { show(p); i.replied = true; },
        deferUpdate: async () => { i.deferred = true; },
        editReply: async (p) => { show(p); },
        followUp: async (p) => { calls.replies.push(p); },
    };
    return { i, calls };
}
const press = async (customId, userId, extra = {}) => {
    const f = fake({ userId, customId, ...extra });
    await router(null, f.i);
    return f.calls;
};
// A click on the game message
const click = (game, userId, action, arg = '') => press(`game:${game.id}:${action}:${arg}`, userId);
// A click (or a color choice) in someone's private view of their hand
const tap = (game, userId, action, arg = '', values) => press(`game:${game.id}:${action}:${arg}`, userId, { privateView: true, values });
const viewOf = (calls) => text(calls.views.at(-1));
const notice = (calls) => calls.replies[0]?.content;
const newestGame = () => [...games.values()].at(-1);

// Opens a lobby from the /games menu, has everyone join, and starts it (the first player hosts)
async function startGame(players = ['p1', 'p2', 'p3']) {
    await press(`games:start:${players[0]}:crazyEights:`, players[0]);
    const game = newestGame();
    for (const p of players.slice(1)) await click(game, p, 'join');
    await click(game, players[0], 'begin');
    return game;
}

// Sets the cards: hands by player, the top of the pile (with its color, for a wild) and the deck (drawn from its end)
function deal(game, { hands, top = 'r5', color = top[0], deck }) {
    for (const [id, cards] of Object.entries(hands)) game.hands.set(id, [...cards]);
    game.pile = [top];
    game.color = color;
    if (deck) game.deck = [...deck];
}

const totalCards = (game) => game.deck.length + game.pile.length + [...game.hands.values()].reduce((n, h) => n + h.length, 0);

test('crazy eights: 108 cards, and shuffling keeps every one', () => {
    const deck = crazyEights.newDeck();
    assert.equal(deck.length, 108);
    const count = (card) => deck.filter(c => c === card).length;
    for (const c of ['r', 'b', 'g', 'y']) {
        assert.equal(count(`${c}0`), 1, `${c}0`);
        for (const v of [...'123456789', 's', 'r', 'd']) assert.equal(count(`${c}${v}`), 2, `${c}${v}`);
        assert.equal(deck.filter(card => card[0] === c).length, 25);
    }
    assert.equal(count('w'), 4);
    assert.equal(count('w4'), 4);

    const shuffled = crazyEights.shuffle(deck);
    assert.deepEqual([...shuffled].sort(), [...deck].sort());
    assert.notDeepEqual(shuffled, deck);
    assert.deepEqual(crazyEights.shuffle(['a', 'b', 'c'], (n) => n - 1), ['a', 'b', 'c'], 'tests can choose the randomness');
});

test('crazy eights: the lobby explains the rules; everyone gets 7 cards and the pile starts with a number', async () => {
    await press('games:start:p1:crazyEights:', 'p1');
    const game = newestGame();
    assert.equal(game.state, 'lobby');
    assert.match(latest(), /Crazy Eights/);
    assert.match(latest(), /Players · 1\/8/);
    assert.match(latest(), /7 cards each · 60s per turn/);
    await click(game, 'p2', 'join');
    await click(game, 'p3', 'join');
    await click(game, 'p1', 'begin');

    assert.equal(game.state, 'playing');
    for (const id of ['p1', 'p2', 'p3']) assert.equal(game.hands.get(id).length, 7);
    assert.equal(game.pile.length, 1);
    assert.match(game.pile[0], /^[rbgy]\d$/);
    assert.equal(game.color, game.pile[0][0]);
    assert.equal(game.deck.length, 108 - 21 - 1);
    assert.equal(totalCards(game), 108);

    assert.match(latest(), /\*\*Top card\*\* /);
    assert.match(latest(), /<@p1>'s turn · auto-draw <t:\d+:R>/);
    assert.match(latest(), /play goes ⬇️/);
    assert.match(latest(), /▶️ <@p1> · 7 cards/);
    assert.match(latest(), /game:[0-9a-f]+:hand/);
    assert.match(notice(await click(game, 'p4', 'join')), /already started/);
    assert.match(notice(await click(game, 'p2', 'leave')), /My hand/);

    assert.match(text(game.onExpire()), /no moves for 10 minutes/);
});

test('crazy eights: your hand is private; only matching cards can be played, on your own turn', async () => {
    const game = await startGame();
    deal(game, { hands: { p1: ['r7', 'b3', 'g5', 'w'], p2: ['b9', 'y1'], p3: ['g2', 'g3'] }, top: 'r5' });

    const reply = (await click(game, 'p1', 'hand')).replies[0];
    assert.equal(reply.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    const hand = text(reply);
    assert.match(hand, /Your hand · 4 cards/);
    assert.match(hand, /Your turn!/);
    assert.match(hand, /🟥7 🟦3 🟩5 🌈/);
    for (const card of ['r7', 'g5', 'w']) assert.match(hand, new RegExp(`:play:${card}"`));
    assert.doesNotMatch(hand, /:play:b3"/, 'only cards that can be played get a button');
    assert.match(notice(await click(game, 'p9', 'hand')), /not in this game/);

    const before = screens.length;
    assert.match(viewOf(await tap(game, 'p2', 'play', 'b9')), /It's <@p1>'s turn, not yours/);
    assert.match(viewOf(await tap(game, 'p1', 'play', 'b3')), /🟦3 doesn't match. Play a 🟥 card or a 5, or a wild/);
    assert.match(viewOf(await tap(game, 'p1', 'play', 'y1')), /don't have that card/);
    assert.match(viewOf(await tap(game, 'p1', 'pass')), /Draw a card first/);
    assert.equal(game.hands.get('p1').length, 4, 'refused plays change nothing');
    assert.equal(screens.length, before, 'and don\'t touch the game message');

    const played = viewOf(await tap(game, 'p1', 'play', 'r7'));
    assert.match(played, /You played 🟥7/);
    assert.match(played, /<@p2>'s turn/);
    assert.doesNotMatch(played, /:play:/, 'no cards to play on someone else\'s turn');
    assert.equal(game.pile.at(-1), 'r7');
    assert.equal(game.players[game.turn], 'p2');
    assert.match(latest(), /<@p2>'s turn/);
    assert.match(latest(), /<@p1> played 🟥7/);
    assert.match(latest(), /▫️ <@p1> · 3 cards/);
});

test('crazy eights: Skip, Reverse and +2 hit the next player', async () => {
    const game = await startGame();
    deal(game, { hands: { p1: ['rs', 'r1', 'r1'], p2: ['rd', 'b2', 'b2'], p3: ['rr', 'g3', 'g3'] }, top: 'r5' });

    await tap(game, 'p1', 'play', 'rs');
    assert.equal(game.players[game.turn], 'p3', 'p2 is skipped');
    assert.match(latest(), /<@p1> played 🟥⏭️ · <@p2> is skipped/);

    await tap(game, 'p3', 'play', 'rr');
    assert.equal(game.direction, -1);
    assert.equal(game.players[game.turn], 'p2', 'play turns back the other way');
    assert.match(latest(), /order reversed/);
    assert.match(latest(), /play goes ⬆️/);

    await tap(game, 'p2', 'play', 'rd');
    assert.equal(game.hands.get('p1').length, 4, 'p1 draws 2');
    assert.equal(game.players[game.turn], 'p3', 'and loses their turn');
    assert.match(latest(), /<@p2> played 🟥\+2 · <@p1> draws 2 and is skipped/);
});

test('crazy eights: a wild asks for a color; +4 makes the next player draw 4; with two players Reverse works like Skip', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { hands: { p1: ['rr', 'w', 'w4', 'b1'], p2: ['g1', 'g2', 'r9'] }, top: 'r5' });

    await tap(game, 'p1', 'play', 'rr');
    assert.equal(game.players[game.turn], 'p1', 'p2 is skipped, so p1 goes again');
    assert.match(latest(), /<@p2> is skipped/);

    const choosing = viewOf(await tap(game, 'p1', 'play', 'w'));
    assert.match(choosing, /Choose a color for 🌈:/);
    assert.match(choosing, /:color:w"/);
    assert.equal(game.pile.at(-1), 'rr', 'nothing is played until a color is chosen');

    await tap(game, 'p1', 'color', 'w', ['g']);
    assert.equal(game.pile.at(-1), 'w');
    assert.equal(game.color, 'g');
    assert.match(latest(), /\*\*Top card\*\* 🌈 · \*\*Color\*\* 🟩 Green/);
    assert.match(latest(), /<@p1> played 🌈 · color 🟩/);
    assert.match(viewOf(await tap(game, 'p2', 'play', 'r9')), /doesn't match. Play a 🟩 card, or a wild/);
    await tap(game, 'p2', 'play', 'g1');

    await tap(game, 'p1', 'play', 'w4');
    await tap(game, 'p1', 'color', 'w4', ['b']);
    assert.equal(game.color, 'b');
    assert.equal(game.hands.get('p2').length, 2 + 4);
    assert.equal(game.players[game.turn], 'p1', 'p2 drew 4 and lost their turn');
    assert.match(latest(), /<@p1> played 🌈\+4 · color 🟦 · <@p2> draws 4 and is skipped/);
    assert.match(latest(), /<@p1> · \*\*1 card!\*\*/);

    // Two players: no runner-up prize
    await tap(game, 'p1', 'play', 'b1');
    assert.equal(games.size, 0);
    assert.equal(await balanceOf('p1'), winnerReward('crazyEights', 2));
    assert.equal(await balanceOf('p2'), 0);
});

test('crazy eights: a drawn card that matches can be played right away or kept; otherwise the turn passes', async () => {
    const game = await startGame();
    deal(game, { hands: { p1: ['r1', 'b3'], p2: ['y1', 'y2'], p3: ['g6', 'g7'] }, top: 'r5', deck: ['r2', 'g4', 'r9'] });

    const drew = viewOf(await tap(game, 'p1', 'draw'));
    assert.match(drew, /You drew 🟥9. Play it or pass/);
    assert.match(drew, /:play:r9"/);
    assert.doesNotMatch(drew, /:play:r1"/, 'after drawing, only the drawn card can be played');
    assert.equal(game.players[game.turn], 'p1');
    assert.match(viewOf(await tap(game, 'p1', 'play', 'r1')), /only the card you drew \(🟥9\)/);
    assert.match(viewOf(await tap(game, 'p1', 'draw')), /You already drew 🟥9/);
    await tap(game, 'p1', 'play', 'r9');
    assert.deepEqual(game.hands.get('p1'), ['r1', 'b3']);
    assert.equal(game.players[game.turn], 'p2');

    const passed = viewOf(await tap(game, 'p2', 'draw'));
    assert.match(passed, /You drew 🟩4. It doesn't match, so your turn passes/);
    assert.equal(game.hands.get('p2').length, 3);
    assert.equal(game.players[game.turn], 'p3');
    assert.match(latest(), /<@p2> drew a card and passed/);

    assert.match(viewOf(await tap(game, 'p3', 'draw')), /You drew 🟥2. Play it or pass/);
    assert.match(viewOf(await tap(game, 'p3', 'pass')), /You passed/);
    assert.deepEqual(game.hands.get('p3'), ['g6', 'g7', 'r2'], 'p3 keeps the card');
    assert.equal(game.players[game.turn], 'p1');
    assert.match(latest(), /<@p3> passed/);
});

test('crazy eights: when the deck runs out, the pile except its top card becomes the new deck', async () => {
    const game = await startGame();
    deal(game, { hands: { p1: ['b3', 'b4'], p2: ['y1'], p3: ['g6'] }, top: 'r5', deck: [] });
    game.pile = ['g1', 'y8', 'b2', 'r5'];

    await tap(game, 'p1', 'draw'); // none of them match 🟥5, so the turn passes
    assert.deepEqual(game.pile, ['r5']);
    assert.equal(game.deck.length, 2);
    assert.deepEqual([...game.deck, game.hands.get('p1')[2]].sort(), ['b2', 'g1', 'y8']);
    assert.equal(game.players[game.turn], 'p2');
    assert.match(latest(), /The pile was shuffled into a new deck/);

    // Every other card is in someone's hand: nothing to draw, and the turn passes
    game.deck = [];
    assert.match(viewOf(await tap(game, 'p2', 'draw')), /no cards left to draw/);
    assert.equal(game.hands.get('p2').length, 1);
    assert.equal(game.players[game.turn], 'p3');
});

test('crazy eights: running out of time draws a card and passes; three turns in a row and you\'re out', async () => {
    const game = await startGame();
    deal(game, { hands: { p1: ['r1', 'r2', 'r3'], p2: ['b1', 'b2'], p3: ['g1', 'g2'] }, top: 'r5', deck: ['y1', 'y2', 'y3', 'y4'] });

    // Only p2's turn is short: the next turn started reads the long setting again
    settings.turnSeconds = 0.15;
    await tap(game, 'p1', 'play', 'r1');
    settings.turnSeconds = 60;
    await wait(400);
    assert.deepEqual(game.hands.get('p2'), ['b1', 'b2', 'y4'], 'p2 drew a card');
    assert.equal(game.timeouts.get('p2'), 1);
    assert.equal(game.players[game.turn], 'p3');
    assert.match(latest(), /⌛ <@p2> ran out of time and drew a card/);

    // Playing resets the count
    game.timeouts.set('p3', 2);
    game.timeouts.set('p1', 2);
    settings.turnSeconds = 0.15;
    await tap(game, 'p3', 'play', 'g1');
    settings.turnSeconds = 60;
    assert.equal(game.timeouts.get('p3'), 0);

    // p1 runs out of time a third turn in a row: out, and their cards go to the bottom of the deck
    await wait(400);
    assert.deepEqual(game.players, ['p2', 'p3']);
    assert.deepEqual(game.deck.slice(0, 2), ['r2', 'r3']);
    assert.equal(game.players[game.turn], 'p2', 'the next player takes over');
    assert.match(latest(), /<@p1> ran out of time 3 turns in a row and is out/);
    assert.match(latest(), /Out: <@p1> timed out/);
    assert.match(notice(await click(game, 'p1', 'hand')), /out of this game/);

    // p3 too: p2 is the last player left and wins (no runner-up when nobody else is left)
    game.timeouts.set('p3', 2);
    settings.turnSeconds = 0.15;
    await tap(game, 'p2', 'play', 'b1');
    settings.turnSeconds = 60;
    await wait(400);
    assert.equal(games.size, 0);
    assert.match(latest(), /<@p2> is the last player left and wins!/);
    assert.equal(await balanceOf('p2'), 0, 'nobody was beaten (they left or were removed), so the win pays nothing');
    assert.equal(await balanceOf('p3'), 0);
});

test('crazy eights: leaving mid-game puts your cards back in the deck; the last player left wins', async () => {
    const game = await startGame();
    deal(game, { hands: { p1: ['r1', 'r2'], p2: ['b1', 'b2', 'b3'], p3: ['g1'] }, top: 'r5', deck: ['y1'] });

    assert.match(viewOf(await tap(game, 'p1', 'quit')), /Leave the game\?/);
    assert.ok(game.players.includes('p1'), 'nothing happens until it\'s confirmed');
    assert.match(viewOf(await tap(game, 'p1', 'quitYes')), /You left the game/);
    assert.deepEqual(game.players, ['p2', 'p3']);
    assert.deepEqual(game.deck, ['r1', 'r2', 'y1']);
    assert.equal(game.players[game.turn], 'p2', 'it was p1\'s turn, so it passes on');
    assert.match(latest(), /🚪 <@p1> left the game/);
    assert.match(notice(await click(game, 'p1', 'hand')), /out of this game/);
    assert.match(viewOf(await tap(game, 'p1', 'draw')), /out of this game/, 'their old private view no longer works');

    await tap(game, 'p3', 'quit');
    await tap(game, 'p3', 'quitYes');
    assert.equal(games.size, 0);
    assert.match(latest(), /<@p2> is the last player left and wins!/);
    assert.match(latest(), /🚪 <@p1> · left/);
    assert.equal(await balanceOf('p2'), 0, 'nobody was beaten (they left or were removed), so the win pays nothing');
    assert.equal(await balanceOf('p1'), 0);
    assert.equal(await balanceOf('p3'), 0);
});

test('crazy eights: first to empty their hand wins; with 3+ players the fewest cards left gets the runner-up prize', async () => {
    const r = gameConfig.REWARDS.crazyEights;
    const game = await startGame();
    deal(game, { hands: { p1: ['r7', 'b1'], p2: ['b7', 'b2', 'b3'], p3: ['g4', 'g5', 'g6', 'g8'] }, top: 'r5', deck: ['y9'] });

    await tap(game, 'p1', 'play', 'r7');
    assert.match(latest(), /<@p1> · \*\*1 card!\*\*/);
    await tap(game, 'p2', 'play', 'b7');
    await tap(game, 'p3', 'draw'); // 🟨9 doesn't match
    const won = viewOf(await tap(game, 'p1', 'play', 'b1'));
    assert.match(won, /You played your last card and won!/);

    assert.equal(games.size, 0);
    assert.equal(game.state, 'over');
    const final = latest();
    assert.match(final, /Game over/);
    assert.match(final, /<@p1> played their last card and wins!/);
    const p1 = winnerReward('crazyEights', 3);
    assert.equal(p1, r.winner + 2 * r.perOpponent);
    assert.match(final, new RegExp(`🏆 <@p1> · 0 cards · \\+${p1} 🪙`));
    assert.match(final, new RegExp(`<@p2> · 2 cards · \\+${r.runnerUp} 🪙`));
    assert.match(final, /<@p3> · 5 cards"/);
    assert.equal(await balanceOf('p1'), p1);
    assert.equal(await balanceOf('p2'), r.runnerUp);
    assert.equal(await balanceOf('p3'), 0);
    assert.match(notice(await click(game, 'p2', 'hand')), /This game has ended/);

    // A tie for the fewest cards: both get the runner-up prize
    const tie = await startGame(['q1', 'q2', 'q3']);
    deal(tie, { hands: { q1: ['r1'], q2: ['b2', 'b3'], q3: ['g2', 'g3'] }, top: 'r5' });
    await tap(tie, 'q1', 'play', 'r1');
    assert.equal(await balanceOf('q1'), p1);
    assert.equal(await balanceOf('q2'), r.runnerUp);
    assert.equal(await balanceOf('q3'), r.runnerUp);
});

test('crazy eights: an out-of-date private view is checked and refreshed', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { hands: { p1: ['rd', 'r3', 'w'], p2: ['r8', 'b8'] }, top: 'r5', deck: ['y1', 'y2'] });

    const early = text((await click(game, 'p2', 'hand')).replies[0]);
    assert.match(early, /<@p1>'s turn/);
    assert.match(early, /Your hand · 2 cards/);

    await tap(game, 'p1', 'play', 'rd'); // p2 draws 2 and loses their turn
    const stale = viewOf(await tap(game, 'p2', 'play', 'r8'));
    assert.match(stale, /It's <@p1>'s turn, not yours/);
    assert.match(stale, /Your hand · 4 cards/);
    assert.match(viewOf(await tap(game, 'p2', 'view')), /🟥8 🟦8 🟨1 🟨2/);

    // A color choice left open after the turn moved on is refused
    assert.match(viewOf(await tap(game, 'p1', 'play', 'w')), /Choose a color/);
    await tap(game, 'p1', 'play', 'r3');
    assert.match(viewOf(await tap(game, 'p1', 'color', 'w', ['g'])), /It's <@p2>'s turn, not yours/);
    assert.deepEqual(game.hands.get('p1'), ['w']);
    assert.equal(game.pile.at(-1), 'r3');
});

test('crazy eights: the game message and private views fit Discord\'s limits with 8 players and a big hand', async () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const game = await startGame(players);
    const check = (payload, what) => {
        const { count, textLength, ids } = inspectPanel(payload);
        assert.ok(count <= 40 && textLength <= 4000, `${what}: ${count} components, ${textLength} characters`);
        assert.equal(new Set(ids).size, ids.length, `${what}: duplicate custom_id`);
        for (const id of ids) assert.ok(id.length <= 100, `${what}: ${id} is too long`);
    };
    screens.forEach((s, n) => check(s, `screen ${n}`)); // the lobby filling up, and the first turn

    // Every kind of card (54), and as many as possible can be played on 🟥5
    const big = [...'0123456789', 's', 'r', 'd'].flatMap(v => ['r', 'b', 'g', 'y'].map(c => `${c}${v}`)).concat('w', 'w4');
    deal(game, { hands: { p1: big, ...Object.fromEntries(players.slice(1).map(p => [p, Array(13).fill('y7')])) }, top: 'r5' });
    game.log = ['<@100000000000000001> played 🌈+4 · color 🟦 · <@100000000000000002> draws 4 and is skipped'].concat(Array(2).fill('⌛ <@100000000000000003> ran out of time 3 turns in a row and is out'));
    check(crazyEights.render(game), 'board');

    const hand = (await click(game, 'p1', 'hand')).replies[0];
    check(hand, 'hand');
    assert.equal(text(hand).match(/:play:/g).length, 13 + 3 + 2, 'every red card, the other 5s and both wilds');
    check((await tap(game, 'p1', 'play', 'w4')).views.at(-1), 'color choice');
    check((await tap(game, 'p8', 'quit')).views.at(-1), 'leave');
    check((await tap(game, 'p8', 'view')).views.at(-1), 'someone else\'s turn');

    game.hands.set('p1', ['r9']);
    await tap(game, 'p1', 'play', 'r9');
    assert.equal(games.size, 0);
    check(screens.at(-1), 'final board');
});
