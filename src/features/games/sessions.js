// Live games, kept in memory: they're short, so they don't need to survive a restart (after one,
// old buttons just say the game ended). Each game handles one interaction at a time, so two fast
// clicks can never apply two moves on top of each other.
const { randomBytes } = require('crypto');
const { MessageFlags } = require('discord.js');
const { IDLE_MINUTES } = require('../../config/games');
const { warn } = require('../../services/logger');

const games = new Map(); // id → game

function createGame(type, data) {
    const id = randomBytes(5).toString('hex');
    const game = { id, type, createdAt: Date.now(), lastActivity: Date.now(), queue: Promise.resolve(), ...data };
    games.set(id, game);
    return game;
}

const getGame = (id) => games.get(id);

function endGame(game) {
    clearTimeout(game.timer);
    games.delete(game.id);
}

// Runs fn after any interaction already being handled for this game
function runExclusive(game, fn) {
    const run = game.queue.then(fn, fn);
    game.queue = run.catch(() => {});
    return run;
}

// Remember the latest interaction on the game message: its token lets us edit the message later
// (expiry, timers). Clicks in someone's private view (e.g. their hand of cards) can't edit it.
function touch(game, interaction) {
    game.lastActivity = Date.now();
    if (!interaction || interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) return;
    game.lastInteraction = interaction;
    if (interaction.message) game.message = interaction.message; // for edits once tokens expire
}

// Interaction tokens can edit for 15 minutes; after that the bot edits its own message
const TOKEN_MS = 14 * 60_000;

/** Edits the game message outside of a click on it (timers, idle expiry, moves made in someone's private view) */
async function editGame(game, payload) {
    const latest = game.lastInteraction;
    try {
        if (latest && Date.now() - (latest.createdTimestamp ?? Date.now()) < TOKEN_MS) await latest.editReply(payload);
        else if (game.message) await game.message.edit(payload);
    } catch (err) {
        warn(`Could not update game ${game.id}: ${err.message}`);
    }
}

// End games nobody has touched for a while, and say so on their message
setInterval(() => {
    const cutoff = Date.now() - IDLE_MINUTES * 60_000;
    for (const game of games.values()) {
        if (game.lastActivity > cutoff) continue;
        runExclusive(game, async () => {
            // Re-check under the lock: a move that was in progress may have finished or ended the game
            if (!games.has(game.id) || game.lastActivity > cutoff) return;
            endGame(game);
            const payload = game.onExpire?.();
            if (payload) await editGame(game, payload);
        });
    }
}, 60_000).unref();

module.exports = { createGame, getGame, endGame, runExclusive, touch, editGame, games };
