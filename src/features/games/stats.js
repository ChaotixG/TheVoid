// Per-person game stats: games played, wins and best score in each game, across all servers.
// A game calls recordGame() once, when it reaches its result (not when it's called off or left idle,
// except solo Trivia, which has no last question: leaving it to time out is how it usually ends).
const GameStats = require('../../models/GameStats');
const { warn } = require('../../services/logger');

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// What "best" means in each game (higher is better unless `lower`), and how it's shown
const BEST = {
    wordle: { lower: true, show: (n) => plural(n, 'guess', 'guesses') },
    hangman: { show: (n) => `${plural(n, 'life', 'lives')} left` },
    minesweeper: { lower: true, show: (n) => `${n}s` },
    memory: { lower: true, show: (n) => plural(n, 'move') },
    trivia: { show: (n) => `${n} in a row` },
    triviaParty: { show: (n) => plural(n, 'point') },
    wordChain: { show: (n) => plural(n, 'word') },
    scramble: { show: (n) => plural(n, 'word') },
    higherLower: { show: (n) => `${n} right` },
};

// Games with a winner (the rest only count games played and the best score)
const HAS_WINS = new Set(['tictactoe', 'connect4', 'triviaParty', 'crazyEights', 'liarsDice', 'wordChain', 'scramble', 'higherLower']);

/**
 * Records a finished game for everyone in `game.players` (the bot opponent isn't counted).
 * `winners`: who won; `scores`: { userId: number } for games with a best score.
 */
async function recordGame(game, { winners = [], scores = {} } = {}) {
    const best = BEST[game.type];
    const ops = (game.players ?? []).filter(id => id !== 'bot').map(userId => ({
        updateOne: {
            filter: { userId, game: game.type },
            update: {
                $inc: { played: 1, wins: winners.includes(userId) ? 1 : 0 },
                ...(best && Number.isFinite(scores[userId]) ? { [best.lower ? '$min' : '$max']: { best: scores[userId] } } : {}),
            },
            upsert: true,
        },
    }));
    if (!ops.length) return;
    await GameStats.bulkWrite(ops).catch(err => warn(`Could not save stats for game ${game.id}: ${err.message}`));
}

/** One line per game this person has played: "12 played · 9 wins · best 2 guesses" */
async function statsFor(userId) {
    const rows = await GameStats.find({ userId }).lean();
    return new Map(rows.map(r => [r.game, [
        plural(r.played ?? 0, 'game'),
        HAS_WINS.has(r.game) ? plural(r.wins ?? 0, 'win') : null,
        Number.isFinite(r.best) && BEST[r.game] ? `best ${BEST[r.game].show(r.best)}` : null,
    ].filter(Boolean).join(' · ')]));
}

module.exports = { recordGame, statsFor };
