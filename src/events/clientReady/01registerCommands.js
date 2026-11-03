const getLocalCommands = require('../../utils/getLocalCommands');
const { info } = require("../../services/logger")

// Registers every command in one bulk call. Unchanged commands don't count toward Discord's
// daily creation limit, so doing this on each start is safe. With DEV_GUILD_ID set (a dev bot),
// commands go to that one server only, where updates show up instantly.
module.exports = async (client) => {
    const commands = getLocalCommands().map(cmd => cmd.data.toJSON());
    const devGuildId = process.env.DEV_GUILD_ID;

    const manager = devGuildId
        ? (await client.guilds.fetch(devGuildId)).commands
        : client.application.commands;

    const registered = await manager.set(commands);
    info(`Registered ${registered.size} commands ${devGuildId ? `in dev server ${devGuildId}` : 'globally'}: ${[...registered.values()].map(c => c.name).join(', ')}`);
};
