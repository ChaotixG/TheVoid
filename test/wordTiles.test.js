const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Word Tiles is hidden from the menu until its board picture is approved; the tests start it from
// the menu, so it's switched on before menu.js loads. Turns (and "your turn" pings) are long unless
// a test shortens them.
const gameConfig = require('../src/config/games');
gameConfig.WORD_TILES_ENABLED = true;
const SETTINGS = gameConfig.PARTY.wordTiles;
SETTINGS.turnSeconds = 60;
gameConfig.TURN_PING_SECONDS = 60;

// Every board picture drawn, with what it was asked to show (wrapped before the game loads it)
const boardPictures = require('../src/features/games/wordTilesBoard');
const realDraw = boardPictures.drawBoard;
let pictures = [];
boardPictures.drawBoard = (board, options = {}) => {
    pictures.push({ tiles: board.flat().filter(Boolean).length, ...options });
    return realDraw(board, options);
};

const Wallet = require('../src/models/Wallet');
const GameStats = require('../src/models/GameStats');
const { games } = require('../src/features/games/sessions');
const gamesRouter = require('../src/features/games');
const menu = require('../src/features/games/menu');
const wordTiles = require('../src/features/games/wordTiles');
const { emptyBoard, parseSquare, points } = require('../src/features/games/wordTilesData');
const { winnerReward } = require('../src/features/games/scoring');

const { checkMove, swapTiles, endingAdjustments, coinAwards, dealer } = wordTiles;
const realOrder = dealer.order;
dealer.order = (players) => [...players]; // seats in joining order, so tests know who goes first

const stopGames = () => {
    for (const g of games.values()) {
        clearTimeout(g.timer);
        clearTimeout(g.pingTimer);
    }
    games.clear();
};

let screens = [];      // every edit of the shared game message, in order
let views = new Map(); // userId → every version of their private view, in order
let posts = [];        // public follow-ups (turn pings)
let notices = [];      // private notices (ephemeral replies without a view)
let deleted = [];      // follow-ups deleted again

before(startDatabase);
after(async () => {
    stopGames();
    await stopDatabase();
});
beforeEach(async () => {
    await clearDatabase();
    stopGames();
    SETTINGS.turnSeconds = 60;
    SETTINGS.missedTurnsOut = 2;
    gameConfig.TURN_PING_SECONDS = 60;
    screens = [];
    views = new Map();
    posts = [];
    notices = [];
    deleted = [];
    pictures = [];
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;
const text = (payload) => (payload.components ? JSON.stringify(payload.components.map(c => c.toJSON())) : String(payload.content ?? ''));
const latest = () => text(screens.at(-1));
const showView = (userId, p) => views.set(userId, [...(views.get(userId) ?? []), p]);
const viewOf = (userId) => text(views.get(userId).at(-1));
const lastView = (userId) => views.get(userId).at(-1);
const SUBSCRIPT = /[₀-₉]/;
const subscript = (n) => [...String(n)].map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
const tileText = (letter) => `**${letter}**${subscript(points(letter))}`;

// A stand-in interaction that records what the bot answered. Clicks on the game message (m1) edit
// it; clicks and forms in a private view (an ephemeral message, like the real one) update that view.
let messageIds = 0;
function fake({ userId, customId, values, fields = {}, modal = false, privateView = false, createdTimestamp = Date.now() }) {
    const calls = { replies: [], shown: [], modal: null };
    const show = (p) => {
        calls.shown.push(p);
        if (privateView) showView(userId, p);
        else screens.push(p);
    };
    const i = {
        user: { id: userId }, guildId: 'g1', channelId: 'c1', customId, values,
        message: privateView
            ? { id: 'v1', flags: { has: (flag) => flag === MessageFlags.Ephemeral } }
            : { id: 'm1', edit: async (p) => { screens.push(p); } },
        fields: {
            getTextInputValue: (id) => fields[id] ?? '',
            getStringSelectValues: (id) => fields[id] ?? [],
        },
        createdTimestamp,
        client: { user: { id: 'me' } },
        options: { getString: () => null },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => !modal, isModalSubmit: () => modal, isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); notices.push(p); i.replied = true; },
        update: async (p) => { show(p); i.replied = true; },
        deferUpdate: async () => { i.deferred = true; },
        editReply: async (p) => { show(p); },
        followUp: async (p) => {
            calls.replies.push(p);
            if (!(Number(p.flags ?? 0) & MessageFlags.Ephemeral)) posts.push(p);
            else if (p.components) showView(userId, p); // a private view (openView)
            else notices.push(p);
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
async function press(customId, userId, extra = {}) {
    const f = fake({ userId, customId, ...extra });
    await (customId.startsWith('games:') ? menu.handleInteraction(null, f.i) : gamesRouter.handleInteraction(null, f.i));
    return f.calls;
}
// A click on the game message
const click = (game, userId, action, arg = '') => press(`game:${game.id}:${action}:${arg}`, userId);
// A click (or a choice in a menu) in someone's private view
const tap = (game, userId, action, arg = '', values) => press(`game:${game.id}:${action}:${arg}`, userId, { privateView: true, values });
// Sends the word form, which was opened from the private view
const submit = (game, userId, word, square, direction = 'across', turnNo = game.turnNo) =>
    press(`game:${game.id}:submit:${turnNo}`, userId, { modal: true, privateView: true, fields: { word, square, direction: [direction] } });
// The whole move: the form, then Play it on the preview
async function playWord(game, userId, word, square, direction = 'across') {
    await submit(game, userId, word, square, direction);
    return tap(game, userId, 'play', game.turnNo);
}
const pass = async (game, userId) => {
    await tap(game, userId, 'pass');
    return tap(game, userId, 'passYes', game.turnNo);
};
const notice = (calls) => calls.replies[0]?.content;
// A button or menu in a payload, by its action
function componentIn(payload, action) {
    let found = null;
    const walk = (c) => {
        if (c.custom_id?.split(':')[2] === action) found ??= c;
        (c.components ?? []).forEach(walk);
    };
    payload.components.map(c => c.toJSON()).forEach(walk);
    return found;
}
const newestGame = () => [...games.values()].at(-1);
const current = (game) => game.players[game.turn];

// Opens a lobby from the /games menu, has everyone join, and starts it (seats in joining order)
async function startGame(players = ['p1', 'p2']) {
    await press(`games:start:${players[0]}:wordTiles:`, players[0]);
    const game = newestGame();
    for (const p of players.slice(1)) await click(game, p, 'join');
    await click(game, players[0], 'begin');
    return game;
}

// Sets everyone's tiles (as strings, '?' for a blank) and the bag (drawn from its end)
function deal(game, racks, bag) {
    for (const [id, letters] of Object.entries(racks)) game.racks.set(id, [...letters]);
    if (bag !== undefined) game.bag = [...bag];
}

// Puts a word on a board directly (for rule tests)
function put(board, square, direction, word) {
    const { row, col } = parseSquare(square);
    [...word].forEach((letter, i) => {
        board[row + (direction === 'down' ? i : 0)][col + (direction === 'across' ? i : 0)] = { letter, blank: false };
    });
    return board;
}
const boardWith = (...words) => words.reduce((board, w) => put(board, ...w), emptyBoard());
const scoresOf = (move) => move.words.map(w => `${w.word} ${w.score}`);

// ─── Tiles ────────────────────────────────────────────────────
test('word tiles: 100 tiles with the standard letters and points; shuffles keep every tile', () => {
    const bag = wordTiles.newBag();
    assert.equal(bag.length, 100);
    const count = (letter) => bag.filter(l => l === letter).length;
    assert.equal(count('E'), 12);
    assert.equal(count('?'), 2);
    assert.equal(count('Q'), 1);
    assert.equal(wordTiles.rackValue(bag), 187, 'the standard set is worth 187 points');

    const shuffled = dealer.bag();
    assert.deepEqual([...shuffled].sort(), [...bag].sort());
    assert.notDeepEqual(shuffled, bag);
    assert.deepEqual(wordTiles.shuffle(['a', 'b', 'c'], (n) => n - 1), ['a', 'b', 'c'], 'tests can choose the randomness');
    assert.deepEqual(realOrder(['p1', 'p2', 'p3', 'p4']).sort(), ['p1', 'p2', 'p3', 'p4'], 'seats are shuffled, nobody lost');
    assert.equal(wordTiles.showRack(['Q', 'U', '?']), '**Q**₁₀ **U**₁ **?**₀');
});

// ─── Placing words ────────────────────────────────────────────
test('word tiles: the first word must cover H8, and the start square can be written either way', () => {
    const quiz = checkMove(emptyBoard(), [...'QUIZERS'], 'quiz', 'H8', 'across');
    assert.deepEqual(quiz.placed.map(t => `${t.row},${t.col}${t.letter}`), ['7,7Q', '7,8U', '7,9I', '7,10Z']);
    assert.deepEqual(scoresOf(quiz), ['QUIZ 44'], 'H8 doubles the word: (10+1+1+10)×2');
    assert.equal(quiz.score, 44);
    assert.equal(quiz.bingo, false);

    assert.equal(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', '8f', 'across').score, 44, 'covering H8 from F8 (written 8F)');
    assert.equal(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'H5', 'down').score, 44, 'down onto H8');
    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'A1', 'across').error, /first word must cover the ★ square \(\*\*H8\*\*\)/);
    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'H9', 'across').error, /must cover/);
});

test('word tiles: later words connect by using a letter on the board or touching one', () => {
    const board = boardWith(['H8', 'across', 'QUIZ']);
    assert.match(checkMove(board, [...'DOGXXXX'], 'DOG', 'A1', 'across').error, /has to connect to tiles on the board/);
    assert.match(checkMove(board, [...'TAXXXXX'], 'TA', 'J10', 'across').error, /has to connect/, 'one row too far down');

    const qi = checkMove(board, [...'IABCDEF'], 'QI', 'H8', 'down');
    assert.deepEqual(qi.placed, [{ row: 8, col: 7, letter: 'I', blank: false }], 'the Q on the board is used, only the I is placed');
    assert.deepEqual(scoresOf(qi), ['QI 11'], 'the Q sits on a double word, but it was already there');

    const ta = checkMove(board, [...'TAXXXXX'], 'TA', 'J9', 'across');
    assert.deepEqual(scoresOf(ta), ['TA 2', 'IT 2', 'ZA 11'], 'touching QUIZ from below makes IT and ZA too');
    assert.equal(ta.score, 15);
});

test('word tiles: type the whole word as it reads, including the letters already there', () => {
    const board = boardWith(['H8', 'across', 'QUIZ']);
    assert.match(checkMove(board, [...'ESXXXXX'], 'ZES', 'K8', 'across').error,
        /That makes \*\*QUIZES\*\* with the \*\*QUI\*\* already on the board\. Type the whole word, starting at \*\*H8\*\*/);
    assert.match(checkMove(boardWith(['G8', 'across', 'X']), [...'QUIZXXX'], 'QUIZ', 'H8', 'across').error,
        /That makes \*\*XQUIZ\*\* with the \*\*X\*\* already on the board\. Type the whole word/);
    assert.match(checkMove(boardWith(['H8', 'across', 'CAT'], ['L8', 'across', 'S']), [...'SXXXXXX'], 'CAT', 'H8', 'across').error,
        /Every letter of \*\*CAT\*\* is already on the board/);
    assert.match(checkMove(board, [...'ADXXXXX'], 'QUAD', 'H8', 'across').error,
        /\*\*J8\*\* already has an \*\*I\*\*, but \*\*QUAD\*\* needs an \*\*A\*\* there/);
    assert.match(checkMove(board, [...'QUIZXXX'], 'QUIZ', 'H8', 'across').error, /already on the board/);

    const cats = checkMove(boardWith(['H8', 'across', 'CAT']), [...'SXXXXXX'], 'CATS', 'H8', 'across');
    assert.deepEqual(cats.placed, [{ row: 7, col: 10, letter: 'S', blank: false }]);
    assert.equal(cats.score, 6);
});

test('word tiles: every word a move makes is checked, and each one scores', () => {
    const board = boardWith(['H8', 'across', 'QUIZ']);
    assert.match(checkMove(board, [...'TIXXXXX'], 'TI', 'J9', 'across').error,
        /Your \*\*I\*\* on \*\*K9\*\* would also make \*\*ZI\*\* going down, and that isn't in my word list/);
    assert.match(checkMove(board, [...'ATXXXXX'], 'AT', 'J9', 'across').error, /would also make \*\*IA\*\* and \*\*ZT\*\*, which aren't in my word list/);
    assert.match(checkMove(emptyBoard(), [...'QIZERST'], 'QIZ', 'H8', 'across').error, /\*\*QIZ\*\* isn't in my word list/);
});

test('word tiles: letter and word bonuses, only under new tiles', () => {
    const ax = (square) => checkMove(boardWith([square, 'down', 'A']), [...'AXEEEEE'], 'AX', square, 'down');
    assert.equal(ax('I8').score, 1 + 8 * 2, 'X on I9, a double letter');
    assert.equal(ax('J9').score, 1 + 8 * 3, 'X on J10, a triple letter');
    assert.equal(ax('K10').score, (1 + 8) * 2, 'X on K11, a double word');
    assert.equal(ax('O7').score, (1 + 8) * 3, 'X on O8, a triple word');

    const axe = checkMove(boardWith(['I8', 'down', 'AX']), [...'EXXXXXX'], 'AXE', 'I8', 'down');
    assert.equal(axe.score, 1 + 8 + 1, 'the X already on the double letter counts once');

    // The X on K11 makes AX both ways, and the double word counts for each
    const both = checkMove(boardWith(['J11', 'across', 'A']), [...'AXEEEEE'], 'AX', 'K10', 'down');
    assert.deepEqual(scoresOf(both), ['AX 18', 'AX 18']);
    assert.equal(both.score, 36);
});

test('word tiles: using all 7 tiles is a bingo, worth 50 more; two double words make ×4', () => {
    const move = checkMove(boardWith(['H6', 'across', 'T']), [...'RETAINS'], 'RETAINS', 'E5', 'across');
    assert.equal(move.bingo, true);
    assert.deepEqual(scoresOf(move), ['RETAINS 28', 'AT 2'], 'E5 and K5 are both double words');
    assert.equal(move.score, 28 + 2 + 50);
    assert.equal(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'H8', 'across').bingo, false);
});

test('word tiles: blanks stand in for missing letters, and real tiles go where they score the most', () => {
    // Two Es needed, one E and a blank: the real E goes on D8 (double letter), the blank on H8
    const elate = checkMove(emptyBoard(), [...'E?LATXY'], 'ELATE', 'D8', 'across');
    assert.deepEqual(elate.placed.map(t => t.blank), [false, false, false, false, true]);
    assert.equal(elate.score, (1 * 2 + 1 + 1 + 1 + 0) * 2);

    // One Z, two blanks: the real Z goes on H12 (double letter); the blanks are the other Z and the S
    const quizzes = checkMove(emptyBoard(), [...'QUIZE??'], 'QUIZZES', 'H8', 'down');
    assert.deepEqual(quizzes.placed.filter(t => t.blank).map(t => `${t.letter}${t.row + 1}`), ['Z11', 'S14']);
    assert.equal(quizzes.score, (10 + 1 + 1 + 0 + 20 + 1 + 0) * 2 + 50);

    const blankZ = checkMove(emptyBoard(), [...'QUI?ERS'], 'QUIZ', 'H8', 'across');
    assert.deepEqual(blankZ.placed.at(-1), { row: 7, col: 10, letter: 'Z', blank: true });
    assert.equal(blankZ.score, (10 + 1 + 1) * 2, 'a blank scores nothing');
});

test('word tiles: missing letters, running off the board and bad input are explained', () => {
    assert.equal(checkMove(emptyBoard(), [...'QUIERST'], 'QUIZ', 'H8', 'across').error, '**QUIZ** needs a **Z** you don\'t have.');
    assert.equal(checkMove(emptyBoard(), [...'UIZERST'], 'QUIZ', 'H8', 'across').error, '**QUIZ** needs a **Q** you don\'t have.');
    assert.equal(checkMove(emptyBoard(), [...'QUIZEST'], 'QUIZZES', 'H8', 'across').error, '**QUIZZES** needs another **Z** you don\'t have.');
    assert.equal(checkMove(emptyBoard(), [...'QUIES?T'], 'QUIZZES', 'H8', 'across').error,
        '**QUIZZES** needs 2 **Z**s you don\'t have, and your blank covers only one.');
    assert.equal(checkMove(emptyBoard(), [...'UIESTRA'], 'QUIZZES', 'H8', 'across').error, '**QUIZZES** needs a **Q** and 2 **Z**s you don\'t have.');

    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'M8', 'across').error,
        /\*\*QUIZ\*\* runs off the board: going across from \*\*M8\*\* there's only room for 3 letters/);
    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'H13', 'down').error, /runs off the board: going down from \*\*H13\*\*/);
    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'Z9', 'across').error, /\*\*Z9\*\* isn't a square\. Use a column A to O and a row 1 to 15/);
    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'QUIZ', 'H16', 'across').error, /isn't a square/);
    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'Q1Z', 'H8', 'across').error, /letters only/);
    assert.match(checkMove(emptyBoard(), [...'QUIZERS'], 'Q', 'H8', 'across').error, /2 to 15 letters, and \*\*Q\*\* has 1/);
});

// ─── Swaps, the end, coins ────────────────────────────────────
test('word tiles: a swap draws new tiles first, then the old ones go back; it needs 7 in the bag', () => {
    const rack = [...'QUIZER?'];
    assert.match(swapTiles(rack, [...'ABCDEF'], ['Q']).error, /at least 7 tiles in the bag, and there are only 6/);
    assert.match(swapTiles(rack, [...'ABCDEFG'], []).error, /Pick at least one/);
    assert.match(swapTiles(rack, [...'ABCDEFG'], ['E', 'E']).error, /You don't have an \*\*E\*\* to swap/, 'only one E');

    const swapped = swapTiles(rack, [...'ABCDEFG'], ['Q', 'Z']);
    assert.deepEqual(swapped.drawn, ['F', 'G']);
    assert.deepEqual(swapped.rack, ['F', 'U', 'I', 'G', 'E', 'R', '?'], 'new tiles take the old ones\' places');
    assert.deepEqual([...swapped.bag].sort(), [...'ABCDEQZ'].sort());
});

test('word tiles: the end: going out takes everyone\'s leftovers, six scoreless turns cost each their own', () => {
    const racks = [['p1', []], ['p2', ['Z', '?']], ['p3', ['A', 'B']]];
    assert.deepEqual([...endingAdjustments(racks, 'p1')], [['p2', -10], ['p3', -4], ['p1', 14]]);
    assert.deepEqual([...endingAdjustments([['p1', ['Q']], ['p2', ['E', 'E']]])], [['p1', -10], ['p2', -2]]);

    const r = gameConfig.REWARDS.wordTiles;
    const scores = new Map([['p1', 60], ['p2', 60], ['p3', -5]]);
    assert.deepEqual(coinAwards(['p1', 'p2', 'p3'], scores, ['p1', 'p2']), [
        { userId: 'p1', amount: Math.floor(60 / r.pointsPerCoin) + winnerReward('wordTiles', 2) },
        { userId: 'p2', amount: Math.floor(60 / r.pointsPerCoin) + winnerReward('wordTiles', 2) },
        { userId: 'p3', amount: 0 },
    ], 'a tie: both winners beat one player');
    assert.deepEqual(coinAwards(['p1'], new Map([['p1', 80]]), ['p1']), [{ userId: 'p1', amount: 3 }], 'nobody beaten, no winner\'s reward');
});

// ─── Lobby and the game message ───────────────────────────────
test('word tiles: the lobby explains the game; at the start everyone gets 7 tiles and the board is posted', async () => {
    await press('games:start:p1:wordTiles:', 'p1');
    const game = newestGame();
    assert.equal(game.state, 'lobby');
    assert.match(latest(), /Word Tiles/);
    assert.match(latest(), /Players · 1\/4/);
    assert.match(latest(), /1 min per turn · run out of time twice in a row and you're out · your tiles are private/);
    await click(game, 'p2', 'join');
    await click(game, 'p3', 'join');
    await click(game, 'p1', 'begin');

    assert.equal(game.state, 'playing');
    for (const id of ['p1', 'p2', 'p3']) assert.equal(game.racks.get(id).length, 7);
    assert.equal(game.bag.length, 100 - 21);
    assert.equal(wordTiles.rackValue([...game.bag, ...[...game.racks.values()].flat()]), 187, 'every tile is somewhere');
    assert.deepEqual(game.started, ['p1', 'p2', 'p3']);

    const board = screens.at(-1);
    assert.equal(board.files[0].name, 'board.png');
    assert.deepEqual(board.attachments, [], 'the picture replaces the last one');
    assert.match(latest(), /attachment:\/\/board\.png/);
    assert.match(latest(), /<@p1> goes first · the first word must cover the ★ square/);
    assert.match(latest(), /▶️ <@p1> · \*\*0\*\* · 7 tiles · ⏳ <t:\d+:R>/);
    assert.match(latest(), /▫️ <@p2> · \*\*0\*\* · 7 tiles\\n/);
    assert.match(latest(), /🎒 79 tiles in the bag/);
    assert.match(latest(), /game:[0-9a-f]+:tiles/);
    assert.equal(pictures.length, 1, 'the empty board was drawn');
    assert.match(notice(await click(game, 'p4', 'join')), /already started/);
    assert.match(notice(await click(game, 'p2', 'leave')), /My tiles/);
    assert.match(notice(await click(game, 'p9', 'tiles')), /not in this game/);

    assert.match(text(game.onExpire()), /no moves for 10 minutes/);
    assert.equal(await GameStats.countDocuments(), 0, 'an idle game isn\'t recorded');
});

// ─── A move, start to finish ──────────────────────────────────
test('word tiles: My tiles → Play word → preview → Play it; the board, the turn and everyone\'s views move on', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { p1: 'QUIZERS', p2: 'TAXBONE' });
    const turn = game.turnNo;

    const opened = (await click(game, 'p1', 'tiles')).replies[0];
    assert.equal(opened.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    assert.match(text(opened), /\*\*Q\*\*₁₀ \*\*U\*\*₁ \*\*I\*\*₁ \*\*Z\*\*₁₀ \*\*E\*\*₁ \*\*R\*\*₁ \*\*S\*\*₁/);
    assert.match(text(opened), /\*\*Your turn!\*\* · time's up <t:\d+:R>/);
    assert.match(text(opened), /Type the whole word, including letters already on the board · the start square is where its first letter goes · blanks/);
    assert.equal(opened.files[0].name, 'board.png', 'on your turn your view shows the board');
    await click(game, 'p2', 'tiles');
    assert.match(viewOf('p2'), /<@p1>'s turn/);
    assert.equal(lastView('p2').files, undefined, 'no picture when it isn\'t your turn');
    assert.deepEqual(lastView('p2').attachments, []);

    // The form: the turn is in its ID; the first move suggests H8
    const form = (await tap(game, 'p1', 'word')).modal.toJSON();
    assert.equal(form.custom_id, `game:${game.id}:submit:${turn}`);
    assert.deepEqual(form.components.map(l => l.label), ['Word', 'Start square', 'Direction']);
    assert.equal(form.components[1].component.value, 'H8');
    assert.deepEqual(form.components[2].component.options.map(o => [o.label, Boolean(o.default)]), [['Across →', true], ['Down ↓', false]]);

    const before = screens.length;
    await submit(game, 'p1', 'quiz', 'h8', 'across');
    assert.match(viewOf('p1'), /Your move · preview/);
    assert.match(viewOf('p1'), /\*\*QUIZ\*\* for \*\*44\*\* points · uses Q U I Z/);
    assert.match(viewOf('p1'), new RegExp(`:play:${turn}"`));
    assert.match(viewOf('p1'), /:change"/);
    assert.equal(lastView('p1').files[0].name, 'board.png');
    assert.deepEqual(pictures.at(-1).pending.map(t => t.letter).join(''), 'QUIZ', 'the preview shows the new tiles as pending');
    assert.equal(screens.length, before, 'nothing public happens before Play it');
    assert.equal(game.board[7][7], null);

    // Change reopens the form with what was typed
    const again = (await tap(game, 'p1', 'change')).modal.toJSON();
    assert.deepEqual(again.components.slice(0, 2).map(l => l.component.value), ['QUIZ', 'H8']);
    assert.match(viewOf('p1'), /preview/, 'the preview stays while the form is open');

    await tap(game, 'p1', 'play', turn);
    assert.equal(game.board[7][7].letter, 'Q');
    assert.equal(game.scores.get('p1'), 44);
    assert.equal(game.racks.get('p1').length, 7, 'drew back up to 7');
    assert.equal(game.bag.length, 100 - 14 - 4);
    assert.deepEqual(pictures.at(-1).highlight, ['7,7', '7,8', '7,9', '7,10'], 'the new board highlights the move');
    assert.match(viewOf('p1'), /✅ You played \*\*QUIZ\*\* for \*\*44\*\*! You drew 4 tiles\./);
    assert.match(viewOf('p1'), /<@p2>'s turn/);

    assert.match(latest(), /\*\*<@p1>\*\* played \*\*QUIZ\*\* for \*\*44\*\*/);
    assert.match(latest(), /▫️ <@p1> · \*\*44\*\* · 7 tiles/);
    assert.match(latest(), /▶️ <@p2> · \*\*0\*\* · 7 tiles · ⏳/);
    assert.equal(screens.at(-1).files[0].name, 'board.png');
    assert.match(viewOf('p2'), /\*\*Your turn!\*\*/, 'p2\'s open view redrew itself');
    assert.equal(lastView('p2').files[0].name, 'board.png');

    // A cross play by p2 shows every word it made
    await playWord(game, 'p2', 'TA', 'J9');
    assert.match(latest(), /\*\*<@p2>\*\* played \*\*TA\*\* for \*\*15\*\* · also IT 2, ZA 11/);
    assert.equal(game.scores.get('p2'), 15);
    assert.match(viewOf('p1'), /Last: \*\*<@p2>\*\* played \*\*TA\*\*/);
});

test('word tiles: mistakes are explained privately, with the form filled in again to fix them', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { p1: 'QUI?ERS', p2: 'TAXBONE' }, 'EEEEEEEE');
    await click(game, 'p1', 'tiles');
    const before = screens.length;

    await submit(game, 'p1', 'QIZ', 'H8');
    assert.match(viewOf('p1'), /❌ \*\*QIZ\*\* isn't in my word list\./);
    assert.match(viewOf('p1'), /Press \*\*✏️ Play word\*\* to try again/);
    const form = (await tap(game, 'p1', 'word')).modal.toJSON();
    assert.equal(form.components[0].component.value, 'QIZ', 'what was typed is filled in');

    await submit(game, 'p1', 'QUIZ', 'A1');
    assert.match(viewOf('p1'), /first word must cover the ★ square/);
    await submit(game, 'p1', 'QUIZ', 'M8');
    assert.match(viewOf('p1'), /runs off the board/);
    await submit(game, 'p1', 'JINX', 'H8');
    assert.match(viewOf('p1'), /\*\*JINX\*\* needs a \*\*J\*\*, an \*\*N\*\* and an \*\*X\*\* you don't have, and your blank covers only one/);
    assert.equal(screens.length, before, 'mistakes stay private');
    assert.equal(game.turn, 0);

    // A blank fills in for the Z, and the preview says so
    await submit(game, 'p1', 'QUIZ', 'H8', 'across');
    assert.match(viewOf('p1'), /\*\*QUIZ\*\* for \*\*24\*\* points · uses Q U I and a blank as Z/);
    await tap(game, 'p1', 'play', game.turnNo);
    assert.deepEqual(game.board[7][10], { letter: 'Z', blank: true });
    assert.equal(game.racks.get('p1').includes('?'), false);

    // Not your turn: buttons and forms say whose turn it is
    await click(game, 'p1', 'tiles');
    assert.match(viewOf('p1'), /<@p2>'s turn/);
    assert.equal(componentIn(lastView('p1'), 'word').disabled, true);
    await tap(game, 'p1', 'word');
    assert.match(viewOf('p1'), /It's <@p2>'s turn, not yours/);
    await submit(game, 'p1', 'QI', 'H8', 'down', game.turnNo);
    assert.match(viewOf('p1'), /It's <@p2>'s turn, not yours/);
    assert.equal(game.board[8][7], null);
});

// ─── Racing the clock ─────────────────────────────────────────
test('word tiles: a form or a preview from a turn that already ended is refused', async () => {
    SETTINGS.missedTurnsOut = 9; // p1 runs out of time twice here, and should stay in
    SETTINGS.turnSeconds = 0.25;
    const game = await startGame(['p1', 'p2']);
    SETTINGS.turnSeconds = 60; // only the first turn is short
    deal(game, { p1: 'QUIZERS', p2: 'TAXBONE' });
    const formTurn = Number((await tap(game, 'p1', 'word')).modal.toJSON().custom_id.split(':')[3]);

    await wait(350); // p1's time runs out while the form is open
    assert.equal(game.turn, 1);
    assert.match(latest(), /⌛ <@p1> ran out of time, so their turn passed/);
    await submit(game, 'p1', 'QUIZ', 'H8', 'across', formTurn);
    assert.match(viewOf('p1'), /⌛ Too late: your turn ended before that arrived, so nothing was played\. It's <@p2>'s turn now\./);

    SETTINGS.turnSeconds = 0.25; // p1's next turn is short too
    await pass(game, 'p2');
    SETTINGS.turnSeconds = 60;
    assert.equal(game.turn, 0);
    await submit(game, 'p1', 'QUIZ', 'H8', 'across', formTurn);
    assert.match(viewOf('p1'), /Too late.*The board may have changed, so check it and try again/, 'p1\'s turn again, but a later one');
    assert.equal(game.board[7][7], null);

    // A preview made in time, played after the time ran out
    await submit(game, 'p1', 'QUIZ', 'H8');
    const previewTurn = game.turnNo;
    await wait(350);
    assert.match(viewOf('p1'), /⌛ You ran out of time, so your turn passed/, 'the preview is gone, and the view says why');
    assert.doesNotMatch(viewOf('p1'), /preview/);
    await tap(game, 'p1', 'play', previewTurn);
    assert.match(viewOf('p1'), /Too late/);
    assert.equal(game.board[7][7], null);
    assert.equal(game.scoreless, 3);
});

test('word tiles: running out of time is a pass, and whoever\'s turn it is gets pinged', async () => {
    gameConfig.TURN_PING_SECONDS = 0.1;
    SETTINGS.turnSeconds = 0.3;
    const game = await startGame(['p1', 'p2']);
    SETTINGS.turnSeconds = 60;
    await wait(200);
    assert.equal(posts.length, 1);
    assert.match(posts[0].content, /<@p1>, it's your turn in \*\*🔠 Word Tiles\*\*!/);
    assert.deepEqual(posts[0].allowedMentions, { users: ['p1'] });

    await wait(300);
    assert.equal(game.turn, 1);
    assert.equal(game.scoreless, 1);
    assert.equal(game.scores.get('p1'), 0);
    assert.equal(deleted.length, 1, 'p1\'s ping went once the turn ended');
    assert.match(latest(), /⌛ <@p1> ran out of time/);
    assert.equal(posts.length, 2);
    assert.match(posts[1].content, /<@p2>, it's your turn/);
});

// The next turn (started by `move`) is short, so it runs out; the ones after it are long again
async function shortNextTurn(move) {
    SETTINGS.turnSeconds = 0.2;
    await move();
    SETTINGS.turnSeconds = 60;
}

test('word tiles: running out of time twice in a row takes a player out; their tiles go back and the turn moves on', async () => {
    const game = await startGame(['p1', 'p2', 'p3']);
    deal(game, { p1: 'QUIZERS', p2: 'JXKVWYF', p3: 'TAXBONE' }, 'AAAAAAAAAA');
    await click(game, 'p2', 'tiles');

    await shortNextTurn(() => pass(game, 'p1'));
    await wait(350);
    assert.equal(current(game), 'p3');
    assert.deepEqual(game.players, ['p1', 'p2', 'p3'], 'one timeout is a pass');
    assert.match(latest(), /⌛ <@p2> ran out of time, so their turn passed/);

    await pass(game, 'p3');
    await shortNextTurn(() => pass(game, 'p1'));
    assert.match(viewOf('p2'), /⚠️ You ran out of time last turn\. Run out again and you're out of the game\./, 'p2 is warned first');
    await wait(350);

    assert.deepEqual(game.players, ['p1', 'p3']);
    assert.equal(game.racks.has('p2'), false);
    assert.equal(game.bag.length, 10 + 7, 'p2\'s tiles went back into the bag');
    assert.ok(game.bag.includes('J'));
    assert.equal(current(game), 'p3', 'the turn passed on');
    assert.equal(game.scoreless, 5, 'both timeouts counted toward the scoreless ending');
    assert.match(latest(), /⌛ \*\*<@p2>\*\* ran out of time twice in a row, so they're out · their tiles went back into the bag/);
    assert.match(latest(), /Out: <@p2> timed out/);
    assert.match(viewOf('p2'), /⌛ You ran out of time twice in a row, so you're out of this game\. Your tiles went back into the bag\./);
    assert.doesNotMatch(viewOf('p2'), SUBSCRIPT, 'no tiles in their view any more');
    assert.equal(game.views.has('p2'), false, 'and it stops updating');
    assert.match(notice(await click(game, 'p2', 'tiles')), /you're out of this game/);
});

test('word tiles: any real move resets the timeouts in a row', async () => {
    SETTINGS.turnSeconds = 0.2;
    const game = await startGame(['p1', 'p2']);
    SETTINGS.turnSeconds = 60;
    deal(game, { p1: 'AEIOULN', p2: 'QUIZERS' });
    await wait(350);
    assert.equal(game.missed.get('p1'), 1);

    await pass(game, 'p2');
    await click(game, 'p1', 'tiles');
    assert.match(viewOf('p1'), /Run out again and you're out/);
    await pass(game, 'p1'); // p1 is back
    assert.equal(game.missed.get('p1'), 0);
    await shortNextTurn(() => pass(game, 'p2'));
    await wait(350);
    assert.deepEqual(game.players, ['p1', 'p2'], 'p1 is still in: the pass came between the timeouts');
    assert.equal(game.missed.get('p1'), 1);
    assert.match(latest(), /⌛ <@p1> ran out of time, so their turn passed/);

    // Playing a word and swapping reset it too
    game.missed.set('p2', 1);
    await playWord(game, 'p2', 'QUIZ', 'H8');
    assert.equal(game.missed.get('p2'), 0);
    await tap(game, 'p1', 'swap');
    await tap(game, 'p1', 'swapPick', '', ['0']);
    await tap(game, 'p1', 'swapYes', game.turnNo);
    assert.equal(game.missed.get('p1'), 0);
});

test('word tiles: when timeouts leave one player, they win, but with no winner\'s coins', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { p1: 'QUIZERS', p2: 'TAXBONE' });
    game.scores.set('p1', 60);
    await click(game, 'p2', 'tiles');
    await shortNextTurn(() => pass(game, 'p1'));
    await wait(350);
    await shortNextTurn(() => pass(game, 'p1'));
    await wait(350);

    assert.equal(game.state, 'over');
    assert.equal(games.size, 0);
    assert.deepEqual(game.winners, ['p1']);
    assert.match(latest(), /<@p1> wins!/);
    assert.match(latest(), /Everyone else is out, so <@p1> wins/);
    assert.match(latest(), /⌛ <@p2> · timed out/);
    assert.match(viewOf('p2'), /you're out of this game/);
    // Nobody was beaten, so only the points pay: 60 points → 2 coins
    assert.equal(await balanceOf('p1'), Math.floor(60 / gameConfig.REWARDS.wordTiles.pointsPerCoin));
    assert.equal(await balanceOf('p2'), 0);
    const stats = await GameStats.find({ game: 'wordTiles' }).lean();
    assert.deepEqual(stats.map(s => [s.userId, s.played, s.wins]).sort(), [['p1', 1, 1], ['p2', 1, 0]], 'p2 still played');
});

test('word tiles: an open preview, question or swap survives other players\' moves redrawing the views', async () => {
    SETTINGS.turnSeconds = 0.3;
    const game = await startGame(['p1', 'p2', 'p3', 'p4']);
    SETTINGS.turnSeconds = 60;
    deal(game, { p1: 'AEIOULN', p2: 'QUIZERS', p3: 'TAXBONE', p4: 'DEARTHS' });
    await click(game, 'p2', 'tiles');
    await tap(game, 'p2', 'quit');
    assert.match(viewOf('p2'), /Leave the game\?/);

    await wait(400); // p1 runs out of time: everyone's view is redrawn
    assert.equal(game.turn, 1);
    assert.match(viewOf('p2'), /Leave the game\?/, 'p2 is still being asked');
    await tap(game, 'p2', 'back');
    assert.match(viewOf('p2'), /\*\*Your turn!\*\*/);

    await submit(game, 'p2', 'QUIZ', 'H8');
    assert.match(viewOf('p2'), /preview/);
    await click(game, 'p3', 'tiles');
    await tap(game, 'p3', 'quit');
    await tap(game, 'p3', 'quitYes'); // p3 leaves: views are redrawn
    assert.match(viewOf('p2'), /Your move · preview/, 'the preview is still there');
    assert.match(viewOf('p2'), /\*\*QUIZ\*\* for \*\*44\*\* points/);
    await tap(game, 'p2', 'play', game.turnNo);
    assert.equal(game.scores.get('p2'), 44);

    // p4 is picking tiles to swap when p1 leaves
    assert.equal(current(game), 'p4');
    await click(game, 'p4', 'tiles');
    await tap(game, 'p4', 'swap');
    await tap(game, 'p4', 'swapPick', '', ['0']);
    const shown = views.get('p4').length;
    await click(game, 'p1', 'tiles');
    await tap(game, 'p1', 'quit');
    await tap(game, 'p1', 'quitYes');
    assert.equal(views.get('p4').length, shown + 1, 'p4\'s view was redrawn');
    assert.match(viewOf('p4'), /Swap 1 tile/, 'with the pick still in place');
    assert.equal(current(game), 'p4', 'p1 sat before p4, so it\'s still p4\'s turn');
});

// ─── Swaps, passes, shuffles ──────────────────────────────────
test('word tiles: swapping picks tiles from a menu, then swaps them; it needs 7 tiles in the bag', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { p1: 'QUIZERS', p2: 'TAXBONE' }, 'AAAAAAAA');
    await click(game, 'p1', 'tiles');
    await tap(game, 'p1', 'swap');
    assert.match(viewOf('p1'), /Swap tiles/);
    const select = componentIn(lastView('p1'), 'swapPick');
    assert.equal(select.options.length, 7);
    assert.equal(select.max_values, 7);
    assert.equal(componentIn(lastView('p1'), 'swapYes').disabled, true, 'nothing picked yet');

    await tap(game, 'p1', 'swapPick', '', ['0', '3']);
    assert.match(viewOf('p1'), /Swap 2 tiles/);
    await tap(game, 'p1', 'swapYes', game.turnNo);
    assert.deepEqual(game.racks.get('p1'), [...'AUIAERS'], 'Q and Z were swapped for two new tiles');
    assert.equal(game.bag.length, 8);
    assert.deepEqual([...game.bag].sort(), [...'AAAAAAQZ']);
    assert.equal(game.turn, 1);
    assert.equal(game.scoreless, 1);
    assert.match(viewOf('p1'), /🔁 You swapped 2 tiles and drew \*\*A\*\*₁ \*\*A\*\*₁/);
    assert.match(latest(), /<@p1> swapped 2 tiles/);
    assert.doesNotMatch(latest(), /\*\*[QZA]\*\*/, 'which tiles stays private');

    // Too few tiles left to swap
    game.bag = [...'AAAAAA'];
    await click(game, 'p2', 'tiles');
    assert.match(viewOf('p2'), /swapping needs 7 tiles in the bag/);
    assert.equal(componentIn(lastView('p2'), 'swap').disabled, true);
    await tap(game, 'p2', 'swap');
    assert.match(viewOf('p2'), /Swapping needs at least 7 tiles in the bag, and there are only 6/);
    assert.equal(game.turn, 1);
});

test('word tiles: pass asks first; shuffle only reorders your tiles; six scoreless turns end the game', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { p1: 'QUIZERS', p2: 'TAXBONE' });
    await click(game, 'p1', 'tiles');
    await click(game, 'p2', 'tiles');

    await tap(game, 'p1', 'pass');
    assert.match(viewOf('p1'), /Pass your turn\?/);
    assert.equal(game.turn, 0, 'nothing happens until it\'s confirmed');
    await tap(game, 'p1', 'back');
    assert.match(viewOf('p1'), /\*\*Your turn!\*\*/);

    const shown = screens.length;
    await tap(game, 'p2', 'shuffle');
    assert.deepEqual([...game.racks.get('p2')].sort(), [...'TAXBONE'].sort());
    assert.equal(screens.length, shown, 'shuffling is private');
    assert.equal(game.turn, 0);

    for (let i = 0; i < 4; i++) await pass(game, game.players[game.turn]);
    assert.match(latest(), /4 scoreless turns in a row \(6 ends the game\)/);
    await pass(game, 'p1');
    await tap(game, 'p2', 'pass');
    assert.match(viewOf('p2'), /That makes 6 scoreless turns in a row, which \*\*ends the game\*\*/);
    await tap(game, 'p2', 'passYes', game.turnNo);

    assert.equal(game.state, 'over');
    assert.equal(games.size, 0);
    assert.equal(game.scores.get('p1'), -wordTiles.rackValue([...'QUIZERS']));
    assert.equal(game.scores.get('p2'), -wordTiles.rackValue([...'TAXBONE']));
    assert.match(latest(), /6 scoreless turns in a row ended the game/);
    assert.match(latest(), /<@p2> wins!/, 'p2 lost fewer points');
    assert.match(latest(), /🏆 <@p2> · \*\*-16\*\* \(−16\)/);
    assert.match(latest(), /▫️ <@p1> · \*\*-25\*\* \(−25\)/);
    assert.match(viewOf('p2'), /🏆 \*\*You won\*\*/);
    assert.match(viewOf('p1'), /<@p2> won with \*\*-16\*\* · you scored \*\*-25\*\*/);
    const p2coins = winnerReward('wordTiles', 2);
    assert.equal(await balanceOf('p2'), p2coins, 'no coins for points below zero, but the win pays');
    assert.equal(await balanceOf('p1'), 0);
});

// ─── Leaving ──────────────────────────────────────────────────
test('word tiles: leaving asks first; your tiles go back; the turn moves on; the last one in wins', async () => {
    const game = await startGame(['p1', 'p2', 'p3']);
    deal(game, { p1: 'QUIZERS', p2: 'TAXBONE', p3: 'AEIOULN' }, 'DDDD');
    await click(game, 'p1', 'tiles');
    await tap(game, 'p1', 'quit');
    assert.match(viewOf('p1'), /Leave the game\?/);
    assert.equal(game.players.length, 3);
    const left = await tap(game, 'p1', 'quitYes');
    assert.match(text(left.shown[0]), /You left the game\. Your tiles went back into the bag/);
    assert.deepEqual(game.players, ['p2', 'p3']);
    assert.equal(game.bag.length, 4 + 7);
    assert.equal(game.racks.has('p1'), false);
    assert.equal(game.views.has('p1'), false, 'a leaver\'s view stops updating');
    assert.equal(game.turn, 0, 'p1 was up, so p2 takes over');
    assert.match(latest(), /🚪 <@p1> left the game · their tiles went back into the bag/);
    assert.match(latest(), /Out: <@p1> left/);
    assert.match(notice(await click(game, 'p1', 'tiles')), /You left this game/);
    assert.match(viewOf('p1'), /You left the game/);

    game.scores.set('p3', 60);
    await click(game, 'p2', 'tiles');
    await tap(game, 'p2', 'quit');
    await tap(game, 'p2', 'quitYes');
    assert.equal(game.state, 'over');
    assert.deepEqual(game.winners, ['p3']);
    assert.match(latest(), /<@p3> wins!/);
    assert.match(latest(), /Everyone else left, so <@p3> wins/);
    assert.match(latest(), /🚪 <@p1> · left/);
    assert.match(latest(), /🚪 <@p2> · left/);
    // Nobody was beaten (they left), so only the points pay: 60 points → 2 coins
    assert.equal(await balanceOf('p3'), 2);
    const stats = await GameStats.find({ game: 'wordTiles' }).lean();
    assert.deepEqual(stats.map(s => [s.userId, s.played, s.wins]).sort(), [['p1', 1, 0], ['p2', 1, 0], ['p3', 1, 1]], 'leaving still counts as a game played');
});

// ─── A whole game ─────────────────────────────────────────────
test('word tiles: a full game: going out ends it, the leftovers move, and coins and stats are saved', async () => {
    const game = await startGame(['p1', 'p2']);
    deal(game, { p1: 'QUIZAT', p2: 'AXOB?' }, '');

    await playWord(game, 'p1', 'QUIZ', 'H8');
    assert.match(viewOf('p1'), /The bag is empty, so you drew nothing/);
    assert.match(latest(), /🎒 the bag is empty/);
    await playWord(game, 'p2', 'ZA', 'K8', 'down');
    assert.equal(game.scores.get('p2'), 11);
    await playWord(game, 'p1', 'QAT', 'H8', 'down');
    assert.equal(game.state, 'over');
    assert.equal(games.size, 0);

    // p1: 44 + 12, plus p2's leftover X, O, B and blank (12); p2: 11 − 12
    assert.equal(game.scores.get('p1'), 68);
    assert.equal(game.scores.get('p2'), -1);
    const r = gameConfig.REWARDS.wordTiles;
    const p1coins = Math.floor(68 / r.pointsPerCoin) + winnerReward('wordTiles', 2);
    assert.match(latest(), /Word Tiles · <@p1> wins!/);
    assert.match(latest(), /🏁 <@p1> used their last tile! .*\(\+12\)/);
    assert.match(latest(), new RegExp(`🏆 <@p1> · \\*\\*68\\*\\* \\(\\+12\\) · \\+${p1coins} 🪙`));
    assert.match(latest(), /▫️ <@p2> · \*\*-1\*\* \(−12\)/);
    assert.match(latest(), /Last move: \*\*<@p1>\*\* played \*\*QAT\*\* for \*\*12\*\*/);
    assert.match(latest(), /games:again:wordTiles/, 'a finished game offers a rematch');
    assert.match(viewOf('p1'), new RegExp(`🏆 \\*\\*You won\\*\\* with \\*\\*68\\*\\* points! · \\+${p1coins} 🪙`));
    assert.match(viewOf('p2'), /<@p1> won with \*\*68\*\* · you scored \*\*-1\*\*/);
    assert.equal(await balanceOf('p1'), p1coins);
    assert.equal(await balanceOf('p2'), 0);

    const stats = Object.fromEntries((await GameStats.find({ game: 'wordTiles' }).lean()).map(s => [s.userId, [s.played, s.wins, s.best]]));
    assert.deepEqual(stats, { p1: [1, 1, 68], p2: [1, 0, -1] });
    assert.match(notice(await click(game, 'p2', 'tiles')), /has ended/);
    assert.equal((await GameStats.findOne({ userId: 'p1', game: 'wordTiles' }).lean()).played, 1, 'recorded once');
});

// ─── Privacy ──────────────────────────────────────────────────
test('word tiles: racks never show anywhere public, and each view shows only its owner\'s tiles', async () => {
    gameConfig.TURN_PING_SECONDS = 0.05; // so pings go out too
    const game = await startGame(['p1', 'p2', 'p3']);
    const racks = { p1: 'QUIZERS', p2: 'JXKVWYF', p3: 'BCMPHDG' };
    deal(game, racks, 'AAAAAAAAOOOOOOOOLLLLNNNNTTTT');
    for (const p of ['p1', 'p2', 'p3']) await click(game, p, 'tiles');
    await submit(game, 'p1', 'QUIZ', 'H8');
    await wait(100);
    const refusals = [await click(game, 'p9', 'tiles'), await click(game, 'p2', 'join'), await click(game, 'p3', 'leave')];
    await tap(game, 'p2', 'word'); // not p2's turn
    await tap(game, 'p1', 'play', game.turnNo);
    await tap(game, 'p2', 'swap');
    await tap(game, 'p2', 'swapPick', '', ['0', '1']);
    await tap(game, 'p2', 'swapYes', game.turnNo);
    await pass(game, 'p3');
    await wait(100);

    // The game message, pings and notices: no tile ever appears as a tile (a bold letter, or a point value)
    const shared = [...screens, ...posts, ...notices, ...refusals.flatMap(r => r.replies)];
    assert.ok(screens.length >= 4 && posts.length >= 1 && notices.length >= 3);
    for (const p of shared) {
        assert.doesNotMatch(text(p), SUBSCRIPT, 'no point values (only racks show those)');
        assert.doesNotMatch(text(p), /\*\*[A-Z?]\*\*/, 'no single tiles');
    }
    for (const letters of Object.values(racks)) {
        for (const p of shared) assert.ok(!text(p).includes(letters) && !text(p).includes([...letters].join(' ')), 'no rack spelled out');
    }

    // Each view shows its owner's tiles and nobody else's, at every step
    for (const [owner, letters] of Object.entries(racks)) {
        assert.ok(views.get(owner).some(v => text(v).includes(tileText(letters[0]))), `${owner} saw their tiles`);
        for (const [other, theirs] of Object.entries(racks)) {
            if (other === owner) continue;
            for (const v of views.get(owner)) {
                for (const letter of new Set(theirs)) {
                    if (!game.racks.get(owner)?.includes(letter)) assert.ok(!text(v).includes(tileText(letter)), `${owner}'s view showed ${other}'s ${letter}`);
                }
            }
        }
    }
});

// ─── Discord's limits ─────────────────────────────────────────
test('word tiles: the game message with 4 players, every private view and the form fit Discord\'s limits', async () => {
    const check = (payload, label) => {
        const { count, textLength, ids, json } = inspectPanel(payload);
        assert.ok(count <= 40 && textLength <= 4000, `${label}: ${count} components, ${textLength} characters`);
        assert.equal(new Set(ids).size, ids.length, `${label}: duplicate custom_id`);
        assert.ok(ids.every(id => id.length <= 100), `${label}: custom_id too long`);
        const walk = (c) => {
            if (c.type === 1) assert.ok(c.components.length <= 5, `${label}: a row with ${c.components.length} items`);
            if (c.type === 3) assert.ok(c.options.length <= 25, `${label}: a menu with ${c.options.length} options`);
            for (const child of c.components ?? []) walk(child);
        };
        json.forEach(walk);
    };
    const game = await startGame(['p1', 'p2', 'p3', 'p4']);
    deal(game, { p1: 'RETAINS', p2: 'QUIZE??', p3: 'AEIOULN', p4: 'TAXBONE' });
    check(screens.at(-1), 'start');

    await click(game, 'p1', 'tiles');
    check(lastView('p1'), 'my turn');
    const form = (await tap(game, 'p1', 'word')).modal.toJSON(); // toJSON validates
    assert.ok(form.components.length <= 5 && form.title.length <= 45);
    await submit(game, 'p1', 'QXZ', 'H8');
    check(lastView('p1'), 'a mistake');
    await submit(game, 'p1', 'RETAINS', 'H8', 'down');
    check(lastView('p1'), 'preview');
    await tap(game, 'p1', 'play', game.turnNo);
    check(lastView('p1'), 'after playing');
    check(screens.at(-1), 'after a bingo');

    await click(game, 'p2', 'tiles');
    await tap(game, 'p2', 'swap');
    await tap(game, 'p2', 'swapPick', '', ['0', '1', '2', '3', '4', '5', '6']);
    check(lastView('p2'), 'swap, all picked');
    await tap(game, 'p2', 'pass');
    game.scoreless = 5;
    await tap(game, 'p2', 'back');
    await tap(game, 'p2', 'pass');
    assert.match(viewOf('p2'), /ends the game/);
    check(lastView('p2'), 'pass, with the warning');
    game.scoreless = 0;
    await tap(game, 'p2', 'quit');
    check(lastView('p2'), 'leave');
    await tap(game, 'p2', 'quitYes');
    check(lastView('p2'), 'left');
    check(screens.at(-1), 'with someone gone');

    await click(game, 'p4', 'tiles');
    check(lastView('p4'), 'not my turn');
    for (const p of ['p3', 'p4']) {
        await click(game, p, 'tiles');
        await tap(game, p, 'quit');
        if (games.size) await tap(game, p, 'quitYes');
    }
    assert.equal(game.state, 'over');
    check(screens.at(-1), 'final');
    check(lastView('p1'), 'game over');
});
