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

        // Party games: coins for how well you did, plus a bonus for the winner (shared on a tie)
        triviaParty: { perCorrect: 3, speedBonus: 2, winnerBonus: 10 }, // speed bonus: full for an instant answer
        scramble: { perWord: 5, winnerBonus: 10 },
        wordChain: { perWord: 1, maxWords: 20, winner: 15, perOpponent: 5 },
        higherLower: { perRound: 2, winner: 15, perOpponent: 3 },
        crazyEights: { winner: 20, perOpponent: 8, runnerUp: 8 },
        liarsDice: { winner: 20, perOpponent: 8, runnerUp: 8 },
        wordTiles: { winner: 25, perOpponent: 10, pointsPerCoin: 25 }, // plus 1 coin per 25 points scored
    },

    IDLE_MINUTES: 10,       // a game ends after this long without a move
    CHALLENGE_SECONDS: 60,  // time to accept a challenge
    TRIVIA_SECONDS: 20,     // time to answer a trivia question
    MENU_MINUTES: 5,        // an unused /games menu is removed after this long
    LOBBY_SECONDS: 180,     // a party lobby starts by itself after this (or closes, if too few joined)
    TURN_PING_SECONDS: 10,  // whoever's turn it is gets a ping if they haven't moved after this long

    MINESWEEPER: { size: 5, mines: 4 },
    WORDLE: { guesses: 6 },
    HANGMAN: { lives: 6 },

    // Party games (2+ players, joined from a lobby)
    PARTY: {
        triviaParty: { minPlayers: 2, maxPlayers: 20, questions: 10, answerSeconds: 15, revealSeconds: 6 },
        crazyEights: { minPlayers: 2, maxPlayers: 8, handSize: 7, turnSeconds: 60 },
        liarsDice: { minPlayers: 2, maxPlayers: 6, dice: 5, turnSeconds: 60, revealSeconds: 5 },
        wordChain: { minPlayers: 2, maxPlayers: 12, turnSeconds: 30, minTurnSeconds: 10, minLength: 3 },
        scramble: { minPlayers: 2, maxPlayers: 20, rounds: 10, roundSeconds: 30, pauseSeconds: 3 },
        higherLower: { minPlayers: 2, maxPlayers: 20, guessSeconds: 15, maxRounds: 15 },
        wordTiles: { minPlayers: 2, maxPlayers: 4, turnSeconds: 180, missedTurnsOut: 2 }, // out after 2 timeouts in a row
    },

    // Word Tiles is offered in the menu (its board picture was approved)
    WORD_TILES_ENABLED: true,
};
