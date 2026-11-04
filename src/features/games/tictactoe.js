// Tic-tac-toe on a 3×3 grid of buttons, against another member or the bot.
const { REWARDS } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { createGame, endGame, touch } = require('./sessions');
const { payGameReward, rewardText } = require('./rewards');
const { recordGame } = require('./stats');
const { BOT, gamePayload, updateBoard, mention, refuseOutsider, challengePayload, pingOpponent, armChallengeTimer, handleChallenge, showGame } = require('./common');

const TITLE = '❌⭕ Tic-tac-toe';
const MARKS = ['X', 'O'];
const EMOJI = { X: '❌', O: '⭕' };
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

// ─── Rules ────────────────────────────────────────────────────
/** { mark, line } when someone has three in a row, { mark: null } for a full board, else null */
function winnerOf(board) {
    for (const line of LINES) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line };
    }
    return board.every(Boolean) ? { mark: null, line: [] } : null;
}

// Takes a win when it can, usually blocks yours, and otherwise plays loosely, so it's beatable
function botMove(board, me, them, random = Math.random) {
    const empty = board.map((v, i) => (v ? null : i)).filter(i => i !== null);
    const winningCell = (mark) => empty.find(i => {
        const next = [...board];
        next[i] = mark;
        return winnerOf(next)?.mark === mark;
    });
    const win = winningCell(me);
    if (win !== undefined) return win;
    const block = winningCell(them);
    if (block !== undefined && random() < 0.85) return block;
    if (board[4] === null && random() < 0.7) return 4;
    return empty[Math.floor(random() * empty.length)];
}

// ─── Panel ────────────────────────────────────────────────────
function render(game) {
    const [x, o] = game.players;
    const playing = game.state === 'playing';
    const win = new Set(game.winLine ?? []);

    let status;
    if (playing) status = `${mention(game.players[game.turn])}'s turn ${EMOJI[MARKS[game.turn]]}`;
    else if (game.expired) status = '⌛ Game ended: no moves for 10 minutes.';
    else if (game.forfeitBy) status = `🏳️ ${mention(game.forfeitBy)} gave up.`;
    else if (game.winnerId === BOT) status = '🤖 I win! Better luck next time.';
    else if (game.winnerId) status = `🏆 ${mention(game.winnerId)} wins! ${rewardText(game.reward ?? {})}`.trim();
    else status = '🤝 It\'s a draw.';

    const cell = (i) => {
        const mark = game.board[i];
        const style = win.has(i) ? ButtonStyle.Success : mark === 'X' ? ButtonStyle.Danger : mark === 'O' ? ButtonStyle.Primary : ButtonStyle.Secondary;
        return button(`game:${game.id}:move:${i}`, null, style, { emoji: mark ? EMOJI[mark] : undefined, disabled: Boolean(mark) || !playing });
    };

    return gamePayload([
        `## ${TITLE}\n${mention(x)} ${EMOJI.X} vs ${mention(o)} ${EMOJI.O}`,
        row(cell(0), cell(1), cell(2)),
        row(cell(3), cell(4), cell(5)),
        row(cell(6), cell(7), cell(8)),
        status,
        playing ? row(button(`game:${game.id}:forfeit`, 'Give up', ButtonStyle.Secondary)) : null,
    ], 0xE74C3C);
}

// ─── Flow ─────────────────────────────────────────────────────
// Random starter (X); if that's the bot, it moves right away
function setup(game) {
    if (Math.random() < 0.5) game.players.reverse();
    game.board = Array(9).fill(null);
    game.turn = 0;
    if (game.players[0] === BOT) {
        game.board[botMove(game.board, 'X', 'O')] = 'X';
        game.turn = 1;
    }
}

async function finish(game, interaction, { winnerId = null, forfeitBy = null, line = [] }) {
    game.state = 'over';
    endGame(game);
    Object.assign(game, { winnerId, forfeitBy, winLine: line });
    await interaction.deferUpdate();
    if (winnerId && winnerId !== BOT) {
        const reward = game.players.includes(BOT) ? REWARDS.tictactoe.vsBot : REWARDS.tictactoe.vsPlayer;
        game.reward = await payGameReward(winnerId, reward, { guildId: game.guildId, game: 'Tic-tac-toe' });
    }
    await recordGame(game, { winners: winnerId ? [winnerId] : [] });
    await updateBoard(game, interaction, render(game));
}

// Ends the game if the last move decided it; returns true if it did
async function finishIfOver(game, interaction) {
    const result = winnerOf(game.board);
    if (!result) return false;
    const winnerId = result.mark ? game.players[MARKS.indexOf(result.mark)] : null;
    await finish(game, interaction, { winnerId, line: result.line });
    return true;
}

async function handle(game, interaction, action, arg) {
    if (await handleChallenge(game, interaction, action, { title: TITLE, onAccept: () => setup(game), render })) return;
    if (await refuseOutsider(game, interaction)) return;

    if (action === 'forfeit') {
        const other = game.players.find(p => p !== interaction.user.id);
        // Giving up against a person doesn't pay them, so it can't be used to farm coins
        return finish(game, interaction, { forfeitBy: interaction.user.id, winnerId: other === BOT ? BOT : null });
    }
    if (action !== 'move') return interaction.deferUpdate();
    if (game.players[game.turn] !== interaction.user.id) return interaction.reply(ephemeral('It\'s not your turn.'));
    const cell = Number(arg);
    if (game.board[cell]) return interaction.reply(ephemeral('That square is taken.'));

    game.board[cell] = MARKS[game.turn];
    if (await finishIfOver(game, interaction)) return;
    game.turn = 1 - game.turn;

    if (game.players[game.turn] === BOT) {
        game.board[botMove(game.board, MARKS[game.turn], MARKS[1 - game.turn])] = MARKS[game.turn];
        if (await finishIfOver(game, interaction)) return;
        game.turn = 1 - game.turn;
    }
    await updateBoard(game, interaction, render(game));
}

/** Starts a game; `opponentId` (checked by the /games menu) defaults to me */
async function start(interaction, { opponentId = BOT } = {}) {
    const vsBot = opponentId === BOT;
    const game = createGame('tictactoe', {
        guildId: interaction.guildId,
        players: [interaction.user.id, opponentId],
        state: vsBot ? 'playing' : 'challenge',
    });
    game.onExpire = () => { game.state = 'over'; game.expired = true; return render(game); };

    if (vsBot) setup(game);
    else armChallengeTimer(game, TITLE);
    await showGame(interaction, vsBot ? render(game) : challengePayload(game, TITLE));
    touch(game, interaction);
    if (!vsBot) await pingOpponent(interaction, game, TITLE);
}

module.exports = { start, handle, render, winnerOf, botMove };
