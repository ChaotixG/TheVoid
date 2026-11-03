// Connect Four: an emoji board (6 rows × 7 columns) with a button per column.
const { connect4Reward } = require('./scoring');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { createGame, endGame, touch } = require('./sessions');
const { payGameReward, rewardText } = require('./rewards');
const { BOT, gamePayload, updateBoard, mention, refuseOutsider, challengePayload, armChallengeTimer, handleChallenge, resolveOpponent } = require('./common');

const TITLE = '🔴🟡 Connect Four';
const ROWS = 6;
const COLS = 7;
const PIECES = ['🔴', '🟡'];
const EMPTY = '⚫';
const WINNING = '🟢';
const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

// ─── Rules (board[row][col], row 0 is the top; cells hold 0, 1 or null) ──
const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

/** Drops a piece; returns the row it landed in, or -1 if the column is full. */
function drop(board, col, player) {
    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === null) {
            board[r][col] = player;
            return r;
        }
    }
    return -1;
}

/** The four winning cells through (r, c), or null */
function winAt(board, r, c) {
    const player = board[r][c];
    if (player === null) return null;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const cells = [[r, c]];
        for (const sign of [1, -1]) {
            let rr = r + dr * sign, cc = c + dc * sign;
            while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === player) {
                cells.push([rr, cc]);
                rr += dr * sign;
                cc += dc * sign;
            }
        }
        if (cells.length >= 4) return cells;
    }
    return null;
}

const openColumns = (board) => [...Array(COLS).keys()].filter(c => board[0][c] === null);
const copy = (board) => board.map(r => [...r]);

function wouldWin(board, col, player) {
    const next = copy(board);
    const r = drop(next, col, player);
    return r >= 0 && Boolean(winAt(next, r, col));
}

// Wins when it can, usually blocks, avoids handing you a win, and likes the center
function botMove(board, me, them, random = Math.random) {
    const open = openColumns(board);
    const win = open.find(c => wouldWin(board, c, me));
    if (win !== undefined) return win;
    const block = open.find(c => wouldWin(board, c, them));
    if (block !== undefined && random() < 0.9) return block;

    const safe = open.filter(c => {
        const next = copy(board);
        drop(next, c, me);
        return !openColumns(next).some(c2 => wouldWin(next, c2, them));
    });
    const choices = (safe.length ? safe : open).sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3));
    // Usually one of the two most central choices, sometimes anything
    const pool = random() < 0.75 ? choices.slice(0, 2) : choices;
    return pool[Math.floor(random() * pool.length)];
}

// ─── Panel ────────────────────────────────────────────────────
function render(game) {
    const playing = game.state === 'playing';
    const winning = new Set((game.winCells ?? []).map(([r, c]) => `${r},${c}`));
    const grid = game.board.map((cells, r) => cells.map((p, c) => (winning.has(`${r},${c}`) ? WINNING : p === null ? EMPTY : PIECES[p])).join('')).join('\n');

    let status;
    if (playing) status = `${mention(game.players[game.turn])}'s turn ${PIECES[game.turn]}`;
    else if (game.expired) status = '⌛ Game ended: no moves for 10 minutes.';
    else if (game.forfeitBy) status = `🏳️ ${mention(game.forfeitBy)} gave up.`;
    else if (game.winnerId === BOT) status = '🤖 I win! Better luck next time.';
    else if (game.winnerId) status = `🏆 ${mention(game.winnerId)} wins! ${rewardText(game.reward ?? {})}`.trim();
    else status = '🤝 The board is full: it\'s a draw.';

    const columnButton = (c) => button(`game:${game.id}:drop:${c}`, String(c + 1), ButtonStyle.Secondary, { disabled: !playing || game.board[0][c] !== null });

    return gamePayload([
        `## ${TITLE}\n${mention(game.players[0])} ${PIECES[0]} vs ${mention(game.players[1])} ${PIECES[1]}`,
        `${NUMBERS.join('')}\n${grid}${winning.size ? `\n-# ${WINNING} marks the winning four` : ''}`,
        status,
        row(...[0, 1, 2, 3].map(columnButton)),
        row(...[4, 5, 6].map(columnButton), button(`game:${game.id}:forfeit`, 'Give up', ButtonStyle.Secondary, { disabled: !playing })),
    ], 0xF1C40F);
}

// ─── Flow ─────────────────────────────────────────────────────
function setup(game) {
    if (Math.random() < 0.5) game.players.reverse();
    game.board = emptyBoard();
    game.turn = 0;
    if (game.players[0] === BOT) {
        drop(game.board, botMove(game.board, 0, 1), 0);
        game.turn = 1;
    }
}

async function finish(game, interaction, { winnerId = null, forfeitBy = null, cells = [] }) {
    game.state = 'over';
    endGame(game);
    Object.assign(game, { winnerId, forfeitBy, winCells: cells });
    await interaction.deferUpdate();
    if (winnerId && winnerId !== BOT) {
        // Fewer of your own pieces on the board means a quicker win and a bigger bonus
        const winnerIndex = game.players.indexOf(winnerId);
        const moves = game.board.flat().filter(p => p === winnerIndex).length;
        game.reward = await payGameReward(winnerId, connect4Reward(moves, game.players.includes(BOT)), { guildId: game.guildId, game: 'Connect Four' });
    }
    await updateBoard(game, interaction, render(game));
}

// Plays `col` for the current player; ends the game if that decided it (returns true)
async function play(game, interaction, col) {
    const r = drop(game.board, col, game.turn);
    const cells = winAt(game.board, r, col);
    if (cells) {
        await finish(game, interaction, { winnerId: game.players[game.turn], cells });
        return true;
    }
    if (!openColumns(game.board).length) {
        await finish(game, interaction, {});
        return true;
    }
    game.turn = 1 - game.turn;
    return false;
}

async function handle(game, interaction, action, arg) {
    if (await handleChallenge(game, interaction, action, { title: TITLE, onAccept: () => setup(game), render })) return;
    if (await refuseOutsider(game, interaction)) return;

    if (action === 'forfeit') {
        const other = game.players.find(p => p !== interaction.user.id);
        return finish(game, interaction, { forfeitBy: interaction.user.id, winnerId: other === BOT ? BOT : null });
    }
    if (action !== 'drop') return interaction.deferUpdate();
    if (game.players[game.turn] !== interaction.user.id) return interaction.reply(ephemeral('It\'s not your turn.'));
    const col = Number(arg);
    if (game.board[0][col] !== null) return interaction.reply(ephemeral('That column is full.'));

    if (await play(game, interaction, col)) return;
    if (game.players[game.turn] === BOT && await play(game, interaction, botMove(game.board, game.turn, 1 - game.turn))) return;
    await updateBoard(game, interaction, render(game));
}

async function start(interaction) {
    const { opponentId, error } = resolveOpponent(interaction);
    if (error) return interaction.reply(ephemeral(error));

    const vsBot = opponentId === BOT;
    const game = createGame('connect4', {
        guildId: interaction.guildId,
        players: [interaction.user.id, opponentId],
        state: vsBot ? 'playing' : 'challenge',
    });
    game.onExpire = () => { game.state = 'over'; game.expired = true; return render(game); };

    if (vsBot) setup(game);
    else armChallengeTimer(game, TITLE);
    await interaction.reply(vsBot ? render(game) : challengePayload(game, TITLE));
    touch(game, interaction);
}

module.exports = { start, handle, render, drop, winAt, botMove, emptyBoard };
