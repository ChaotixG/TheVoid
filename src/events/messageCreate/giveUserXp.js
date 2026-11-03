const { grantMessageXp } = require('../../features/leveling/xp');

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
module.exports = async (client, message) => {
    if (!message.inGuild() || message.author.bot || message.webhookId) return;
    await grantMessageXp(message);
};
