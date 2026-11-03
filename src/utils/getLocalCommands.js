const path = require('path');
const getAllFiles = require('./getAllFiles');

// Every file under src/commands exports { data: SlashCommandBuilder, callback, botPermissions? }
module.exports = () => {
    const commandFiles = getAllFiles(path.join(__dirname, '..', 'commands'), false, true);
    return commandFiles.map(file => {
        const command = require(file);
        if (!command.data || typeof command.callback !== 'function') {
            throw new Error(`Command file ${path.relative(process.cwd(), file)} must export { data, callback }`);
        }
        return command;
    });
};
