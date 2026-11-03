const { markGuildLeft } = require('../../database/guildLifecycle');
const { warn } = require("../../services/logger")

module.exports = async (client, guild) => {
    warn(`Left server: ${guild.id}. Its data will be deleted in 30 days unless the bot is re-added.`);
    await markGuildLeft(guild.id);
};
