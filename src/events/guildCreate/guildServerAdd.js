const Server = require('../../models/Server');
const { log, info, warn, error } = require("../../services/logger")

module.exports = async (client, guild) => {
    try {
        // Check if the server already exists
        info(`Joined a new server: ${guild.id}`);
        const existingServer = await Server.findOne({ guildId: guild.id });

        if (existingServer) {
            warn(`Server ${guild.id} already exists in the database.`);
            return;
        }

        // Create a new server entry
        const newServer = new Server({
            guildId: guild.id,
            channels: [],         // Empty array initially
            disabledCommands: [],   // Empty array initially
            users: [],              // Empty array for users
            settings: {}            // Empty object for settings
        });

        await newServer.save();
        log(`New server ${guild.id} added to the database.`);
    } catch (err) {
        error(`Error adding new server: `, err);
    }
};
