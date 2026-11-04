// Minesweeper on a 5×5 grid of buttons. The first click is always safe; flag mode marks mines.
const { randomInt } = require('crypto');
const { MINESWEEPER } = require('../../config/games');
const { minesweeperReward } = require('./scoring');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { createGame, endGame, touch } = require('./sessions');
const { payGameReward, rewardText } = require('./rewards');
const { recordGame } = require('./stats');
const { gamePayload, updateBoard, refuseOutsider, showGame } = require('./common');

const TITLE = '💣 Minesweeper';
const { size: SIZE, mines: MINES } = MINESWEEPER;
const CELLS = SIZE * SIZE;

// ─── Rules (cells are numbered 0..24, row by row) ─────────────
function neighbors(i) {
    const r = Math.floor(i / SIZE), c = i % SIZE;
    const result = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if ((dr || dc) && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) result.push(rr * SIZE + cc);
        }
    }
    return result;
}

// Places mines anywhere except the first-clicked cell
function placeMines(safeCell, random = (n) => randomInt(n)) {
    const mines = new Set();
    while (mines.size < MINES) {
        const cell = random(CELLS);
        if (cell !== safeCell) mines.add(cell);
    }
    return mines;
}

const countAround = (i, mines) => neighbors(i).filter(n => mines.has(n)).length;

// Opens a cell; empty cells (no mines around) open their neighbors too
function reveal(start, mines, revealed, flagged) {
    const queue = [start];
    while (queue.length) {
        const i = queue.shift();
        if (revealed.has(i) || flagged.has(i) || mines.has(i)) continue;
        revealed.add(i);
        if (countAround(i, mines) === 0) queue.push(...neighbors(i));
    }
}

// ─── Panel ────────────────────────────────────────────────────
function render(game) {
    const playing = game.state === 'playing' && !game.expired;
    const cell = (i) => {
        const id = `game:${game.id}:cell:${i}`;
        if (game.revealed.has(i)) {
            const n = countAround(i, game.mines);
            return button(id, n ? String(n) : null, ButtonStyle.Secondary, { disabled: true });
        }
        if (!playing && game.mines?.has(i)) {
            const style = i === game.hit ? ButtonStyle.Danger : game.state === 'won' ? ButtonStyle.Success : ButtonStyle.Secondary;
            return button(id, null, style, { emoji: game.state === 'won' ? '🚩' : '💣', disabled: true });
        }
        return button(id, null, ButtonStyle.Primary, { emoji: game.flagged.has(i) ? '🚩' : undefined, disabled: !playing });
    };

    let status = `-# Clear all ${CELLS - MINES} safe squares · ${MINES} mines · ${game.flagged.size} flagged`;
    if (game.state === 'won') status = `🎉 Cleared in ${game.seconds}s! ${rewardText(game.reward ?? {})}`.trim();
    else if (game.state === 'lost') status = game.gaveUp ? '🏳️ Gave up.' : '💥 Boom! You hit a mine.';
    else if (game.expired) status = '⌛ Game ended: no moves for 10 minutes.';

    const rows = [];
    for (let r = 0; r < SIZE; r++) rows.push(row(...[0, 1, 2, 3, 4].map(c => cell(r * SIZE + c))));

    return gamePayload([
        `## ${TITLE}\n-# <@${game.players[0]}>`,
        ...rows,
        status,
        playing ? row(
            button(`game:${game.id}:flag`, game.flagMode ? 'Flag mode: on' : 'Flag mode: off', game.flagMode ? ButtonStyle.Success : ButtonStyle.Secondary, { emoji: '🚩' }),
            button(`game:${game.id}:giveup`, 'Give up', ButtonStyle.Secondary),
        ) : null,
    ], 0x95A5A6);
}

// ─── Flow ─────────────────────────────────────────────────────
async function handle(game, interaction, action, arg) {
    if (await refuseOutsider(game, interaction)) return;

    if (action === 'flag') {
        game.flagMode = !game.flagMode;
        return updateBoard(game, interaction, render(game));
    }
    if (action === 'giveup') {
        game.state = 'lost';
        game.gaveUp = true;
        game.mines ??= placeMines(-1);
        endGame(game);
        await recordGame(game);
        return updateBoard(game, interaction, render(game));
    }
    if (action !== 'cell') return interaction.deferUpdate();

    const i = Number(arg);
    if (game.revealed.has(i)) return interaction.deferUpdate();

    if (game.flagMode) {
        if (game.flagged.has(i)) game.flagged.delete(i);
        else game.flagged.add(i);
        return updateBoard(game, interaction, render(game));
    }
    if (game.flagged.has(i)) return interaction.deferUpdate(); // flagged squares are protected

    if (!game.mines) {
        game.mines = placeMines(i);
        game.startedAt = Date.now(); // the clock starts on the first click
    }
    if (game.mines.has(i)) {
        game.state = 'lost';
        game.hit = i;
        endGame(game);
        await recordGame(game);
        return updateBoard(game, interaction, render(game));
    }

    reveal(i, game.mines, game.revealed, game.flagged);
    if (game.revealed.size === CELLS - MINES) {
        game.state = 'won';
        endGame(game);
        await interaction.deferUpdate();
        game.seconds = Math.round((Date.now() - game.startedAt) / 1000);
        game.reward = await payGameReward(interaction.user.id, minesweeperReward(game.seconds), { guildId: game.guildId, game: 'Minesweeper' });
        await recordGame(game, { winners: game.players, scores: { [game.players[0]]: game.seconds } });
    }
    return updateBoard(game, interaction, render(game));
}

async function start(interaction) {
    const game = createGame('minesweeper', {
        guildId: interaction.guildId,
        players: [interaction.user.id],
        mines: null, // placed on the first click
        revealed: new Set(),
        flagged: new Set(),
        flagMode: false,
        state: 'playing',
    });
    game.onExpire = () => { game.expired = true; game.mines ??= placeMines(-1); return render(game); };
    await showGame(interaction, render(game));
    touch(game, interaction);
}

module.exports = { start, handle, render, neighbors, placeMines, reveal, countAround };
