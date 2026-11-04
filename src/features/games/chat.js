// Party games played by typing in chat (Scramble, Word Chain). One per channel at a time, and only
// the players' messages are passed on. The bot has to be able to see the channel to read them.
const { PermissionFlagsBits } = require('discord.js');
const { getGame, runExclusive } = require('./sessions');

const listening = new Map(); // channelId → game

/** The chat game running in this channel, if any */
function chatGameIn(channelId) {
    const game = listening.get(channelId);
    if (game && getGame(game.id)) return game;
    listening.delete(channelId);
    return null;
}

/** Why a chat game can't run where this interaction happened, or null if it can */
function cannotListen(interaction) {
    if (chatGameIn(interaction.channelId)) return 'A chat game is already running in this channel. Try another channel, or wait for it to finish.';
    const me = interaction.guild?.members.me;
    if (!interaction.channel || !me || !interaction.channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel)) {
        return 'I can\'t see messages in this channel, so I can\'t run a chat game here.';
    }
    return null;
}

/** Passes the players' messages in the game's channel to onMessage(game, message), one at a time */
function listen(game, onMessage) {
    game.onMessage = onMessage;
    listening.set(game.channelId, game);
}

async function handleMessage(message) {
    const game = chatGameIn(message.channelId);
    if (!game || !game.players.includes(message.author.id)) return;
    await runExclusive(game, async () => {
        if (getGame(game.id)) await game.onMessage(game, message);
    });
}

module.exports = { listen, cannotListen, chatGameIn, handleMessage, listening };
