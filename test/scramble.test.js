const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Short timers so lobbies and rounds can be played through quickly
const gameConfig = require('../src/config/games');
gameConfig.LOBBY_SECONDS = 0.4;
Object.assign(gameConfig.PARTY.scramble, { rounds: 3, roundSeconds: 0.6, pauseSeconds: 0.1 });

const Wallet = require('../src/models/Wallet');
const GameStats = require('../src/models/GameStats');
const { games } = require('../src/features/games/sessions');
const chat = require('../src/features/games/chat');
const router = require('../src/events/interactionCreate/router');
const scramble = require('../src/features/games/scramble');
const { SCRAMBLE_WORDS, isWord } = require('../src/features/games/words');

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
// { userId: { played, wins, best } } for this game
const stats = async () => Object.fromEntries((await GameStats.find({ game: 'scramble' }).lean()).map(r => [r.userId, { played: r.played, wins: r.wins, best: r.best }]));
const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 3000) {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) throw new Error('Timed out waiting');
        await wait(20);
    }
}
const spaced = (word) => [...word.toUpperCase()].join(' ');
const sorted = (word) => [...word].sort().join('');

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
    await press(`games:start:${players[0]}:scramble:`, players[0]);
    const game = onlyGame();
    for (const id of players.slice(1)) await click(game, id, 'join');
    return game;
}

// A guess of the right length that isn't the word or another word from its letters
const wrongGuess = (word) => 'z'.repeat(word.length);

test('scramble: the words are common dictionary words of 5 to 8 letters', () => {
    assert.ok(SCRAMBLE_WORDS.length >= 100);
    assert.equal(new Set(SCRAMBLE_WORDS).size, SCRAMBLE_WORDS.length, 'no duplicates');
    for (const word of SCRAMBLE_WORDS) assert.ok(/^[a-z]{5,8}$/.test(word) && isWord(word), word);
});

test('scramble: a scramble uses the same letters, never shows the word, and isn\'t another real word', () => {
    for (const word of SCRAMBLE_WORDS) {
        const mixed = scramble.scramble(word);
        assert.notEqual(mixed, word);
        assert.equal(sorted(mixed), sorted(word));
        assert.ok(!isWord(mixed), `${word} → ${mixed}`);
    }
    assert.ok(scramble.isAnswer('earth', 'earth'));
    assert.ok(scramble.isAnswer('earth', 'heart'), 'another real word from the same letters counts');
    assert.ok(!scramble.isAnswer('earth', 'ehtar'), 'not a word');
    assert.ok(!scramble.isAnswer('earth', 'earths'));
});

test('scramble: the first right answer scores; wrong answers and chat don\'t; hints, time\'s up, a tie shares the win', async () => {
    const game = await startGame();
    assert.deepEqual(await say('p1', 'anything'), [], 'chat is ignored in the lobby');
    await click(game, 'p1', 'begin');
    assert.equal(game.state, 'asking');
    assert.notEqual(game.scrambled, game.word);
    assert.match(latest(), /Round 1\/3/);
    assert.ok(latest().includes(`### ${spaced(game.scrambled)}`));
    assert.match(latest(), /No words yet/);

    const word = game.word;
    assert.deepEqual(await say('p1', wrongGuess(word)), ['❌']);
    assert.deepEqual(await say('p1', 'is it a fruit?'), [], 'other chat is left alone');
    assert.deepEqual(await say('p3', word), [], 'not playing');
    assert.equal(game.state, 'asking');

    assert.deepEqual(await say('p2', `  ${word.toUpperCase()} `), ['✅']);
    assert.equal(game.state, 'revealed');
    assert.equal(game.scores.get('p2'), 1);
    assert.match(latest(), /✅ <@p2> got it!/);
    assert.match(latest(), /1\. <@p2> 1/);
    assert.deepEqual(await say('p1', word), [], 'too late: the round is over');
    assert.equal(game.scores.get('p1'), 0);

    // Round 2: nobody gets it; the first letter is given away halfway
    await until(() => game.round === 2 && game.state === 'asking');
    assert.notEqual(game.word, word, 'no word comes up twice');
    await until(() => game.hint);
    assert.match(latest(), new RegExp(`It starts with \\*\\*${game.word[0].toUpperCase()}\\*\\*`));
    await until(() => game.state === 'revealed');
    assert.match(latest(), /Time's up! Nobody got it/);
    assert.ok(latest().includes(`### ${spaced(game.word)}`), 'the word is shown');

    // Round 3: p1 evens the score, so both share the winner bonus
    await until(() => game.round === 3 && game.state === 'asking');
    assert.deepEqual(await say('p1', game.word), ['✅']);
    await until(() => /Final scores/.test(latest()));
    assert.equal(games.size, 0);
    assert.equal(chat.chatGameIn('c1'), null, 'the channel is free again');
    const { perWord, winnerBonus } = gameConfig.REWARDS.scramble;
    assert.match(latest(), new RegExp(`<@p2> · 1 word · \\+${perWord + winnerBonus} 🪙`));
    assert.equal(await balanceOf('p1'), perWord + winnerBonus);
    assert.equal(await balanceOf('p2'), perWord + winnerBonus);
    assert.deepEqual(await stats(), { p1: { played: 1, wins: 1, best: 1 }, p2: { played: 1, wins: 1, best: 1 } }, 'a tie: both win');
});

test('scramble: the top scorer alone takes the bonus; no words, no coins', async () => {
    const game = await startGame(['p1', 'p2', 'p3']);
    await click(game, 'p1', 'begin');
    assert.deepEqual(await say('p3', game.word), ['✅']);
    await until(() => game.round === 2 && game.state === 'asking');
    assert.deepEqual(await say('p3', game.word), ['✅']);
    await until(() => game.round === 3 && game.state === 'asking');
    assert.deepEqual(await say('p2', game.word), ['✅']);
    await until(() => /Final scores/.test(latest()));
    const { perWord, winnerBonus } = gameConfig.REWARDS.scramble;
    assert.match(latest(), /🥇 <@p3> · 2 words/);
    assert.equal(await balanceOf('p3'), 2 * perWord + winnerBonus);
    assert.equal(await balanceOf('p2'), perWord);
    assert.equal(await balanceOf('p1'), 0);
    assert.deepEqual(await stats(), {
        p1: { played: 1, wins: 0, best: 0 },
        p2: { played: 1, wins: 0, best: 1 },
        p3: { played: 1, wins: 1, best: 2 },
    }, 'recorded once, with words solved as the score');
});

test('scramble: the host can end it early, and words so far are paid', async () => {
    const game = await startGame();
    await click(game, 'p1', 'begin');
    await say('p2', game.word);
    await until(() => game.round === 2 && game.state === 'asking');
    assert.match(notice(await click(game, 'p2', 'end')), /Only the host/);
    await click(game, 'p1', 'end');
    assert.equal(games.size, 0);
    assert.match(latest(), /ended the game early/);
    assert.match(latest(), new RegExp(`The last word was \\*\\*${game.word.toUpperCase()}\\*\\*`));
    const { perWord, winnerBonus } = gameConfig.REWARDS.scramble;
    assert.equal(await balanceOf('p2'), perWord + winnerBonus, 'the leader gets the bonus, like Trivia Party');
    assert.deepEqual(await say('p2', game.word), [], 'messages are ignored once it\'s over');
    assert.deepEqual(await stats(), { p1: { played: 1, wins: 0, best: 0 }, p2: { played: 1, wins: 1, best: 1 } });
});

test('scramble: refused where the bot can\'t read chat, or where a chat game is already running', async () => {
    assert.match(notice(await press('games:start:p1:scramble:', 'p1', { canSee: false })), /can't see messages/);
    assert.equal(games.size, 0);
    await press('games:start:p1:scramble:', 'p1');
    assert.match(notice(await press('games:start:p2:wordChain:', 'p2', { messageId: 'm2' })), /already running in this channel/); // another menu
    assert.equal(games.size, 1);
    await click(onlyGame(), 'p1', 'cancel');
    assert.deepEqual(await stats(), {}, 'a called-off lobby isn\'t a game played');
});

test('scramble: boards fit Discord\'s limits with the most players', async () => {
    const { maxPlayers } = gameConfig.PARTY.scramble;
    const ids = Array.from({ length: maxPlayers }, (_, n) => `2000000000000000${String(n).padStart(2, '0')}`);
    const game = await startGame(ids);
    assert.equal(game.players.length, maxPlayers);
    await click(game, ids[0], 'begin');
    ids.forEach((id, n) => game.scores.set(id, n + 1));
    game.hint = true;
    const check = (payload, label) => {
        const { count, textLength } = inspectPanel(payload);
        assert.ok(count <= 40 && textLength <= 4000, `${label}: ${count} components, ${textLength} characters`);
    };
    check(scramble.render(game), 'asking');
    await say(ids[5], game.word);
    check(screens.at(-1), 'revealed');
    await click(game, ids[0], 'end');
    check(screens.at(-1), 'final');
});
