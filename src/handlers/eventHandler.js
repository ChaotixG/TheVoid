const path = require('path');
const getAllFiles = require('../utils/getAllFiles');
const { debug, warn, error } = require("../services/logger")

// Every file in events/<eventName>/ is registered as a listener for <eventName>.
// Files run in name order (prefix with 01, 02... when order matters).
module.exports = (client) => {
    const eventFolders = getAllFiles(path.join(__dirname, '..', 'events'), true);

    if (!eventFolders.length) {
        warn("No event folders found.");
        return;
    }

    for (const eventFolder of eventFolders) {
        const eventName = path.basename(eventFolder); // Event name from folder name
        const eventFiles = getAllFiles(eventFolder, false, true).sort();

        for (const eventFile of eventFiles) {
            debug(`Registering event: ${eventName} from file: ${path.basename(eventFile)}`);
            const eventFunction = require(eventFile);
            client.on(eventName, async (...args) => {
                try {
                    await eventFunction(client, ...args); // Execute the event
                } catch (err) {
                    error(`Error in ${eventName} handler ${path.basename(eventFile)}: `, err);
                }
            });
        }
    }
};
