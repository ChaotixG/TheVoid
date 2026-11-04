// Live games, kept in memory: they're short, so they don't need to survive a restart (after one,
// old buttons just say the game ended). Each game handles one interaction at a time, so two fast
// clicks can never apply two moves on top of each other.
const { randomBytes } = require('crypto');
const { MessageFlags } = require('discord.js');
const { IDLE_MINUTES } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { warn } = require('../../services/logger');

const games = new Map(); // id → game
const finished = new Map(); // id → { players, at }: recent games' players, for Rematch
const FINISHED_MS = 60 * 60_000;

function createGame(type, data) {
    const id = randomBytes(5).toString('hex');
    const game = { id, type, createdAt: Date.now(), lastActivity: Date.now(), queue: Promise.resolve(), ...data };
    games.set(id, game);
    return game;
}

const getGame = (id) => games.get(id);

function endGame(game) {
    clearTimeout(game.timer);
    clearTimeout(game.pingTimer); // a "your turn" ping that hasn't gone out yet (turns.js)
    game.ping?.remove().catch(() => {});
    game.ping = null;
    games.delete(game.id);

    // Remember who played for an hour, so Rematch can bring them back
    const now = Date.now();
    for (const [id, f] of finished) if (now - f.at > FINISHED_MS) finished.delete(id);
    finished.set(game.id, { players: [...(game.players ?? [])], at: now });
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
    // Where the game is shown, for edits once tokens expire (showGame records it for new messages)
    const message = interaction.gameMessage ?? interaction.message;
    if (message) game.message = message;
}

// Interaction tokens can edit (and send follow-ups) for 15 minutes; after that the bot works
// with its own messages through the channel, which needs it to see the channel
const TOKEN_MS = 14 * 60_000;
const tokenFresh = (interaction) => Boolean(interaction) && Date.now() - (interaction.createdTimestamp ?? Date.now()) < TOKEN_MS;

// Every finished game gets Play again (Rematch for party games) and a way back to the games menu.
// `game.replay` ({ type, state, rematch }) is set by the /games menu when it starts a game.
function withEndButtons(game, payload) {
    const box = payload?.components?.[0];
    if (games.has(game.id) || !game.replay || typeof box?.addActionRowComponents !== 'function') return payload;
    const { type, state, rematch } = game.replay;
    box.addActionRowComponents(row(
        button(`games:again:${type}:${game.id}:${state}`, rematch ? 'Rematch' : 'Play again', ButtonStyle.Success, { emoji: '🔁' }),
        button(`games:menu:${game.id}`, 'Games', ButtonStyle.Secondary, { emoji: '🎮' }),
    ));
    return payload;
}

/** Edits the game message outside of a click on it (timers, idle expiry, moves made in someone's private view) */
async function editGame(game, payload) {
    const latest = game.lastInteraction;
    const finalPayload = withEndButtons(game, payload);
    try {
        if (tokenFresh(latest)) return await latest.editReply(finalPayload);
        const message = game.message;
        if (!message) return;
        // Threads and forum posts may not be loaded yet
        if (!message.channel && message.client) await message.client.channels.fetch(message.channelId);
        await message.edit(finalPayload);
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

module.exports = { createGame, getGame, endGame, runExclusive, touch, editGame, withEndButtons, tokenFresh, games, finished };
