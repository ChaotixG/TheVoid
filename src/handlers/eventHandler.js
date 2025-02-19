const path = require('path');
const getAllFiles = require('../utils/getAllFiles');

module.exports = (client) => {
    // Get all event folders
    const eventFolders = getAllFiles(path.join(__dirname, '..', 'events'), true);

    for (const eventFolder of eventFolders) {
        // Get all event files (ensure only ONE file per event runs)
        const eventFiles = getAllFiles(eventFolder, false, true, true);
        eventFiles.sort((a, b) => a > b); // Sort files

        // Derive event name from folder name
        const eventName = path.basename(eventFolder);
        const eventFile = eventFiles[0]; // Load only the first event file

        if (!eventFile) continue; // Skip empty folders

        console.log(`Registering event: ${eventName} from file: ${eventFile}`);

        // Attach event listener (only for the first file found)
        const eventFunction = require(eventFile);
        client.on(eventName, async (...args) => {
            await eventFunction(client, ...args);
        });
    }
};
