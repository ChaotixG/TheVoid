// Word Tiles: the classic crossword tile game for 2 to 4 players. Everyone holds 7 letter tiles in
// a private view; on your turn you type a word, the square its first letter goes on and its
// direction, see a preview with the score, then play it. Bonus squares multiply letters and words,
// using all 7 tiles at once is worth 50 more, and the highest score when the tiles run out wins.
// Racks are secret: they're only ever shown in their owner's private view, never on the game
// message, in a notice or in a ping. The game message shows the board, scores and tile counts.
const { randomInt } = require('crypto');
const { AttachmentBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const gameConfig = require('../../config/games'); // read when used, so tests can shorten the timers
const { row, button, gallery, ButtonStyle } = require('../../utils/panels');
const { getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, editGame, notify } = require('./common');
const { openLobby, handleLobby, LOBBY_ACTIONS } = require('./lobby');
const { openView, trackView, refreshViews, dropView } = require('./privateViews');
const { announceTurn } = require('./turns');
const { recordGame } = require('./stats');
const { winnerReward } = require('./scoring');
const { payEach } = require('./rewards');
const { isWord } = require('./words');
const { drawBoard } = require('./wordTilesBoard');
const { SIZE, CENTER, RACK_SIZE, BINGO_BONUS, TILES, points, bonusAt, squareName, parseSquare, emptyBoard } = require('./wordTilesData');

const TITLE = '🔠 Word Tiles';
const COLOR = 0xD4A157;
const SCORELESS_END = 6; // this many passes, swaps or timeouts in a row end the game
const BOARD_FILE = 'board.png';
const settings = () => gameConfig.PARTY.wordTiles;

const DIRECTIONS = {
    across: { dr: 0, dc: 1, name: 'across', label: 'Across →' },
    down: { dr: 1, dc: 0, name: 'down', label: 'Down ↓' },
};
const OTHER_WAY = { across: 'down', down: 'across' };
const LETTER_BONUS = { DL: 2, TL: 3 };
const WORD_BONUS = { DW: 2, TW: 3 };
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

const at = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tileCount = (n) => plural(n, 'tile');
const key = (row, col) => `${row},${col}`;
// "a Z", "an X": by how the letter's name sounds
const article = (letter) => ('AEFHILMNORSX'.includes(letter) ? 'an' : 'a');
const listText = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0]);

// ─── Tiles ────────────────────────────────────────────────────
/** The 100 tiles, unshuffled. '?' is a blank. */
const newBag = () => Object.entries(TILES).flatMap(([letter, [count]]) => Array(count).fill(letter));

/** A shuffled copy (Fisher–Yates). `random(n)` picks 0…n-1; crypto by default, tests can pass their own. */
function shuffle(items, random = randomInt) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// The bag and the seating at the start; tests replace these to choose them
const dealer = {
    bag: () => shuffle(newBag()),
    order: (players) => shuffle(players),
};

const rackValue = (rack) => rack.reduce((sum, letter) => sum + points(letter), 0);
const subscript = (n) => [...String(n)].map(d => SUBSCRIPTS[d]).join('');
/** A rack as text, e.g. **Q**₁₀ **U**₁ **?**₀ (only ever shown to its owner) */
const showRack = (rack) => rack.map(letter => `**${letter}**${subscript(points(letter))}`).join(' ');

function countLetters(letters) {
    const counts = new Map();
    for (const letter of letters) counts.set(letter, (counts.get(letter) ?? 0) + 1);
    return counts;
}

// ─── Rules ────────────────────────────────────────────────────
const inBounds = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const tileAt = (board, row, col) => (inBounds(row, col) ? board[row][col] : null);
const boardIsEmpty = (board) => board.every(squares => squares.every(square => !square));

// The unbroken line of tiles through (row, col) going `dir`, counting the tiles about to be placed
// (`placing`: "row,col" → tile)
function lineThrough(board, placing, row, col, { dr, dc }) {
    const tile = (r, c) => placing.get(key(r, c)) ?? tileAt(board, r, c);
    let r = row;
    let c = col;
    while (tile(r - dr, c - dc)) {
        r -= dr;
        c -= dc;
    }
    const squares = [];
    for (; tile(r, c); r += dr, c += dc) squares.push({ row: r, col: c, tile: tile(r, c), isNew: placing.has(key(r, c)) });
    return squares;
}

const wordOf = (squares) => squares.map(s => s.tile.letter).join('');

// Letter bonuses count only under new tiles; so do word bonuses, which multiply the whole word
function scoreWord(squares) {
    let sum = 0;
    let multiplier = 1;
    for (const { row, col, tile, isNew } of squares) {
        const bonus = isNew ? bonusAt(row, col) : null;
        sum += (tile.blank ? 0 : points(tile.letter)) * (LETTER_BONUS[bonus] ?? 1);
        multiplier *= WORD_BONUS[bonus] ?? 1;
    }
    return sum * multiplier;
}

// "QUIZ needs a Z you don't have", from the letters it's short of: { letter, missing, has }
function missingText(word, short, blanks) {
    const needs = short.map(({ letter, missing, has }) => {
        if (missing === 1) return has ? `another **${letter}**` : `${article(letter)} **${letter}**`;
        return `${missing} ${has ? 'more ' : ''}**${letter}**s`;
    });
    const blankNote = blanks ? `, and your ${blanks === 1 ? 'blank covers' : `${blanks} blanks cover`} only ${blanks === 1 ? 'one' : blanks}` : '';
    return `**${word}** needs ${listText(needs)} you don't have${blankNote}.`;
}

/**
 * Checks a move: `word` is the whole word as it will read, its first letter goes on `start` ("H8",
 * "8H" or { row, col }) and it runs `direction` ('across' or 'down'). Blanks stand in for letters
 * missing from `rack`, on the squares where a real tile would score the least.
 * Returns { placed, words, score, bingo } (placed: the new tiles as { row, col, letter, blank };
 * words: { word, score }, the typed word first), or { error } saying what's wrong.
 */
function checkMove(board, rack, word, start, direction) {
    const typed = String(word ?? '').trim().toUpperCase();
    if (!/^[A-Z]*$/.test(typed)) return { error: 'Use letters only (A to Z), with no spaces or symbols.' };
    if (typed.length < 2 || typed.length > SIZE) return { error: `A word has 2 to ${SIZE} letters${typed ? `, and **${typed}** has ${typed.length}` : ''}.` };
    const from = typeof start === 'object' && start ? start : parseSquare(start);
    if (!from) return { error: `**${String(start ?? '').trim().toUpperCase() || '?'}** isn't a square. Use a column A to O and a row 1 to 15, like **H8**.` };
    const dir = DIRECTIONS[direction];
    if (!dir) return { error: 'Choose a direction: **Across →** or **Down ↓**.' };
    const startName = squareName(from.row, from.col);

    const room = dir.dc ? SIZE - from.col : SIZE - from.row;
    if (typed.length > room) {
        return { error: `**${typed}** runs off the board: going ${dir.name} from **${startName}** there's only room for ${plural(room, 'letter')}.` };
    }

    // Squares already filled must hold the typed letter; the empty ones get tiles from the rack
    const placing = new Map(); // "row,col" → the new tile
    const fresh = [];          // the new tiles' squares, in word order
    for (let i = 0; i < typed.length; i++) {
        const r = from.row + dir.dr * i;
        const c = from.col + dir.dc * i;
        const letter = typed[i];
        const existing = board[r][c];
        if (existing && existing.letter !== letter) {
            return { error: `**${squareName(r, c)}** already has ${article(existing.letter)} **${existing.letter}**, but **${typed}** needs ${article(letter)} **${letter}** there. Type the word exactly as it will read on the board.` };
        }
        if (!existing) {
            const tile = { letter, blank: false };
            placing.set(key(r, c), tile);
            fresh.push({ row: r, col: c, letter, tile });
        }
    }
    if (!fresh.length) return { error: `Every letter of **${typed}** is already on the board. Your word needs at least one tile of your own.` };

    // The typed word must be the whole word: tiles touching either end would join onto it
    const line = lineThrough(board, placing, from.row, from.col, dir);
    if (line.length !== typed.length) {
        const full = wordOf(line);
        const lead = line.findIndex(s => s.row === from.row && s.col === from.col);
        const before = full.slice(0, lead);
        const after = full.slice(lead + typed.length);
        const extra = before && after ? `**${before}** and **${after}**` : `**${before || after}**`;
        return { error: `That makes **${full}** with the ${extra} already on the board. Type the whole word${before ? `, starting at **${squareName(line[0].row, line[0].col)}**` : ''}.` };
    }

    if (boardIsEmpty(board)) {
        if (!placing.has(key(CENTER, CENTER))) return { error: `The first word must cover the ★ square (**${squareName(CENTER, CENTER)}**).` };
    } else if (fresh.length === typed.length && !fresh.some(s => NEIGHBORS.some(([dr, dc]) => tileAt(board, s.row + dr, s.col + dc)))) {
        return { error: 'The word has to connect to tiles on the board: use one of their letters, or put a tile right next to one.' };
    }

    if (!isWord(typed.toLowerCase())) return { error: `**${typed}** isn't in my word list.` };

    // Enough tiles? Blanks make up for missing letters.
    const have = countLetters(rack);
    const byLetter = new Map();
    for (const s of fresh) byLetter.set(s.letter, [...(byLetter.get(s.letter) ?? []), s]);
    const short = [];
    for (const [letter, squares] of byLetter) {
        const has = have.get(letter) ?? 0;
        if (squares.length > has) short.push({ letter, missing: squares.length - has, has });
    }
    const blanks = have.get('?') ?? 0;
    if (short.reduce((n, s) => n + s.missing, 0) > blanks) return { error: missingText(typed, short, blanks) };

    // Every new tile also makes a word across its line, when it touches tiles that way
    const crossDir = DIRECTIONS[OTHER_WAY[direction]];
    for (const s of fresh) {
        const cross = lineThrough(board, placing, s.row, s.col, crossDir);
        s.cross = cross.length >= 2 ? cross : null;
    }
    const crosses = fresh.filter(s => s.cross);
    const bad = crosses.filter(s => !isWord(wordOf(s.cross).toLowerCase()));
    if (bad.length === 1) {
        const [s] = bad;
        return { error: `Your **${s.letter}** on **${squareName(s.row, s.col)}** would also make **${wordOf(s.cross)}** going ${crossDir.name}, and that isn't in my word list.` };
    }
    if (bad.length) return { error: `That would also make ${listText(bad.map(s => `**${wordOf(s.cross)}**`))}, which aren't in my word list.` };

    // Real tiles go where they're worth the most (a letter bonus, and every word they're part of);
    // blanks score 0 wherever they go, so they take the other squares
    const mainBonus = fresh.reduce((m, s) => m * (WORD_BONUS[bonusAt(s.row, s.col)] ?? 1), 1);
    const worth = (s) => {
        const bonus = bonusAt(s.row, s.col);
        return (LETTER_BONUS[bonus] ?? 1) * (mainBonus + (s.cross ? WORD_BONUS[bonus] ?? 1 : 0));
    };
    for (const { letter } of short) {
        const squares = [...byLetter.get(letter)].sort((a, b) => worth(b) - worth(a));
        for (const s of squares.slice(have.get(letter) ?? 0)) s.tile.blank = true;
    }

    const words = [
        { word: typed, score: scoreWord(line) },
        ...crosses.map(s => ({ word: wordOf(s.cross), score: scoreWord(s.cross) })),
    ];
    const bingo = fresh.length === RACK_SIZE;
    return {
        placed: fresh.map(s => ({ row: s.row, col: s.col, letter: s.letter, blank: s.tile.blank })),
        words,
        score: words.reduce((n, w) => n + w.score, 0) + (bingo ? BINGO_BONUS : 0),
        bingo,
    };
}

const swapTooFew = (bag) =>
    `Swapping needs at least ${RACK_SIZE} tiles in the bag, and there ${bag.length === 1 ? 'is' : 'are'} only ${bag.length}. Play a word or pass.`;

/**
 * Swaps `letters` out of a rack. New tiles are drawn first, then the old ones go back into the bag
 * and it's shuffled (so you never draw back what you put in). Needs a full rack's worth in the bag.
 * Returns { rack, bag, drawn } or { error }.
 */
function swapTiles(rack, bag, letters, random = randomInt) {
    if (bag.length < RACK_SIZE) return { error: swapTooFew(bag) };
    if (!letters.length) return { error: 'Pick at least one tile to swap.' };
    const slots = []; // where each swapped tile sits in the rack (its replacement goes there)
    for (const letter of letters) {
        const slot = rack.findIndex((l, i) => l === letter && !slots.includes(i));
        if (slot < 0) return { error: `You don't have ${article(letter)} **${letter}** to swap.` };
        slots.push(slot);
    }
    const rest = [...bag];
    const drawn = rest.splice(rest.length - letters.length);
    const newRack = [...rack];
    slots.forEach((slot, i) => { newRack[slot] = drawn[i]; });
    return { rack: newRack, bag: shuffle([...rest, ...letters], random), drawn };
}

/**
 * Points added at the end ("userId" → points), from the racks of the players still in: leftover
 * tiles count against their owner, and whoever went out (`wentOut`) gets everyone else's total.
 */
function endingAdjustments(racks, wentOut = null) {
    const adjust = new Map();
    let total = 0;
    for (const [userId, rack] of racks) {
        if (userId === wentOut) continue;
        const value = rackValue(rack);
        adjust.set(userId, -value);
        total += value;
    }
    if (wentOut) adjust.set(wentOut, total);
    return adjust;
}

/**
 * Coins for the players still in at the end: 1 per `pointsPerCoin` points, plus the winner's
 * reward (each, on a tie), which grows with the players they beat. Players who left or timed out
 * don't count, so nobody earns a win from opponents who just left (e.g. a second account joining
 * and leaving).
 */
function coinAwards(players, scores, winners) {
    const { pointsPerCoin } = gameConfig.REWARDS.wordTiles;
    const beaten = players.filter(id => !winners.includes(id)).length;
    return players.map(userId => ({
        userId,
        amount: Math.floor(Math.max(0, scores.get(userId)) / pointsPerCoin) +
            (beaten && winners.includes(userId) ? winnerReward('wordTiles', beaten + 1) : 0),
    }));
}

// ─── Turns ────────────────────────────────────────────────────
const current = (game) => game.players[game.turn];

// Starts the turn of whoever sits at `seat`, with a fresh timer
function startTurn(game, seat) {
    clearTimeout(game.timer);
    game.turn = seat;
    const turnNo = ++game.turnNo; // forms and previews from an earlier turn are refused
    const ms = settings().turnSeconds * 1000;
    game.turnEndsAt = Date.now() + ms;
    game.timer = setTimeout(() => runExclusive(game, () => timeUp(game, turnNo)), ms);
    announceTurn(game, current(game));
}

const nextTurn = (game) => startTurn(game, (game.turn + 1) % game.players.length);

// Draws up to n tiles onto someone's rack (fewer when the bag runs low)
function drawTiles(game, userId, n) {
    const drawn = game.bag.splice(Math.max(0, game.bag.length - n));
    game.racks.get(userId).push(...drawn);
    return drawn;
}

// Puts a checked move on the board, scores it and refills the rack. Returns the tiles drawn.
function applyMove(game, userId, move) {
    const rack = game.racks.get(userId);
    for (const t of move.placed) {
        game.board[t.row][t.col] = { letter: t.letter, blank: t.blank };
        rack.splice(rack.indexOf(t.blank ? '?' : t.letter), 1);
    }
    game.scores.set(userId, game.scores.get(userId) + move.score);
    game.scoreless = 0;
    game.last = { kind: 'play', userId, move };
    return drawTiles(game, userId, RACK_SIZE - rack.length);
}

// A pass, swap or timeout: the next player's turn, unless that made too many scoreless turns in a row
function scorelessTurn(game) {
    game.scoreless++;
    if (game.scoreless >= SCORELESS_END) finish(game, 'scoreless');
    else nextTurn(game);
}

// "twice in a row": how many timeouts in a row take a player out
function inARow() {
    const n = settings().missedTurnsOut;
    return n === 1 ? 'once' : n === 2 ? 'twice in a row' : `${n} turns in a row`;
}

// A turn ran out: it counts as a pass. Running out of time too many turns in a row takes the
// player out, so one person who walked away doesn't hold up every round.
async function timeUp(game, turnNo) {
    if (!getGame(game.id) || game.state !== 'playing' || game.turnNo !== turnNo) return;
    const userId = current(game);
    const missed = (game.missed.get(userId) ?? 0) + 1;
    game.missed.set(userId, missed);
    if (missed < settings().missedTurnsOut) {
        game.last = { kind: 'timeout', userId };
        scorelessTurn(game);
        return afterMove(game);
    }
    game.scoreless++; // their last timeout still counts toward the scoreless ending
    removePlayer(game, userId, 'timed out');
    if (game.state !== 'over' && game.scoreless >= SCORELESS_END) finish(game, 'scoreless');
    await afterMove(game);  // their open view says they're out…
    dropView(game, userId); // …and then stops updating
}

// Takes a player out (they left, or kept running out of time): their tiles go back into the bag.
// The last player still in wins.
function removePlayer(game, userId, reason) {
    const seat = game.players.indexOf(userId);
    const wasTheirTurn = seat === game.turn;
    game.players.splice(seat, 1);
    game.bag = shuffle([...game.bag, ...game.racks.get(userId)]);
    game.racks.delete(userId);
    game.pending.delete(userId);
    game.out.set(userId, reason);
    game.last = { kind: reason === 'left' ? 'leave' : 'out', userId };
    if (game.players.length === 1) return finish(game, 'alone');
    if (seat < game.turn) game.turn--; // same player's turn, one seat down
    else if (wasTheirTurn) startTurn(game, seat % game.players.length);
}

// Ends the game: 'out' (`by` used their last tile with the bag empty), 'scoreless' or 'alone'
function finish(game, how, by = null) {
    clearTimeout(game.timer);
    endGame(game);
    game.state = 'over';
    const adjust = how === 'alone' ? new Map() : endingAdjustments(game.players.map(id => [id, game.racks.get(id)]), by);
    for (const [id, change] of adjust) game.scores.set(id, game.scores.get(id) + change);
    game.ending = { how, by, adjust };
    const best = Math.max(...game.players.map(id => game.scores.get(id)));
    game.winners = game.players.filter(id => game.scores.get(id) === best);
}

// After a move: settle up if the game ended, then show it on the game message and in everyone's
// open view. `except` is the player whose view their own click just updated; at the end every
// view is redrawn, so everyone sees their coins.
async function afterMove(game, { except = null } = {}) {
    if (game.state === 'over') {
        game.rewards = await payEach(coinAwards(game.players, game.scores, game.winners), { guildId: game.guildId, game: 'Word Tiles' });
        // Everyone who started counts as having played, so leaving a lost game doesn't hide the loss
        await recordGame({ id: game.id, type: game.type, players: game.started }, {
            winners: game.winners,
            scores: Object.fromEntries(game.players.map(id => [id, game.scores.get(id)])),
        });
    }
    await editGame(game, render(game));
    await refreshViews(game, tilesView, { except: game.state === 'over' ? null : except });
}

async function begin(game) {
    game.players = dealer.order(game.players);
    game.started = [...game.players];
    game.bag = dealer.bag();
    game.board = emptyBoard();
    game.racks = new Map(game.players.map(id => [id, []]));
    game.scores = new Map(game.players.map(id => [id, 0]));
    for (const id of game.players) drawTiles(game, id, RACK_SIZE);
    game.turnNo = 0;
    game.scoreless = 0;
    game.out = new Map();     // userId → 'left' or 'timed out'
    game.missed = new Map();  // userId → turns run out of in a row
    game.pending = new Map(); // userId → what their view is in the middle of (see pendingFor)
    game.drafts = new Map();  // userId → their last typed word this turn, to fill the form in again
    game.last = { kind: 'start', userId: game.players[0] };
    game.png = await drawBoard(game.board);
    game.onExpire = () => {
        game.state = 'over';
        game.expired = true;
        refreshViews(game, tilesView); // open views say so too (not awaited: this returns the board)
        return render(game);
    };
    startTurn(game, 0);
}

// ─── Clicks ───────────────────────────────────────────────────
// What someone's view is in the middle of, so a refresh after another player's move shows it
// instead of throwing it away: { kind: 'quit' }, or for this turn only { kind: 'preview' | 'swap' | 'pass', turnNo, … }
function pendingFor(game, userId) {
    const pending = game.pending.get(userId);
    if (!pending || pending.kind === 'quit') return pending ?? null;
    return pending.turnNo === game.turnNo && current(game) === userId ? pending : null;
}

const draftFor = (game, userId) => {
    const draft = game.drafts.get(userId);
    return draft?.turnNo === game.turnNo ? draft : null;
};

const tryAgain = (error) => `❌ ${error}\n-# Press **✏️ Play word** to try again (what you typed is filled in).`;

async function handle(game, interaction, action, arg) {
    if (await handleLobby(game, interaction, action)) return;
    const userId = interaction.user.id;

    // Lobby buttons clicked after the game began (already acknowledged)
    if (LOBBY_ACTIONS.includes(action)) {
        if (action === 'join') return notify(interaction, 'This game has already started. Catch the next one!');
        if (action === 'leave') return notify(interaction, 'To leave, open **🔠 My tiles** and press **Leave**.');
        return;
    }

    if (action === 'tiles') {
        if (!game.players.includes(userId)) return notify(interaction, outLine(game, userId));
        return openView(game, interaction, tilesView(game, userId));
    }

    // Everything else comes from someone's private view, and is answered by updating that view.
    // Views update themselves, but a click can still race a move or the timer, so each one is
    // checked against the game as it is now.
    const respond = (payload) => (interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.update(payload));
    if (!game.players.includes(userId)) return respond(closedView(outLine(game, userId)));
    touch(game, interaction);
    const pending = game.pending;
    const answer = async (payload) => {
        await respond(payload);
        trackView(game, interaction);
    };
    const refresh = (note) => answer(tilesView(game, userId, { note }));

    switch (action) {
        case 'back':
            pending.delete(userId);
            return refresh();
        case 'shuffle':
            pending.delete(userId);
            game.racks.set(userId, shuffle(game.racks.get(userId)));
            return refresh();
        case 'quit':
            pending.set(userId, { kind: 'quit' });
            return refresh();
        case 'quitYes':
            removePlayer(game, userId, 'left');
            await respond(closedView('You left the game. Your tiles went back into the bag.'));
            dropView(game, userId);
            return afterMove(game, { except: userId });
    }
    if (!['word', 'change', 'submit', 'play', 'swap', 'swapPick', 'swapYes', 'pass', 'passYes'].includes(action)) {
        return interaction.deferred || interaction.replied ? undefined : interaction.deferUpdate();
    }

    // Turn actions. Forms and confirmations carry their turn number, so one from an earlier turn
    // (the time ran out while it was open) is refused instead of landing on a later turn.
    const stale = ['submit', 'play', 'swapYes', 'passYes'].includes(action) && Number(arg) !== game.turnNo;
    if (stale) {
        const now = current(game) === userId ? 'The board may have changed, so check it and try again.' : `It's <@${current(game)}>'s turn now.`;
        return refresh(`⌛ Too late: your turn ended before that arrived, so nothing was played. ${now}`);
    }
    if (current(game) !== userId) return refresh(`It's <@${current(game)}>'s turn, not yours. Your buttons wake up when it's your turn.`);

    switch (action) {
        case 'word':
        case 'change':
            return interaction.showModal(wordForm(game, userId));
        case 'submit':
            return submitWord(game, interaction, userId, answer);
        case 'play':
            return playWord(game, userId, answer);
        case 'swap':
            if (game.bag.length < RACK_SIZE) return refresh(swapTooFew(game.bag));
            pending.set(userId, { kind: 'swap', turnNo: game.turnNo, picked: [] });
            return refresh();
        case 'swapPick': {
            const swap = pendingFor(game, userId);
            if (swap?.kind !== 'swap') return refresh();
            const rack = game.racks.get(userId);
            const slots = [...new Set((interaction.values ?? []).map(Number))].filter(i => i >= 0 && i < rack.length);
            swap.picked = slots.map(i => rack[i]);
            return refresh();
        }
        case 'swapYes': {
            const swap = pendingFor(game, userId);
            const result = swapTiles(game.racks.get(userId), game.bag, swap?.kind === 'swap' ? swap.picked : []);
            if (result.error) return refresh(result.error);
            pending.delete(userId);
            game.racks.set(userId, result.rack);
            game.bag = result.bag;
            game.last = { kind: 'swap', userId, count: result.drawn.length };
            game.missed.set(userId, 0); // they're here, so missed turns count from zero again
            scorelessTurn(game);
            await refresh(game.state === 'over' ? null : `🔁 You swapped ${tileCount(result.drawn.length)} and drew ${showRack(result.drawn)}.`);
            return afterMove(game, { except: userId });
        }
        case 'pass':
            pending.set(userId, { kind: 'pass', turnNo: game.turnNo });
            return refresh();
        case 'passYes':
            pending.delete(userId);
            game.last = { kind: 'pass', userId };
            game.missed.set(userId, 0);
            scorelessTurn(game);
            await refresh(game.state === 'over' ? null : '⏭️ You passed.');
            return afterMove(game, { except: userId });
    }
}

// The word form was sent: check the move and show a preview (or what's wrong) in the private view
async function submitWord(game, interaction, userId, answer) {
    const draft = {
        turnNo: game.turnNo,
        word: interaction.fields.getTextInputValue('word').trim().toUpperCase(),
        square: interaction.fields.getTextInputValue('square').trim().toUpperCase(),
        direction: interaction.fields.getStringSelectValues('direction')[0] ?? 'across',
    };
    game.drafts.set(userId, draft);
    const move = checkMove(game.board, game.racks.get(userId), draft.word, draft.square, draft.direction);
    if (move.error) {
        game.pending.delete(userId);
        return answer(tilesView(game, userId, { note: tryAgain(move.error) }));
    }
    const png = await drawBoard(game.board, { pending: move.placed });
    game.pending.set(userId, { kind: 'preview', turnNo: game.turnNo, draft, move, png });
    return answer(tilesView(game, userId));
}

// Play it: checked again (it's quick, and nothing is played on a stale check), then played
async function playWord(game, userId, answer) {
    const preview = pendingFor(game, userId);
    if (preview?.kind !== 'preview') return answer(tilesView(game, userId, { note: 'There\'s no word waiting to be played. Press **✏️ Play word** to make one.' }));
    const { draft } = preview;
    const move = checkMove(game.board, game.racks.get(userId), draft.word, draft.square, draft.direction);
    game.pending.delete(userId);
    if (move.error) return answer(tilesView(game, userId, { note: tryAgain(move.error) }));

    game.drafts.delete(userId);
    game.missed.set(userId, 0);
    const drawn = applyMove(game, userId, move);
    game.png = await drawBoard(game.board, { highlight: move.placed.map(t => key(t.row, t.col)) });
    // Racks are refilled after a move, so an empty one means the bag is empty too
    if (!game.racks.get(userId).length) finish(game, 'out', userId);
    else nextTurn(game);

    let note = null;
    if (game.state !== 'over') {
        const refill = drawn.length ? ` You drew ${tileCount(drawn.length)}.` : ' The bag is empty, so you drew nothing.';
        note = `✅ You played ${moveText(move)}!${refill}`;
    }
    await answer(tilesView(game, userId, { note }));
    return afterMove(game, { except: userId });
}

// ─── Private views ────────────────────────────────────────────
const boardFile = (png) => new AttachmentBuilder(png, { name: BOARD_FILE });
const boardPicture = () => gallery(`attachment://${BOARD_FILE}`);

// A private view, with a picture of the board when given one (attachments: [] drops the last one)
const viewPayload = (parts, png = null) => ({
    ...gamePayload(parts, COLOR),
    ...(png ? { files: [boardFile(png)] } : {}),
    attachments: [],
});

const closedView = (line) => viewPayload([`### ${TITLE}`, line]);

// Why someone can't open or use a view in this game
function outLine(game, userId) {
    const reason = game.out.get(userId);
    if (reason === 'timed out') return `⌛ You ran out of time ${inARow()}, so you're out of this game. Your tiles went back into the bag.`;
    return reason ? 'You left this game.' : 'You\'re not in this game. Join the next one!';
}

/** Someone's private view: their tiles and what they can do now. Only ever shown to them. */
function tilesView(game, userId, { note = null } = {}) {
    if (!game.players.includes(userId)) return closedView(outLine(game, userId));
    if (game.state === 'over') return overView(game, userId);
    const pending = pendingFor(game, userId);
    if (pending?.kind === 'quit') return quitView(game, note);
    if (pending?.kind === 'pass') return passView(game, note);
    if (pending?.kind === 'swap') return swapView(game, userId, pending, note);
    if (pending?.kind === 'preview') return previewView(game, userId, pending, note);
    return mainView(game, userId, note);
}

function mainView(game, userId, note) {
    const myTurn = current(game) === userId;
    const canSwap = game.bag.length >= RACK_SIZE;
    const id = game.id;
    // One more timeout would take them out: say so while they can still do something about it
    const missed = game.missed.get(userId) ?? 0;
    const lastChance = myTurn && missed > 0 && missed + 1 >= settings().missedTurnsOut
        ? `⚠️ You ran out of time ${missed === 1 ? 'last turn' : `${missed} turns in a row`}. Run out again and you're out of the game.`
        : null;
    return viewPayload([
        '### 🔠 Your tiles',
        note,
        lastChance,
        myTurn ? boardPicture() : null,
        `## ${showRack(game.racks.get(userId)) || 'No tiles left'}`,
        `${myTurn ? `**Your turn!** · time's up ${at(game.turnEndsAt)}` : `<@${current(game)}>'s turn · ${at(game.turnEndsAt)}`}\n` +
            `-# ${scoresText(game, userId)} · ${bagText(game)}\n` +
            `-# Last: ${lastText(game, userId)}`,
        '-# ✏️ Type the whole word, including letters already on the board · the start square is where its first letter goes · ' +
            `blanks (?) stand in for letters you don't have${myTurn && !canSwap ? ` · swapping needs ${RACK_SIZE} tiles in the bag` : ''}`,
        row(
            button(`game:${id}:word`, 'Play word', ButtonStyle.Primary, { emoji: '✏️', disabled: !myTurn }),
            button(`game:${id}:swap`, 'Swap tiles', ButtonStyle.Secondary, { emoji: '🔁', disabled: !myTurn || !canSwap }),
            button(`game:${id}:pass`, 'Pass', ButtonStyle.Secondary, { emoji: '⏭️', disabled: !myTurn }),
            button(`game:${id}:shuffle`, 'Shuffle', ButtonStyle.Secondary, { emoji: '🔀' }),
            button(`game:${id}:quit`, 'Leave', ButtonStyle.Danger, { emoji: '🚪' }),
        ),
    ], myTurn ? game.png : null);
}

// "uses Q U Z and a blank as I"
function usesText(placed) {
    const real = placed.filter(t => !t.blank).map(t => t.letter);
    const blanks = placed.filter(t => t.blank).map(t => t.letter);
    const parts = [];
    if (real.length) parts.push(real.join(' '));
    if (blanks.length) parts.push(`${blanks.length === 1 ? 'a blank' : `${blanks.length} blanks`} as ${listText(blanks)}`);
    return `uses ${parts.join(' and ')}`;
}

function previewView(game, userId, { draft, move, png }, note) {
    const id = game.id;
    const from = parseSquare(draft.square);
    return viewPayload([
        '### ✏️ Your move · preview',
        note,
        boardPicture(),
        `${moveText(move, ' points')} · ${usesText(move.placed)}`,
        `-# ${move.words[0].word} goes ${DIRECTIONS[draft.direction].name} from ${squareName(from.row, from.col)} · nothing is played until you press **Play it** · time's up ${at(game.turnEndsAt)}\n` +
            `-# Your tiles: ${showRack(game.racks.get(userId))}`,
        row(
            button(`game:${id}:play:${game.turnNo}`, 'Play it', ButtonStyle.Success, { emoji: '✅' }),
            button(`game:${id}:change`, 'Change', ButtonStyle.Secondary, { emoji: '✏️' }),
            button(`game:${id}:back`, 'Cancel', ButtonStyle.Secondary),
        ),
    ], png);
}

// Passing, swapping or running out of time this many turns in a row ends the game; say so first
const endsGameWarning = (game) => (game.scoreless + 1 >= SCORELESS_END
    ? `⚠️ That makes ${SCORELESS_END} scoreless turns in a row, which **ends the game**: everyone loses the value of the tiles they're holding.`
    : null);

function swapView(game, userId, { picked }, note) {
    const rack = game.racks.get(userId);
    // The picked tiles show as chosen in the menu (the first ones of each letter)
    const left = countLetters(picked);
    const options = rack.map((letter, i) => {
        const chosen = (left.get(letter) ?? 0) > 0;
        if (chosen) left.set(letter, left.get(letter) - 1);
        return { label: letter === '?' ? '? (blank)' : letter, description: plural(points(letter), 'point'), value: String(i), default: chosen };
    });
    return viewPayload([
        '### 🔁 Swap tiles',
        note,
        `## ${showRack(rack)}`,
        `Pick the tiles to put back. You draw as many new ones, and your turn ends with no points.\n-# Time's up ${at(game.turnEndsAt)}`,
        endsGameWarning(game),
        row(new StringSelectMenuBuilder()
            .setCustomId(`game:${game.id}:swapPick`)
            .setPlaceholder('Tiles to swap…')
            .setMinValues(1)
            .setMaxValues(rack.length)
            .addOptions(options)),
        row(
            button(`game:${game.id}:swapYes:${game.turnNo}`, picked.length ? `Swap ${tileCount(picked.length)}` : 'Swap', ButtonStyle.Primary, { emoji: '🔁', disabled: !picked.length }),
            button(`game:${game.id}:back`, 'Back', ButtonStyle.Secondary),
        ),
    ]);
}

const passView = (game, note) => viewPayload([
    '### ⏭️ Pass your turn?',
    note,
    `You score nothing this turn, and it's the next player's go.\n-# Time's up ${at(game.turnEndsAt)}`,
    endsGameWarning(game),
    row(
        button(`game:${game.id}:passYes:${game.turnNo}`, 'Yes, pass', ButtonStyle.Primary, { emoji: '⏭️' }),
        button(`game:${game.id}:back`, 'Back', ButtonStyle.Secondary),
    ),
]);

const quitView = (game, note) => viewPayload([
    '### 🚪 Leave the game?',
    note,
    'Your tiles go back into the bag, you can\'t rejoin this game, and leaving doesn\'t earn any coins.',
    row(
        button(`game:${game.id}:quitYes`, 'Leave game', ButtonStyle.Danger),
        button(`game:${game.id}:back`, 'Stay', ButtonStyle.Secondary),
    ),
]);

function overView(game, userId) {
    const score = game.scores.get(userId);
    const winners = game.winners ?? [];
    const coins = game.rewards?.get(userId);
    let result;
    if (game.expired) result = `⌛ The game ended: no moves for ${gameConfig.IDLE_MINUTES} minutes.`;
    else if (winners.includes(userId)) result = `🏆 **${winners.length > 1 ? 'You tied for the win' : 'You won'}** with **${score}** points!`;
    else result = `${listText(winners.map(id => `<@${id}>`))} won with **${game.scores.get(winners[0])}** · you scored **${score}**.`;
    return viewPayload([`### ${TITLE} · game over`, `${result}${coins ? ` · ${coins}` : ''}`]);
}

// ─── The word form ────────────────────────────────────────────
function wordForm(game, userId) {
    const draft = draftFor(game, userId);
    const firstMove = boardIsEmpty(game.board);
    const word = new TextInputBuilder().setCustomId('word').setStyle(TextInputStyle.Short).setRequired(true)
        .setMinLength(2).setMaxLength(SIZE).setPlaceholder('e.g. QUIZ');
    if (draft?.word) word.setValue(draft.word);
    const square = new TextInputBuilder().setCustomId('square').setStyle(TextInputStyle.Short).setRequired(true)
        .setMinLength(2).setMaxLength(5).setPlaceholder('e.g. H8');
    const startAt = draft?.square ?? (firstMove ? squareName(CENTER, CENTER) : null);
    if (startAt) square.setValue(startAt);
    const direction = draft?.direction ?? 'across';
    return new ModalBuilder()
        .setCustomId(`game:${game.id}:submit:${game.turnNo}`)
        .setTitle(firstMove ? 'Play the first word' : 'Play a word')
        .addLabelComponents(
            new LabelBuilder().setLabel('Word')
                .setDescription('The whole word as it will read, including letters already on the board')
                .setTextInputComponent(word),
            new LabelBuilder().setLabel('Start square')
                .setDescription(firstMove ? 'Where its first letter goes. The first word must cover H8 (the ★).' : 'Where its first letter goes, like H8')
                .setTextInputComponent(square),
            new LabelBuilder().setLabel('Direction')
                .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('direction').setMinValues(1).setMaxValues(1).addOptions(
                    Object.entries(DIRECTIONS).map(([value, d]) => ({ label: d.label, value, default: value === direction })))),
        );
}

// ─── Game message ─────────────────────────────────────────────
// "**QUIZ** for **45** · also QI 11": the total, then the other words it made with their scores
function moveText(move, unit = '') {
    const [main, ...others] = move.words;
    let text = `**${main.word}** for **${move.score}**${unit}`;
    if (others.length) text += ` · also ${others.map(w => `${w.word} ${w.score}`).join(', ')}`;
    if (move.bingo) text += ` · 🎉 bingo +${BINGO_BONUS}`;
    return text;
}

// The last move, as `viewer` sees it ("You passed") or for everyone
function lastText(game, viewer = null) {
    const { kind, userId, move, count } = game.last;
    const you = userId === viewer;
    const who = you ? 'You' : `<@${userId}>`;
    switch (kind) {
        case 'play': return `${you ? 'You' : `**<@${userId}>**`} played ${moveText(move)}`;
        case 'pass': return `${who} passed`;
        case 'swap': return `${who} swapped ${tileCount(count)}`;
        case 'timeout': return `⌛ ${who} ran out of time, so ${you ? 'your' : 'their'} turn passed`;
        case 'leave': return `🚪 <@${userId}> left the game · their tiles went back into the bag`;
        case 'out': return `⌛ **<@${userId}>** ran out of time ${inARow()}, so they're out · their tiles went back into the bag`;
        default: return `${you ? 'You go' : `<@${userId}> goes`} first · the first word must cover the ★ square (**${squareName(CENTER, CENTER)}**)`;
    }
}

const bagText = (game) => (game.bag.length ? `🎒 ${tileCount(game.bag.length)} in the bag` : '🎒 the bag is empty');
const scoresText = (game, viewer) => game.players.map(id => `${id === viewer ? 'You' : `<@${id}>`} ${game.scores.get(id)}`).join(' · ');

// The game message with the board picture attached (attachments: [] replaces the last picture
// instead of adding another)
const boardPayload = (game, parts) => ({ ...gamePayload(parts, COLOR), files: [boardFile(game.png)], attachments: [] });

function render(game) {
    if (game.state === 'over') return renderOver(game);
    const turn = current(game);
    const seats = game.players.map(id =>
        `${id === turn ? '▶️' : '▫️'} <@${id}> · **${game.scores.get(id)}** · ${tileCount(game.racks.get(id).length)}${id === turn ? ` · ⏳ ${at(game.turnEndsAt)}` : ''}`);
    const left = game.out.size ? `\n-# Out: ${[...game.out].map(([id, reason]) => `<@${id}> ${reason}`).join(' · ')}` : '';
    const scoreless = game.scoreless >= SCORELESS_END - 2 ? ` · ${game.scoreless} scoreless turns in a row (${SCORELESS_END} ends the game)` : '';
    return boardPayload(game, [
        `## ${TITLE}`,
        boardPicture(),
        lastText(game),
        `${seats.join('\n')}${left}`,
        `-# ${bagText(game)}${scoreless}`,
        row(button(`game:${game.id}:tiles`, 'My tiles', ButtonStyle.Primary, { emoji: '🔠' })),
    ]);
}

function renderOver(game) {
    const winners = game.winners ?? [];
    const ranked = [...game.players].sort((a, b) => game.scores.get(b) - game.scores.get(a));
    const lines = ranked.map(id => {
        const change = game.ending?.adjust.get(id);
        const coins = game.rewards?.get(id);
        return `${winners.includes(id) ? '🏆' : '▫️'} <@${id}> · **${game.scores.get(id)}**` +
            `${change ? ` (${change > 0 ? '+' : '−'}${Math.abs(change)})` : ''}${coins ? ` · ${coins}` : ''}`;
    });
    lines.push(...[...game.out].map(([id, reason]) => `${reason === 'left' ? '🚪' : '⌛'} <@${id}> · ${reason}`));

    let heading = `## ${TITLE} · Game over`;
    let how;
    if (game.expired) {
        how = `⌛ The game ended: no moves for ${gameConfig.IDLE_MINUTES} minutes.`;
    } else {
        const best = game.scores.get(winners[0]);
        heading = winners.length > 1 ? `## ${TITLE} · It's a tie!` : `## ${TITLE} · <@${winners[0]}> wins!`;
        const { how: ending, by, adjust } = game.ending;
        if (ending === 'out') how = `🏁 <@${by}> used their last tile! Everyone else's leftover tiles come off their score, and <@${by}> gets the total (+${adjust.get(by)}).`;
        else if (ending === 'scoreless') how = `🏁 ${SCORELESS_END} scoreless turns in a row ended the game. Everyone's leftover tiles come off their score.`;
        else how = `🏁 Everyone else ${[...game.out.values()].every(r => r === 'left') ? 'left' : 'is out'}, so <@${winners[0]}> wins.`;
        if (winners.length > 1) how = `🏆 ${listText(winners.map(id => `<@${id}>`))} share the win with **${best}**!\n${how}`;
    }
    return boardPayload(game, [
        heading,
        boardPicture(),
        how,
        `**Final scores**\n${lines.join('\n')}`,
        `-# Last move: ${lastText(game)}`,
    ]);
}

/** Opens the lobby (from the /games menu) */
function start(interaction) {
    const { minPlayers, maxPlayers, turnSeconds } = settings();
    const perTurn = turnSeconds % 60 === 0 ? `${turnSeconds / 60} min` : `${turnSeconds}s`;
    return openLobby(interaction, 'wordTiles', {
        title: TITLE,
        color: COLOR,
        minPlayers,
        maxPlayers,
        rules: `Make words on the board from your ${RACK_SIZE} letter tiles, crossword style. The first word covers the ★ in the middle, and every word after that joins onto the board. ` +
            `Bonus squares double or triple a letter or a whole word, and using all ${RACK_SIZE} tiles at once is worth ${BINGO_BONUS} more. ` +
            'The highest score when the tiles run out wins!\n' +
            `-# ${perTurn} per turn · run out of time ${inARow()} and you're out · your tiles are private: press **🔠 My tiles** to play`,
    }, { begin, render });
}

// Lobby clicks and My tiles (answered with a private follow-up) are acknowledged before waiting in
// line, and so are the word form and Play it, which draw the board and can take a moment. Clicks
// that open the form (Play word, Change) can't be: a form has to be the first answer.
const deferActions = new Set([...LOBBY_ACTIONS, 'tiles', 'submit', 'play']);

module.exports = {
    start, handle, render, deferActions, TITLE, dealer, newBag, shuffle, checkMove, swapTiles,
    endingAdjustments, coinAwards, rackValue, showRack,
};
