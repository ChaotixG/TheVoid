const areCommandsDifferent = require('../../utils/areCommandsDifferent');
const getApplicationCommands = require('../../utils/getApplicationCommands');
const getLocalCommands = require('../../utils/getLocalCommands');
const { log, info, warn, error } = require("../../services/logger")

module.exports = async (client) => {
    try {
        log("Registering commands...");

        const localCommands = getLocalCommands();
        const applicationCommands = await getApplicationCommands(client);

        for (const localCommand of localCommands) {
            const { name, description, options } = localCommand;

            // Validate command name
            if (!/^[\w-]{1,32}$/.test(name)) {
                warn(`Invalid command name "${name}". Skipping registration.`);
                continue;
            }
            const existingCommand = await applicationCommands.cache.find(
                (cmd) => cmd.name === name
            );

            if (existingCommand) {
                if (localCommand.deleted) {
                    // Keep the original method as per your requirement
                    await applicationCommands.delete(existingCommand.id);
                    warn(`Deleted command "${name}".`);
                    continue;
                }

                if (areCommandsDifferent(existingCommand, localCommand)) {
                    // Edit the existing command if it has changed
                    const editPayload = { description };
                    if (localCommand.options) {
                        editPayload.options = localCommand.options;
                    } else {
                        editPayload.options = [];
                    }
                    await applicationCommands.edit(existingCommand.id, editPayload);
                    warn(`Edited command "${name}".`);
                }
            } else {
                if (localCommand.deleted) {
                    // Skip registration if the command is marked as deleted
                    warn(`Skipping registration of deleted command "${name}".`);
                    continue;
                }

                // Register the new command
                await applicationCommands.create({
                    name,
                    description,
                    options,
                });
                info(`Registered command "${name}".`);
            }
        }

        // Delete any application commands that don't exist locally
        const localCommandNames = new Set(localCommands.map(cmd => cmd.name));
        for (const appCommand of applicationCommands.cache.values()) {
            if (!localCommandNames.has(appCommand.name)) {
                await applicationCommands.delete(appCommand.id);
                warn(`Deleted orphaned command "${appCommand.name}".`);
            }
        }

    } catch (err) {
        error(`There was an error in registerCommands: `, err);
    }
};
