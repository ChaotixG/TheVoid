
const Server = require('../../models/Server');
const { warn } = require("../../services/logger")

module.exports = async (client, guild) => {
    warn(`Left server: ${guild.id}`);
    // Optionally remove the server from your database
    await Server.deleteOne({ guildId: guild.id });
};