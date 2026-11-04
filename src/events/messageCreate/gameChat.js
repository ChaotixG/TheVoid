const { handleMessage } = require('../../features/games/chat');

/**
 * Chat-based party games (Scramble, Word Chain) read players' messages in their channel.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
module.exports = async (client, message) => {
    if (!message.inGuild() || message.author.bot || message.webhookId) return;
    await handleMessage(message);
};
