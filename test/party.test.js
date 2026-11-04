const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Short timers so lobbies and rounds can be played through quickly
const gameConfig = require('../src/config/games');
gameConfig.LOBBY_SECONDS = 0.4;
Object.assign(gameConfig.PARTY.triviaParty, { questions: 2, answerSeconds: 0.4, revealSeconds: 0.1 });

const Wallet = require('../src/models/Wallet');
const { games } = require('../src/features/games/sessions');
const router = require('../src/events/interactionCreate/router');
const menu = require('../src/features/games/menu');
const trivia = require('../src/features/games/trivia');
const chat = require('../src/features/games/chat');

before(startDatabase);
after(stopDatabase);
beforeEach(async () => {
    await clearDatabase();
    for (const g of games.values()) { clearTimeout(g.timer); clearTimeout(g.refresh); }
    games.clear();
    chat.listening.clear();
});

const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;
const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Every edit of the shared game message, from any interaction, in order
let screens = [];
beforeEach(() => { screens = []; });
const latest = () => text(screens.at(-1));

// A stand-in interaction on the /games message (m1) that records what the bot answered
function fake({ userId = 'p1', customId, values, users, options = {}, messageId = 'm1' } = {}) {
    const calls = { replies: [], shown: [] };
    const show = (p) => { calls.shown.push(p); screens.push(p); };
    const i = {
        user: { id: userId }, guildId: 'g1', channelId: 'c1', customId, values, users,
        guild: { members: { me: {} } }, channel: { permissionsFor: () => ({ has: () => true }) },
        message: { id: messageId, edit: async (p) => show(p) },
        createdTimestamp: Date.now(),
        client: { user: { id: 'me' } },
        options: { getString: (n) => options[n] ?? null },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => true, isModalSubmit: () => false, isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); i.replied = true; return { resource: { message: { id: messageId } } }; },
        update: async (p) => { show(p); i.replied = true; },
        deferUpdate: async () => { i.deferred = true; },
        editReply: async (p) => { show(p); },
        followUp: async (p) => { calls.replies.push(p); },
        deleteReply: async () => { calls.deleted = true; },
    };
    return { i, calls };
}
const press = async (customId, userId = 'p1', extra = {}) => {
    const f = fake({ userId, customId, ...extra });
    await router(null, f.i);
    return f.calls;
};
const click = (game, userId, action, arg = '') => press(`game:${game.id}:${action}:${arg}`, userId);
const onlyGame = () => [...games.values()][0];
const notice = (calls) => calls.replies[0]?.content;

// Trivia questions without the network: every right answer is "Right" (the pool is reused between
// tests, which also avoids waiting out the question site's 5-second gap between requests)
function stubQuestions() {
    const encode = (s) => encodeURIComponent(s);
    const realFetch = global.fetch;
    global.fetch = async () => ({ json: async () => ({ response_code: 0, results: Array.from({ length: 50 }, (_, n) => ({ category: encode('General'), difficulty: 'easy', question: encode(`Q${n}?`), correct_answer: encode('Right'), incorrect_answers: ['W1', 'W2', 'W3'].map(encode) })) }) });
    return () => { global.fetch = realFetch; };
}

// ─── /games menu ──────────────────────────────────────────────
test('games menu: only its opener can use it; setting up a game shows its choices; it fits Discord\'s limits', async () => {
    const opened = fake({ userId: 'p1', options: { game: 'trivia' } });
    await menu.openMenu(opened.i);
    assert.match(text(opened.calls.replies[0]), /Multiple-choice questions/, 'opens on the game asked for');

    assert.match(notice(await press('games:tab:p1:party', 'p2')), /isn't yours/);
    await press('games:setup:p1:connect4', 'p1');
    assert.match(latest(), /Opponent:\*\* me 🤖/);

    // Picking yourself is refused; picking someone sets the opponent
    await press('games:opp:p1:connect4:bot', 'p1', { users: new Collection([['p1', { id: 'p1', bot: false }]]) });
    assert.match(latest(), /can't challenge yourself/);
    const friend = '200000000000000002';
    await press('games:opp:p1:connect4:bot', 'p1', { users: new Collection([[friend, { id: friend, bot: false }]]) });
    assert.match(latest(), new RegExp(`games:start:p1:connect4:${friend}`));

    // Options travel in the custom IDs
    const entry = menu.CATALOG.find(g => g.id === 'trivia');
    assert.deepEqual(menu.decode(entry, menu.encode(entry, { mode: 'race', difficulty: 'hard' })), { mode: 'race', difficulty: 'hard' });
    assert.deepEqual(menu.decode(entry, 'junk.junk'), { mode: 'solo', difficulty: 'any' }, 'unknown values fall back to the defaults');

    const views = [...['solo', 'versus', 'party'].map(tab => ({ tab })), ...menu.CATALOG.map(c => ({ gameId: c.id }))];
    for (const view of views) {
        const { count, textLength, ids } = inspectPanel(menu.renderMenu('p1', { ...view, coinsToday: 120, notice: 'A notice' }));
        const label = view.tab ?? view.gameId;
        assert.ok(count <= 40 && textLength <= 4000, `${label}: ${count} components, ${textLength} characters`);
        assert.equal(new Set(ids).size, ids.length, `${label}: duplicate custom_id`);
    }
});

test('games menu: tabs list their games; Play starts a game in one click; today\'s game coins are shown', async () => {
    await Wallet.create({ userId: 'p1', gameDay: new Date().toISOString().slice(0, 10), gameEarned: 120 });
    await press('games:tab:p1:party', 'p1');
    assert.match(latest(), /Crazy Eights/);
    assert.doesNotMatch(latest(), /Wordle/);
    assert.match(latest(), /game coins today: 120\/500/);
    await press('games:setup:p1:trivia', 'p1');
    assert.match(latest(), /games:back:p1:solo/, 'Back returns to the game\'s tab');
    await press('games:play:p1:wordle', 'p1');
    assert.equal(onlyGame().type, 'wordle');
});

test('games menu: Start turns the menu into the game, and a challenge pings the opponent', async () => {
    const friend = '200000000000000002'; // opponents are real user IDs
    const started = await press(`games:start:p1:connect4:${friend}`, 'p1');
    const game = onlyGame();
    assert.equal(game.type, 'connect4');
    assert.deepEqual(game.players, ['p1', friend]);
    assert.match(latest(), /challenges you/);
    assert.deepEqual(started.replies[0].allowedMentions, { users: [friend] }, 'edits don\'t notify, so the ping is a new message');
});

test('games menu: a second Start click doesn\'t start a second game; a refused start leaves the menu to its cleanup', async () => {
    await Promise.all([press('games:start:p1:triviaParty:any', 'p1'), press('games:start:p1:triviaParty:any', 'p1')]);
    await press('games:start:p1:triviaParty:any', 'p1');
    assert.equal(games.size, 1, 'one game on the message');

    // Scramble claims channel c1, so a second chat game there is refused with a private notice,
    // and the menu stays until its cleanup removes it
    await press('games:start:p1:scramble:', 'p1', { messageId: 'm3' });
    gameConfig.MENU_MINUTES = 0.01;
    try {
        const opened = fake({ userId: 'p2', messageId: 'm2' });
        await menu.openMenu(opened.i);
        const refused = await press('games:start:p2:scramble:', 'p2', { messageId: 'm2' });
        assert.match(notice(refused), /already running/);
        await wait(800);
        assert.equal(refused.deleted, true, 'Start was acknowledged on the menu, so that click removes it later');
    } finally {
        gameConfig.MENU_MINUTES = 5;
    }
});

test('chat games: two started in one channel at the same moment get one lobby', async () => {
    const [a, b] = await Promise.all([press('games:start:p1:scramble:', 'p1'), press('games:start:p2:scramble:', 'p2', { messageId: 'm2' })]);
    assert.equal(games.size, 1);
    assert.match(`${notice(a)} ${notice(b)}`, /already running in this channel/);
});

// ─── Lobbies ──────────────────────────────────────────────────
test('lobby: join and leave, host-only start, the host passes on, and it calls itself off when too few join', async () => {
    await press('games:start:p1:triviaParty:any', 'p1');
    const game = onlyGame();
    assert.equal(game.state, 'lobby');
    assert.match(latest(), /Players · 1\/20/);

    assert.match(notice(await click(game, 'p1', 'join')), /already in/);
    assert.match(notice(await click(game, 'p1', 'begin')), /At least 2 players/);
    await click(game, 'p2', 'join');
    await click(game, 'p3', 'join');
    assert.match(latest(), /Players · 3\/20/);
    assert.match(notice(await click(game, 'p2', 'begin')), /Only the host/);
    assert.match(notice(await click(game, 'p2', 'answer', 0)), /hasn't started yet/);

    await click(game, 'p1', 'leave');
    assert.equal(game.host, 'p2', 'the next player becomes host');
    await click(game, 'p3', 'leave');
    assert.match(latest(), /needs at least 2 players/);

    await wait(600); // the lobby runs out with one player
    assert.equal(games.size, 0);
    assert.match(latest(), /Not enough players joined/);
});

// ─── Trivia Party ─────────────────────────────────────────────
test('trivia party: everyone answers privately; fast right answers score most; coins by score with a winner bonus', async () => {
    const restore = stubQuestions();
    try {
        await press('games:start:p1:triviaParty:any', 'p1');
        const game = onlyGame();
        await click(game, 'p2', 'join');
        await click(game, 'p1', 'begin');
        assert.equal(game.state, 'asking');
        assert.match(latest(), /Question 1\/2/);

        const right = game.question.answers.indexOf('Right');
        const wrong = game.question.answers.findIndex(a => a !== 'Right');
        assert.match(notice(await click(game, 'p3', 'answer', right)), /not in this game/);
        assert.match(notice(await click(game, 'p1', 'answer', right)), /Locked in/);
        assert.match(notice(await click(game, 'p1', 'answer', wrong)), /already answered/);
        await click(game, 'p2', 'answer', wrong); // everyone has answered: revealed right away
        assert.equal(game.state, 'revealed');
        assert.match(latest(), /Got it: <@p1> \+1\d\d/);

        await wait(250); // next question
        assert.equal(game.round, 2);
        await click(game, 'p1', 'answer', game.question.answers.indexOf('Right'));
        await wait(600); // p2 never answers: time runs out, and that was the last question
        assert.equal(game.state, 'over');
        assert.equal(games.size, 0);
        assert.match(latest(), /Final scores/);
        assert.match(latest(), /🥇 <@p1>.*2\/2 right/);

        const r = gameConfig.REWARDS.triviaParty;
        const p1 = await balanceOf('p1');
        assert.ok(p1 >= 2 * r.perCorrect + r.winnerBonus && p1 <= 2 * (r.perCorrect + r.speedBonus) + r.winnerBonus, `p1 got ${p1}`);
        assert.equal(await balanceOf('p2'), 0, 'no right answers, no coins');
    } finally {
        restore();
    }
});

test('trivia party: the host can end it early, and scores so far are paid', async () => {
    const restore = stubQuestions();
    try {
        await press('games:start:p1:triviaParty:any', 'p1');
        const game = onlyGame();
        await click(game, 'p2', 'join');
        await click(game, 'p1', 'begin');
        await click(game, 'p2', 'answer', game.question.answers.indexOf('Right'));
        assert.match(notice(await click(game, 'p2', 'end')), /Only the host/);
        await click(game, 'p1', 'end');
        assert.equal(games.size, 0);
        assert.match(latest(), /ended the game early/);
        assert.equal(await balanceOf('p2'), 0, 'the question wasn\'t revealed, so it doesn\'t count');
    } finally {
        restore();
    }
});
