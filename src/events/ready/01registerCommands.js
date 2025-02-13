const areCommandsDifferent = require('../../utils/areCommandsDifferent');
const getApplicationCommands = require('../../utils/getApplicationCommands');
const getLocalCommands = require('../../utils/getLocalCommands');

module.exports = async (client) => {
    try {
        console.log("Registering commands...");

        const localCommands = getLocalCommands();
        const applicationCommands = await getApplicationCommands(client);

        for (const localCommand of localCommands) {
            const { name, description, options } = localCommand;

            const existingCommand = await applicationCommands.cache.find(
                (cmd) => cmd.name === name
            );

            if (existingCommand) {
                if (localCommand.deleted) {
                    // Keep the original method as per your requirement
                    await applicationCommands.deleted(existingCommand.id);
                    console.log(`Deleted command "${name}".`);
                    continue;
                }

                if (areCommandsDifferent(existingCommand, localCommand)) {
                    // Edit the existing command if it has changed
                    await applicationCommands.edit(existingCommand.id, {
                        description, // Fixed typo here
                        options,
                    });
                    console.log(`Edited command "${name}".`);
                }
            } else {
                if (localCommand.deleted) {
                    // Skip registration if the command is marked as deleted
                    console.log(`Skipping registration of deleted command "${name}".`);
                    continue;
                }

                // Register the new command
                await applicationCommands.create({
                    name,
                    description,
                    options,
                });
                console.log(`Registered command "${name}".`);
            }
        }

    } catch (error) {
        console.log(`There was an error in registerCommands: ${error}`);
    }
};
