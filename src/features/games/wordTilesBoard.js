// The Word Tiles board as a picture, drawn with @napi-rs/canvas (the font comes with canvacord, so
// it looks the same on any server, with or without fonts installed).
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const canvacord = require('canvacord');
const { SIZE, CENTER, bonusAt, columnName, points } = require('./wordTilesData');

const FONT = 'WordTilesFont';
GlobalFonts.register(canvacord.Font.loadDefault().data, FONT);

const CELL = 48;
const GAP = 3; // between squares
const MARGIN = 34; // room for the A–O and 1–15 labels
const PAD = 14;
const WIDTH = MARGIN + SIZE * CELL + PAD;

const COLORS = {
    background: '#151820',
    board: '#1f2430',
    square: '#2b3242',
    label: '#8b93a7',
    bonus: {
        TW: { fill: '#b4232c', text: '3W' },
        DW: { fill: '#b8336a', text: '2W' },
        TL: { fill: '#2457c5', text: '3L' },
        DL: { fill: '#16808f', text: '2L' },
    },
    tile: '#f3e3c3',
    tileEdge: '#cdb489',
    letter: '#2b2118',
    blankLetter: '#9a5b1c', // blanks stand out: no points, letter in a warmer color
    last: '#f5c518', // the last move's tiles
    pending: { fill: '#c9f2d4', edge: '#2f9e5b' }, // a move being previewed, not played yet
};

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Text drawn twice (fill and a thin outline of the same color), since the font has one weight
function boldText(ctx, text, x, y, size, color) {
    ctx.font = `${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = size / 22;
    ctx.fillText(text, x, y);
    ctx.strokeText(text, x, y);
}

function drawSquare(ctx, x, y, row, col) {
    const size = CELL - GAP;
    const bonus = bonusAt(row, col);
    roundedRect(ctx, x, y, size, size, 5);
    ctx.fillStyle = bonus ? COLORS.bonus[bonus].fill : COLORS.square;
    ctx.fill();
    if (row === CENTER && col === CENTER) {
        boldText(ctx, '★', x + size / 2, y + size / 2 + 1, 26, '#ffe9a8');
    } else if (bonus) {
        boldText(ctx, COLORS.bonus[bonus].text, x + size / 2, y + size / 2 + 1, 15, 'rgba(255, 255, 255, 0.92)');
    }
}

function drawTile(ctx, x, y, tile, { last = false, pending = false } = {}) {
    const size = CELL - GAP;
    // A soft shadow under the tile
    roundedRect(ctx, x + 1, y + 2, size, size, 6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();

    roundedRect(ctx, x, y, size, size, 6);
    ctx.fillStyle = pending ? COLORS.pending.fill : COLORS.tile;
    ctx.fill();
    ctx.lineWidth = last || pending ? 3 : 1.5;
    ctx.strokeStyle = last ? COLORS.last : pending ? COLORS.pending.edge : COLORS.tileEdge;
    ctx.stroke();

    // The letter sits a little left of center, more so beside a two-digit point value
    const shift = tile.blank ? 0 : points(tile.letter) >= 10 ? 5 : 2;
    boldText(ctx, tile.letter, x + size / 2 - shift, y + size / 2 + 2, 27, tile.blank ? COLORS.blankLetter : COLORS.letter);
    if (!tile.blank) {
        ctx.textAlign = 'right';
        boldText(ctx, String(points(tile.letter)), x + size - 4, y + size - 8, 11, COLORS.letter);
        ctx.textAlign = 'center';
    }
}

/**
 * Draws the board as a PNG.
 * `highlight`: the last move's squares ("row,col" strings); `pending`: tiles being previewed
 * before they're played, as [{ row, col, letter, blank }].
 */
async function drawBoard(board, { highlight = [], pending = [] } = {}) {
    const canvas = createCanvas(WIDTH, WIDTH);
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, WIDTH, WIDTH);
    roundedRect(ctx, MARGIN - 6, MARGIN - 6, SIZE * CELL + 9, SIZE * CELL + 9, 10);
    ctx.fillStyle = COLORS.board;
    ctx.fill();

    // Column letters across the top, row numbers down the side
    for (let i = 0; i < SIZE; i++) {
        const middle = MARGIN + i * CELL + (CELL - GAP) / 2;
        boldText(ctx, columnName(i), middle, MARGIN / 2 - 2, 15, COLORS.label);
        boldText(ctx, String(i + 1), MARGIN / 2 - 2, middle, 15, COLORS.label);
    }

    const lastMove = new Set(highlight);
    const previewed = new Map(pending.map(t => [`${t.row},${t.col}`, t]));
    for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
            const x = MARGIN + col * CELL;
            const y = MARGIN + row * CELL;
            const key = `${row},${col}`;
            const tile = board[row][col] ?? previewed.get(key);
            if (tile) drawTile(ctx, x, y, tile, { last: lastMove.has(key), pending: !board[row][col] });
            else drawSquare(ctx, x, y, row, col);
        }
    }
    return canvas.toBuffer('image/png');
}

module.exports = { drawBoard };
