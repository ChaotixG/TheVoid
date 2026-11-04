const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Short timers so lobbies and turns can be played through quickly
const gameConfig = require('../src/config/games');
gameConfig.LOBBY_SECONDS = 0.4;
Object.assign(gameConfig.PARTY.wordChain, { turnSeconds: 0.5, minTurnSeconds: 0.25 });

const Wallet = require('../src/models/Wallet');
const { games } = require('../src/features/games/sessions');
const chat = require('../src/features/games/chat');
const router = require('../src/events/interactionCreate/router');
const wordChain = require('../src/features/games/wordChain');
const { winnerReward } = require('../src/features/games/scoring');

const stopTimers = () => { for (const g of games.values()) clearTimeout(g.timer); };
before(startDatabase);
after(async () => { stopTimers(); await stopDatabase(); });
beforeEach(async () => {
    await clearDatabase();
    stopTimers();
    games.clear();
    chat.listening.clear();
});

const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;
const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 3000) {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) throw new Error('Timed out waiting');
        await wait(20);
    }
}

// Every edit of the shared game message, from any interaction, in order
let screens = [];
beforeEach(() => { screens = []; });
const latest = () => text(screens.at(-1));

// A stand-in interaction on the /games message (m1) in channel c1, which the bot can see unless told otherwise
function fake({ userId = 'p1', customId, canSee = true, messageId = 'm1' } = {}) {
    const calls = { replies: [] };
    const i = {
        user: { id: userId }, guildId: 'g1', channelId: 'c1', customId,
        guild: { members: { me: {} } },
        channel: { permissionsFor: () => ({ has: () => canSee }) },
        message: { id: messageId, edit: async (p) => { screens.push(p); } },
        createdTimestamp: Date.now(),
        client: { user: { id: 'me' } },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => true, isModalSubmit: () => false, isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); i.replied = true; },
        update: async (p) => { screens.push(p); i.replied = true; },
        deferUpdate: async () => { i.deferred = true; },
        editReply: async (p) => { screens.push(p); },
        followUp: async (p) => { calls.replies.push(p); },
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

// A chat message in c1; returns the reactions the bot added
async function say(userId, content) {
    const reactions = [];
    await chat.handleMessage({ author: { id: userId }, content, channelId: 'c1', react: async (emoji) => { reactions.push(emoji); } });
    return reactions;
}

async function startGame(players = ['p1', 'p2']) {
    await press(`games:start:${players[0]}:wordChain:`, players[0]);
    const game = onlyGame();
    for (const id of players.slice(1)) await click(game, id, 'join');
    return game;
}

test('word chain: only the current player\'s words count; wrong, short, made-up and used words are refused', async () => {
    const game = await startGame();
    assert.equal(game.state, 'lobby');
    assert.deepEqual(await say('p1', 'apple'), [], 'chat is ignored in the lobby');

    await click(game, 'p1', 'begin');
    assert.equal(game.state, 'playing');
    assert.equal(game.current, 'p1', 'the host goes first');
    assert.ok(!'qxz'.includes(game.letter), 'never starts on q, x or z');
    assert.match(latest(), /Next word starts with \*\*[A-Z]\*\*/);
    game.letter = 'a';

    assert.deepEqual(await say('p2', 'apple'), [], 'not their turn');
    assert.deepEqual(await say('p3', 'apple'), [], 'not playing');
    assert.deepEqual(await say('p1', 'banana'), ['❌'], 'wrong first letter');
    assert.deepEqual(await say('p1', 'at'), ['❌'], 'too short');
    assert.deepEqual(await say('p1', 'asdfgh'), ['❌'], 'not a word');
    assert.deepEqual(await say('p1', 'apple pie'), ['❌'], 'one word only');
    assert.equal(game.current, 'p1', 'they can keep trying');

    assert.deepEqual(await say('p1', '  Apple '), ['✅']);
    assert.equal(game.current, 'p2');
    assert.equal(game.letter, 'e');
    assert.match(latest(), /🔗 \*\*apple\*\* · <@p1>/);
    assert.match(latest(), /starts with \*\*E\*\*/);

    assert.deepEqual(await say('p2', 'eagle'), ['✅']);
    assert.equal(game.current, 'p1');
    assert.equal(game.lap, 2, 'a full round of turns was played');
    assert.deepEqual(await say('p1', 'eagle'), ['❌'], 'already used');
    assert.deepEqual(await say('p1', 'elephant'), ['✅']);
    assert.deepEqual(game.chain.map(c => c.word), ['apple', 'eagle', 'elephant']);
});

test('word chain: turns get 2s shorter each round, down to the minimum', () => {
    const saved = { ...gameConfig.PARTY.wordChain };
    Object.assign(gameConfig.PARTY.wordChain, { turnSeconds: 30, minTurnSeconds: 10 });
    try {
        assert.deepEqual([1, 2, 3, 11, 12, 50].map(wordChain.turnSeconds), [30, 28, 26, 10, 10, 10]);
    } finally {
        Object.assign(gameConfig.PARTY.wordChain, saved);
    }
});

test('word chain: running out of time puts you out; the last one in wins and words are paid', async () => {
    const game = await startGame(['p1', 'p2', 'p3']);
    await click(game, 'p1', 'begin');
    game.letter = 'a';
    assert.deepEqual(await say('p1', 'apple'), ['✅']);

    await until(() => game.current === 'p3'); // p2 never answers
    assert.deepEqual(game.alive, ['p1', 'p3']);
    assert.match(latest(), /<@p2> ran out of time and is out/);
    assert.equal(game.letter, 'e', 'the next player needs the same letter');
    assert.deepEqual(await say('p2', 'egg'), [], 'out players can\'t play');

    assert.deepEqual(await say('p3', 'egg'), ['✅']);
    assert.equal(game.lap, 2);
    assert.ok(game.turnEndsAt - Date.now() <= 250, 'the second round has shorter turns');
    assert.deepEqual(await say('p1', 'grape'), ['✅']);

    await until(() => game.state === 'over' && screens.length && /Game over/.test(latest())); // p3 runs out of time
    assert.equal(games.size, 0);
    assert.equal(chat.chatGameIn('c1'), null, 'the channel is free again');
    const p1Coins = 2 + winnerReward('wordChain', 3);
    assert.match(latest(), /<@p1> is the last one in and wins/);
    assert.match(latest(), new RegExp(`🥇 <@p1> · 2 words · \\+${p1Coins} 🪙`));
    assert.match(latest(), /🥈 <@p3> · 1 word · \+1 🪙/);
    assert.match(latest(), /🥉 <@p2> · 0 words/);
    assert.equal(await balanceOf('p1'), p1Coins);
    assert.equal(await balanceOf('p3'), 1);
    assert.equal(await balanceOf('p2'), 0);
});

test('word chain: coins per word stop at the most words counted', async () => {
    const game = await startGame();
    await click(game, 'p1', 'begin');
    game.words.set('p1', 25); // more than maxWords
    await click(game, 'p1', 'end');
    assert.equal(await balanceOf('p1'), gameConfig.REWARDS.wordChain.maxWords * gameConfig.REWARDS.wordChain.perWord);
});

test('word chain: the host can end it early; words so far are paid, with no winner', async () => {
    const game = await startGame();
    await click(game, 'p1', 'begin');
    game.letter = 'a';
    await say('p1', 'apple');
    assert.match(notice(await click(game, 'p2', 'end')), /Only the host/);
    await click(game, 'p1', 'end');
    assert.equal(games.size, 0);
    assert.match(latest(), /ended the game early/);
    assert.doesNotMatch(latest(), /wins/);
    assert.equal(await balanceOf('p1'), 1);
    assert.match(notice(await click(game, 'p1', 'end')), /This game has ended/);
});

test('word chain: refused where the bot can\'t read chat, or where a chat game is already running', async () => {
    assert.match(notice(await press('games:start:p1:wordChain:', 'p1', { canSee: false })), /can't see messages/);
    assert.equal(games.size, 0, 'the menu stays a menu');

    await press('games:start:p1:wordChain:', 'p1');
    assert.equal(games.size, 1);
    assert.match(notice(await press('games:start:p2:scramble:', 'p2', { messageId: 'm2' })), /already running in this channel/); // another menu
    assert.equal(games.size, 1);

    await click(onlyGame(), 'p1', 'cancel');
    await press('games:start:p2:scramble:', 'p2');
    assert.equal(onlyGame().type, 'scramble', 'free again once the game is over');
});

test('word chain: boards fit Discord\'s limits with the most players', async () => {
    const { maxPlayers } = gameConfig.PARTY.wordChain;
    const ids = Array.from({ length: maxPlayers }, (_, n) => `2000000000000000${String(n).padStart(2, '0')}`);
    const game = await startGame(ids);
    assert.equal(game.players.length, maxPlayers);
    await click(game, ids[0], 'begin');
    game.chain = Array.from({ length: 40 }, (_, n) => ({ word: `extraordinarily${n}`, userId: ids[n % maxPlayers] }));
    game.news = `⏰ <@${ids[3]}> ran out of time and is out!`;
    for (const payload of [wordChain.render(game), screens.at(-1)]) {
        const { count, textLength } = inspectPanel(payload);
        assert.ok(count <= 40 && textLength <= 4000, `${count} components, ${textLength} characters`);
    }
    await click(game, ids[0], 'end');
    const { count, textLength } = inspectPanel(screens.at(-1));
    assert.ok(count <= 40 && textLength <= 4000, `final: ${count} components, ${textLength} characters`);
});
