const Server = require('../models/Server'); // Adjust path as needed
const { log, warn, error } = require("../services/logger")

async function addServer(guildId) {
    try {
        const existingServer = await Server.findOne({ guildId });
        if (existingServer) return warn('Server already exists in the database.');

        const newServer = new Server({
            guildId,
            channelsId: [],
            disabledCommands: [],
            users: []
        });

        await newServer.save();
        log(`Server ${guildId} added to the database.`);
    } catch (err) {
        error(`Error adding server: `, err);
    }
}

module.exports = { addServer }; // Export for use in other files
