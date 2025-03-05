const path = require('path');
const getAllFiles = require('../utils/getAllFiles');

module.exports = (client) => {
    // Get all event folders
    const eventFolders = getAllFiles(path.join(__dirname, '..', 'events'), true);
    
    if (!eventFolders.length) {
        console.error("No event folders found.");
        return;
    }

    // Loop through all event folders
    eventFolders.forEach(eventFolder => {
        // Get all event files in the folder
        const eventFiles = getAllFiles(eventFolder, false, true, true);
        
        if (!eventFiles.length) {
            console.warn(`No event files found in folder: ${eventFolder}`);
            return;
        }

        eventFiles.sort((a, b) => a.localeCompare(b));  // Sort files alphabetically
        
        const eventName = path.basename(eventFolder);  // Event name from folder name

        // Loop through all event files and register them
        eventFiles.forEach(eventFile => {
            console.log(`Registering event: ${eventName} from file: ${eventFile}`);
            try {
                // Attach event listener (for each event file found)
                const eventFunction = require(eventFile);
                client.on(eventName, async (...args) => {
                    await eventFunction(client, ...args); // Execute the event
                });
            } catch (err) {
                console.error(`Error registering event ${eventName} from file ${eventFile}:`, err);
            }
        });
    });
};
