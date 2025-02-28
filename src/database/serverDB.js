const Server = require('../models/Server'); // Adjust path as needed

async function addServer(guildId) {
    try {
        const existingServer = await Server.findOne({ guildId });
        if (existingServer) return console.log('Server already exists in the database.');

        const newServer = new Server({
            guildId,
            channelsId: [],
            disabledCommands: [],
            users: []
        });

        await newServer.save();
        console.log(`Server ${guildId} added to the database.`);
    } catch (error) {
        console.error(`Error adding server: ${error}`);
    }
}

module.exports = { addServer }; // Export for use in other files
