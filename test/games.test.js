const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startDatabase, stopDatabase, clearDatabase } = require('./helpers');

// Short trivia timer so the time-out path can be tested quickly
const gameConfig = require('../src/config/games');
gameConfig.TRIVIA_SECONDS = 0.3;

const fs = require('fs');
const Wallet = require('../src/models/Wallet');
const { payGameReward } = require('../src/features/games/rewards');
const { games } = require('../src/features/games/sessions');
const router = require('../src/events/interactionCreate/router');
const tictactoe = require('../src/features/games/tictactoe');
const connect4 = require('../src/features/games/connect4');
const wordle = require('../src/features/games/wordle');
const hangman = require('../src/features/games/hangman');
const minesweeper = require('../src/features/games/minesweeper');
const memory = require('../src/features/games/memory');
const trivia = require('../src/features/games/trivia');
const { WORDLE_ANSWERS, HANGMAN_WORDS } = require('../src/features/games/words');
const scoring = require('../src/features/games/scoring');

before(startDatabase);
after(stopDatabase);
beforeEach(async () => { await clearDatabase(); games.clear(); });

const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;
const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));

// A stand-in interaction that records what the bot answered
function fake({ userId = 'p1', customId, values, fields = {}, options = {} } = {}) {
    const calls = { replies: [], shown: [], modals: [] };
    const i = {
        user: { id: userId }, guildId: 'g1', customId, values,
        client: { user: { id: 'me' } },
        options: { getUser: (n) => options[n] ?? null, getString: (n) => options[n] ?? null },
        fields: { getTextInputValue: (id) => fields[id] },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => !fields.word, isModalSubmit: () => Boolean(fields.word), isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); i.replied = true; },
        update: async (p) => { calls.shown.push(p); },
        deferUpdate: async () => { i.deferred = true; },
        deferReply: async () => { i.deferred = true; },
        editReply: async (p) => { calls.shown.push(p); },
        followUp: async (p) => { calls.replies.push(p); },
        showModal: async (m) => { calls.modals.push(m); },
    };
    return { i, calls };
}
const click = async (game, userId, action, arg = '', extra = {}) => {
    const f = fake({ userId, customId: `game:${game.id}:${action}:${arg}`, ...extra });
    await router(null, f.i);
    return f.calls;
};
const onlyGame = () => [...games.values()][0];

// ─── Rules ────────────────────────────────────────────────────
test('tic-tac-toe: wins in every direction, draws, and the bot always takes a win', () => {
    const b = (s) => s.split('').map(c => (c === '.' ? null : c));
    assert.equal(tictactoe.winnerOf(b('XXX......')).mark, 'X');
    assert.equal(tictactoe.winnerOf(b('O..O..O..')).mark, 'O');
    assert.deepEqual(tictactoe.winnerOf(b('X...X...X')).line, [0, 4, 8]);
    assert.equal(tictactoe.winnerOf(b('XOXXOOOXX')).mark, null, 'full board: draw');
    assert.equal(tictactoe.winnerOf(b('XO.......')), null);
    assert.equal(tictactoe.botMove(b('OO.XX....'), 'O', 'X', () => 0.99), 2, 'wins instead of blocking');
});

test('connect four: pieces stack, every direction wins, and the bot takes a win', () => {
    const board = connect4.emptyBoard();
    assert.equal(connect4.drop(board, 3, 0), 5);
    assert.equal(connect4.drop(board, 3, 1), 4);
    for (let i = 0; i < 4; i++) connect4.drop(board, 0, 1);
    assert.equal(connect4.winAt(board, 2, 0).length, 4, 'vertical');
    connect4.drop(board, 0, 0); connect4.drop(board, 0, 0);
    assert.equal(connect4.drop(board, 0, 0), -1, 'full column');

    const h = connect4.emptyBoard();
    [1, 2, 3].forEach(c => connect4.drop(h, c, 0));
    assert.ok([0, 4].includes(connect4.botMove(h, 0, 1, () => 0.5)), 'bot completes four in a row');

    const d = connect4.emptyBoard(); // diagonal for player 0
    connect4.drop(d, 0, 0);
    connect4.drop(d, 1, 1); connect4.drop(d, 1, 0);
    connect4.drop(d, 2, 1); connect4.drop(d, 2, 1); connect4.drop(d, 2, 0);
    connect4.drop(d, 3, 1); connect4.drop(d, 3, 1); connect4.drop(d, 3, 1);
    const r = connect4.drop(d, 3, 0);
    assert.equal(connect4.winAt(d, r, 3).length, 4, 'diagonal');
});

test('wordle scores repeated letters like the real game', () => {
    assert.deepEqual(wordle.score('paper', 'apple'), ['present', 'present', 'correct', 'present', 'absent']);
    assert.deepEqual(wordle.score('eerie', 'crane'), ['absent', 'absent', 'present', 'absent', 'correct']);
    assert.deepEqual(wordle.score('crane', 'crane'), Array(5).fill('correct'));
});

test('word lists are real dictionary words of the right length', () => {
    const dictionary = new Set(fs.readFileSync(require('word-list').default ?? require('word-list'), 'utf8').split('\n'));
    assert.ok(WORDLE_ANSWERS.every(w => /^[a-z]{5}$/.test(w) && dictionary.has(w)));
    assert.equal(new Set(WORDLE_ANSWERS).size, WORDLE_ANSWERS.length, 'no duplicates');
    assert.ok(HANGMAN_WORDS.every(w => /^[a-z]{5,10}$/.test(w) && dictionary.has(w)));
});

test('hangman shows found letters; minesweeper\'s first click is safe and empty areas open up', () => {
    assert.equal(hangman.pattern('rocket', new Set(['r', 'e'])), 'R _ _ _ E _');
    assert.ok(hangman.solved('abba', new Set(['a', 'b'])));

    for (let n = 0; n < 50; n++) assert.ok(!minesweeper.placeMines(12).has(12));
    assert.equal(minesweeper.neighbors(0).length, 3);
    assert.equal(minesweeper.neighbors(12).length, 8);
    const mines = new Set([24]);
    const revealed = new Set();
    minesweeper.reveal(0, mines, revealed, new Set());
    assert.equal(revealed.size, 24, 'one mine in the corner: everything else opens from one click');
});

test('memory: matches stay up, misses show until the next flip', () => {
    const game = { cards: ['🍎', '🍌', '🍎', '🍌'], matched: new Set(), open: [], moves: 0 };
    assert.equal(memory.flip(game, 0), 'flip');
    assert.equal(memory.flip(game, 1), 'miss');
    assert.deepEqual(game.open, [0, 1], 'both stay face up so you can see them');
    assert.equal(memory.flip(game, 2), 'flip');
    assert.deepEqual(game.open, [2], 'the missed pair turned back face down');
    assert.equal(memory.flip(game, 0), 'match');
    assert.equal(memory.flip(game, 0), null, 'matched cards can\'t be flipped');
    assert.equal(game.moves, 2);
});

// ─── Rewards ──────────────────────────────────────────────────
test('game rewards stop at the daily cap, even with many wins at once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => payGameReward('p1', 100, { game: 'Test' })));
    assert.equal(results.reduce((sum, r) => sum + r.paid, 0), gameConfig.DAILY_CAP);
    assert.equal(await balanceOf('p1'), gameConfig.DAILY_CAP);
    assert.deepEqual(await payGameReward('p1', 25, { game: 'Test' }), { paid: 0, capped: true });

    await Wallet.updateOne({ userId: 'p1' }, { $set: { gameDay: '2000-01-01' } }); // a new day
    assert.equal((await payGameReward('p1', 25, { game: 'Test' })).paid, 25);
});

// ─── Full flows through the router ────────────────────────────
test('tic-tac-toe challenge: only the opponent accepts, turns are enforced, the winner gets coins', async () => {
    const start = fake({ userId: 'p1' });
    await tictactoe.start(start.i, { opponentId: 'p2' });
    assert.match(text(start.calls.shown[0]), /challenges you/, 'the menu becomes the challenge');
    const game = onlyGame();

    assert.match((await click(game, 'p3', 'accept')).replies[0].content, /isn't for you/);
    await click(game, 'p2', 'accept');
    assert.equal(game.state, 'playing');

    // Set up a position where X can win in one move, then play it
    const [x, o] = game.players;
    game.board = ['X', 'X', null, 'O', 'O', null, null, null, null];
    game.turn = 0;
    assert.match((await click(game, o, 'move', 2)).replies[0].content, /not your turn/);
    assert.match((await click(game, 'p3', 'move', 2)).replies[0].content, /isn't your game/);

    const win = await click(game, x, 'move', 2);
    assert.match(text(win.shown.at(-1)), /wins!.*\+25 🪙/);
    assert.equal(await balanceOf(x), gameConfig.REWARDS.tictactoe.vsPlayer);
    assert.match((await click(game, x, 'move', 5)).replies[0].content, /has ended/);
});

test('two players clicking the same square at once: only one move counts', async () => {
    const start = fake({ userId: 'p1' });
    await tictactoe.start(start.i, { opponentId: 'p2' });
    const game = onlyGame();
    await click(game, 'p2', 'accept');
    const current = game.players[game.turn];
    const [a, b] = await Promise.all([click(game, current, 'move', 4), click(game, current, 'move', 4)]);
    assert.equal(game.board.filter(Boolean).length, 1);
    assert.equal([a, b].filter(c => c.replies.length).length, 1, 'the second click is told the square is taken, or that it is not their turn');
});

test('declining a challenge ends it', async () => {
    const start = fake({ userId: 'p1' });
    await connect4.start(start.i, { opponentId: 'p2' });
    const game = onlyGame();
    const result = await click(game, 'p2', 'decline');
    assert.match(text(result.shown[0]), /declined/);
    assert.equal(games.size, 0);
});

test('wordle: invalid words are refused privately; solving pays by guesses used', async () => {
    const start = fake({ userId: 'p1' });
    await wordle.start(start.i);
    const game = onlyGame();
    game.answer = 'crane';

    assert.equal((await click(game, 'p1', 'guess')).modals.length, 1, 'Guess opens the form');
    assert.match((await click(game, 'p1', 'submit', '', { fields: { word: 'xqzzv' } })).replies[0].content, /isn't in my word list/);
    await click(game, 'p1', 'submit', '', { fields: { word: 'slate' } });
    const solved = await click(game, 'p1', 'submit', '', { fields: { word: 'CRANE' } });
    assert.match(text(solved.shown.at(-1)), /Solved in 2\/6!.*\+35 🪙/);
    assert.equal(await balanceOf('p1'), 35);
});

test('trivia: solo pays a correct answer; race locks out wrong answers; unanswered questions time out', async () => {
    const encode = (s) => encodeURIComponent(s);
    const question = (n) => ({ category: encode('General'), difficulty: 'medium', question: encode(`Question ${n}?`), correct_answer: encode('Right'), incorrect_answers: ['W1', 'W2', 'W3'].map(encode) });
    const realFetch = global.fetch;
    global.fetch = async () => ({ json: async () => ({ response_code: 0, results: Array.from({ length: 50 }, (_, n) => question(n)) }) });
    try {
        const solo = fake({ userId: 'p1' });
        await trivia.start(solo.i);
        let game = onlyGame();
        const right = game.question.answers.indexOf('Right');
        assert.match((await click(game, 'p2', 'answer', right)).replies[0].content, /someone else's trivia/);
        const answered = await click(game, 'p1', 'answer', right);
        assert.match(text(answered.shown.at(-1)), /got it!.*\+10 🪙/);
        await click(game, 'p1', 'stop');
        games.clear();

        const race = fake({ userId: 'p1' });
        await trivia.start(race.i, { mode: 'race' });
        game = onlyGame();
        const wrong = game.question.answers.findIndex(a => a !== 'Right');
        assert.match((await click(game, 'p2', 'answer', wrong)).replies[0].content, /out for this question/);
        assert.match((await click(game, 'p2', 'answer', game.question.answers.indexOf('Right'))).replies[0].content, /already answered/);
        const winner = await click(game, 'p3', 'answer', game.question.answers.indexOf('Right'));
        assert.match(text(winner.shown.at(-1)), /<@p3> got it!/);

        // Nobody answers the next question: the time-out edit goes through the latest interaction (the Next click)
        const next = await click(game, 'p1', 'next');
        await new Promise(r => setTimeout(r, 600));
        assert.equal(game.timedOut, true);
        assert.match(text(next.shown.at(-1)), /Time's up! The answer was \*\*Right\*\*/);
    } finally {
        global.fetch = realFetch;
        for (const g of games.values()) clearTimeout(g.timer);
    }
});

test('rewards scale with how well you played', () => {
    assert.deepEqual([1, 2, 6].map(scoring.wordleReward), [40, 35, 15]);
    assert.deepEqual([1, 2, 4, 10].map(n => scoring.triviaReward('medium', n)), [10, 12, 16, 20], 'streak bonus, capped at +10');
    assert.deepEqual([6, 1].map(scoring.hangmanReward), [28, 13]);
    assert.deepEqual([10, 30, 105, 180, 900].map(scoring.minesweeperReward), [35, 35, 25, 15, 15], 'fast clears pay more');
    assert.deepEqual([8, 12, 30, 99].map(m => scoring.memoryReward(m)), [40, 32, 10, 10]);
    assert.equal(scoring.connect4Reward(4, false), 35, 'quickest possible win vs a person');
    assert.equal(scoring.connect4Reward(21, false), 20);
    assert.equal(scoring.connect4Reward(4, true), 16, 'vs the bot');
});

test('solo trivia: answers in a row pay a streak bonus', async () => {
    const encode = (x) => encodeURIComponent(x);
    const realFetch = global.fetch;
    global.fetch = async () => ({ json: async () => ({ response_code: 0, results: Array.from({ length: 50 }, (_, n) => ({ category: encode('General'), difficulty: 'easy', question: encode(`Q${n}?`), correct_answer: encode('Right'), incorrect_answers: ['W1', 'W2', 'W3'].map(encode) })) }) });
    try {
        trivia.pools.any.length = 0; // drop the medium questions left over from the earlier trivia test
        await trivia.start(fake({ userId: 's1' }).i);
        const game = onlyGame();
        for (let n = 0; n < 3; n++) {
            await click(game, 's1', 'answer', game.question.answers.indexOf('Right'));
            if (n < 2) await click(game, 's1', 'next');
        }
        assert.equal(await balanceOf('s1'), 5 + 7 + 9, 'easy 5, then +2 and +4 for the streak');
    } finally {
        global.fetch = realFetch;
        for (const g of games.values()) clearTimeout(g.timer);
    }
});
