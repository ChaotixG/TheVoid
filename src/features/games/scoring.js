// How many coins a win is worth, based on how well it was played. Amounts: config/games.js.
const { REWARDS, HANGMAN } = require('../../config/games');

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Trivia: difficulty base, plus a bonus for each correct answer in a row before this one
function triviaReward(difficulty, streak = 1) {
    const r = REWARDS.trivia;
    const base = r[difficulty] ?? r.easy;
    return base + Math.min((streak - 1) * r.streakBonus, r.maxStreakBonus);
}

// Wordle: fewer guesses, more coins
function wordleReward(guessesUsed) {
    const r = REWARDS.wordle;
    return r.firstGuess - r.perExtraGuess * (guessesUsed - 1);
}

// Hangman: each life left adds to the base
function hangmanReward(livesLeft) {
    const r = REWARDS.hangman;
    return r.base + r.perLifeLeft * Math.max(0, Math.min(livesLeft, HANGMAN.lives));
}

// Minesweeper: full speed bonus when fast, shrinking to nothing when slow
function minesweeperReward(seconds) {
    const r = REWARDS.minesweeper;
    const speed = clamp01((r.slowSeconds - seconds) / (r.slowSeconds - r.fastSeconds));
    return r.base + Math.round(r.speedBonus * speed);
}

// Memory: 8 moves is a perfect game (one per pair)
function memoryReward(moves, pairs = 8) {
    const r = REWARDS.memory;
    return Math.max(r.minimum, r.perfect - r.perExtraMove * Math.max(0, moves - pairs));
}

// Connect Four: the fewer of your own pieces it took (4 at best, 21 at most), the bigger the bonus
function connect4Reward(winnerMoves, vsBot) {
    const r = vsBot ? REWARDS.connect4.vsBot : REWARDS.connect4.vsPlayer;
    return r.base + Math.round(r.quickBonus * clamp01((21 - winnerMoves) / 17));
}

// Party games: the winner's coins grow with the number of people they beat
function winnerReward(gameType, players) {
    const r = REWARDS[gameType];
    return r.winner + r.perOpponent * Math.max(0, players - 1);
}

module.exports = { triviaReward, wordleReward, hangmanReward, minesweeperReward, memoryReward, connect4Reward, winnerReward };
