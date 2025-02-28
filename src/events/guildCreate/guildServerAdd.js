const Server = require('../../models/Server');

module.exports = async (client, guild) => {
    try {
        // Check if the server already exists
        console.log(`Joined a new server: ${guild.id}`);
        const existingServer = await Server.findOne({ guildId: guild.id });

        if (existingServer) {
            console.log(`Server ${guild.id} already exists in the database.`);
            return;
        }

        // Create a new server entry
        const newServer = new Server({
            guildId: guild.id,
            channelsId: [],         // Empty array initially
            disabledCommands: [],   // Empty array initially
            users: []               // Empty array for users
        });

        await newServer.save();
        console.log(`New server ${guild.id} added to the database.`);
    } catch (error) {
        console.error(`Error adding new server: ${error}`);
    }
};
