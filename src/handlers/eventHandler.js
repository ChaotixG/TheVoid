const path = require('path');
const getAllFiles = require('../utils/getAllFiles');

module.exports = (client) => {
    // Get all event folders
    const eventFolders = getAllFiles(path.join(__dirname, '..', 'events'), true);

    if (!eventFolders.length) {
        console.error("No event folders found.");
        return;
    }

    // Interaction handlers for interactionCreate
    const interactionHandlers = {};

    // Loop through all event folders
    eventFolders.forEach(eventFolder => {
        const eventName = path.basename(eventFolder); // Event name from folder name

        if (eventName === 'interactionCreate') {
            // Collect all interaction handlers
            const handlers = getAllFiles(eventFolder, false, true, true);
            handlers.forEach(handlerFile => {
                const handler = require(handlerFile);
                const handlerName = path.basename(handlerFile, '.js'); // Use file name as handler name
                interactionHandlers[handlerName] = handler;
            });
        } else {
            // Default handling for other events
            const eventFiles = getAllFiles(eventFolder, false, true, true);

            eventFiles.forEach(eventFile => {
                console.log(`Registering event: ${eventName} from file: ${eventFile}`);
                try {
                    const eventFunction = require(eventFile);
                    client.on(eventName, async (...args) => {
                        await eventFunction(client, ...args); // Execute the event
                    });
                } catch (err) {
                    console.error(`Error registering event ${eventName} from file ${eventFile}:`, err);
                }
            });
        }
    });

    // Register interactionCreate event once
    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isChatInputCommand()) {
                if (interactionHandlers.handleCommands) {
                    interactionHandlers.handleCommands(client, interaction);
                }
            } else if (interaction.isStringSelectMenu()) {
                if (interactionHandlers.handleTickets) {
                    interactionHandlers.handleTickets(client, interaction);
                }
            } else if (interaction.isModalSubmit()) {
                if (interactionHandlers.handleModals) {
                    await interactionHandlers.handleModals(interaction);
                }
            }
        } catch (err) {
            console.error('Error handling interaction:', err);
        }
    });
};
 