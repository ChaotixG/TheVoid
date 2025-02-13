const path = require('path');
const getAllFiles = require('../utils/getAllFiles');

module.exports = (client) => {
    // Get all folders in events directory
    const eventFolders = getAllFiles(path.join(__dirname, '..', 'events'), true);

    for (const eventFolder of eventFolders) {
        // Get all event files from each folder
        //console.log(getAllFiles(eventFolder,false, true, true, false))
        const eventFiles = getAllFiles(eventFolder,false, true, true);
        eventFiles.sort((a, b) => a > b);
        // Derive event name from folder name
        const eventName = path.basename(eventFolder);
        //console.log(`Registering event: ${eventName}`);

        // Set up listener for each event
        client.on(eventName, async (arg) => {
            for (const eventFile of eventFiles) {
                // Import and execute the event file
                const eventFunction = require(eventFile);
                //console.log(`Executing: ${eventFile}`);
                await eventFunction(client, arg);
            }
        });
    }
};
