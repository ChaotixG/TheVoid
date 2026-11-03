// Game rules and coin rewards. Fixed in code (like all coin amounts) so every server is equal.
// Rewards are only paid for wins, and most scale with how well you played (see games/scoring.js).
module.exports = {
    // Most coins one person can win from games per day (UTC), across all servers
    DAILY_CAP: 500,

    REWARDS: {
        // Solo trivia: by difficulty, plus a bonus for each answer in a row
        trivia: { easy: 5, medium: 10, hard: 15, streakBonus: 2, maxStreakBonus: 10 },
        tictactoe: { vsPlayer: 25, vsBot: 10 },
        // A base for winning plus a bonus for winning quickly (fewer of your own moves)
        connect4: { vsPlayer: { base: 20, quickBonus: 15 }, vsBot: { base: 8, quickBonus: 8 } },
        wordle: { firstGuess: 40, perExtraGuess: 5 }, // 40 for a first-guess win, down to 15 on the sixth
        hangman: { base: 10, perLifeLeft: 3 },
        // Full speed bonus when cleared within fastSeconds, shrinking to nothing at slowSeconds
        minesweeper: { base: 15, speedBonus: 20, fastSeconds: 30, slowSeconds: 180 },
        // A perfect game (8 moves) pays the most; each extra move costs a little
        memory: { perfect: 40, perExtraMove: 2, minimum: 10 },
    },

    IDLE_MINUTES: 10,       // a game ends after this long without a move
    CHALLENGE_SECONDS: 60,  // time to accept a challenge
    TRIVIA_SECONDS: 20,     // time to answer a trivia question

    MINESWEEPER: { size: 5, mines: 4 },
    WORDLE: { guesses: 6 },
    HANGMAN: { lives: 6 },
};
