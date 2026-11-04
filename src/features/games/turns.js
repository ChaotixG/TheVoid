// "Your turn" pings for turn-based party games. Moves edit the game message, and edits don't notify
// anyone, so if whoever's turn it is hasn't moved after a few seconds, they get a short ping. It's
// deleted as soon as the turn ends (sessions.endGame removes it when the game ends).
//
// Usage in a game: announceTurn(game, userId) whenever a new turn starts; clearTurn(game) when
// turns stop for a while (e.g. a reveal between rounds).
const gameConfig = require('../../config/games'); // read when used, so tests can shorten the wait
const { getGame, runExclusive, tokenFresh } = require('./sessions');
const { warn } = require('../../services/logger');

function clearTurn(game) {
    game.turnSeq = (game.turnSeq ?? 0) + 1; // a ping still waiting for this turn won't go out
    clearTimeout(game.pingTimer);
    const ping = game.ping;
    game.ping = null;
    ping?.remove().catch(() => {});
}

function announceTurn(game, userId) {
    clearTurn(game);
    const seq = game.turnSeq;
    game.pingTimer = setTimeout(() => runExclusive(game, async () => {
        if (!getGame(game.id) || game.turnSeq !== seq) return; // they moved, or the game ended
        game.ping = await sendPing(game, userId);
    }), gameConfig.TURN_PING_SECONDS * 1000);
}

// Sends the ping as a follow-up of the latest click on the game (no extra permissions needed), or
// through the channel once that click is too old to send follow-ups
async function sendPing(game, userId) {
    const payload = { content: `<@${userId}>, it's your turn in **${game.title}**!`, allowedMentions: { users: [userId] } };
    try {
        const latest = game.lastInteraction;
        if (tokenFresh(latest)) {
            const message = await latest.followUp(payload);
            return message && { remove: () => latest.deleteReply(message.id).catch(() => message.delete?.()) };
        }
        const channel = game.message?.channel ?? await game.message?.client?.channels.fetch(game.message.channelId);
        const message = await channel?.send(payload);
        return message && { remove: () => message.delete() };
    } catch (err) {
        warn(`Could not send a turn ping in game ${game.id}: ${err.message}`);
        return null;
    }
}

module.exports = { announceTurn, clearTurn };
