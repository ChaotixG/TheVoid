// Word Tiles (the classic crossword tile game): its tiles, the board and the bonus squares.
// Shared by the game (wordTiles.js) and the board picture (wordTilesBoard.js).
//
// The board is board[row][col], 15×15, each square null or a placed tile { letter, blank }.
// Squares are named like a chessboard: columns A–O left to right, rows 1–15 top to bottom (H8 is
// the center).
const SIZE = 15;
const CENTER = 7; // H8: the first word must cover it
const RACK_SIZE = 7;
const BINGO_BONUS = 50; // for using all 7 tiles in one move

// Letter → [tiles in the bag, points]. '?' is a blank: it can be any letter and scores 0.
const TILES = {
    A: [9, 1], B: [2, 3], C: [2, 3], D: [4, 2], E: [12, 1], F: [2, 4], G: [3, 2], H: [2, 4], I: [9, 1],
    J: [1, 8], K: [1, 5], L: [4, 1], M: [2, 3], N: [6, 1], O: [8, 1], P: [2, 3], Q: [1, 10], R: [6, 1],
    S: [4, 1], T: [6, 1], U: [4, 1], V: [2, 4], W: [2, 4], X: [1, 8], Y: [2, 4], Z: [1, 10], '?': [2, 0],
};

const points = (letter) => TILES[letter]?.[1] ?? 0;

// Bonus squares: TW triple word, DW double word, TL triple letter, DL double letter. The board is
// symmetric, so one corner (rows and columns 0–7) is listed and mirrored into the other three.
const QUARTER = {
    TW: [[0, 0], [0, 7], [7, 0]],
    DW: [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]],
    TL: [[1, 5], [5, 1], [5, 5]],
    DL: [[0, 3], [2, 6], [3, 0], [3, 7], [6, 2], [6, 6], [7, 3]],
};
const BONUS = new Map(); // "row,col" → 'TW' | 'DW' | 'TL' | 'DL'
for (const [kind, squares] of Object.entries(QUARTER)) {
    for (const [r, c] of squares) {
        for (const [row, col] of [[r, c], [r, SIZE - 1 - c], [SIZE - 1 - r, c], [SIZE - 1 - r, SIZE - 1 - c]]) {
            BONUS.set(`${row},${col}`, kind);
        }
    }
}
const bonusAt = (row, col) => BONUS.get(`${row},${col}`) ?? null;

const columnName = (col) => String.fromCharCode(65 + col);
const squareName = (row, col) => `${columnName(col)}${row + 1}`;

/** "H8" (or "8H", any case) → { row, col }; null if it isn't a square on the board */
function parseSquare(text) {
    const s = String(text ?? '').trim().toUpperCase();
    const match = s.match(/^([A-O])\s*(1[0-5]|[1-9])$/) ?? s.match(/^(1[0-5]|[1-9])\s*([A-O])$/);
    if (!match) return null;
    const [letter, number] = /^[A-O]$/.test(match[1]) ? [match[1], match[2]] : [match[2], match[1]];
    return { row: Number(number) - 1, col: letter.charCodeAt(0) - 65 };
}

const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

module.exports = { SIZE, CENTER, RACK_SIZE, BINGO_BONUS, TILES, points, bonusAt, columnName, squareName, parseSquare, emptyBoard };
