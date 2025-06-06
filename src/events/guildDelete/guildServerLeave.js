
const Server = require('../../models/Server');

module.exports = async (client, guild) => {
    console.log(`Left server: ${guild.id}`);
    // Optionally remove the server from your database
    await Server.deleteOne({ guildId: guild.id });
};