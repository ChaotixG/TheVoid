const getLocalCommands = require('../../utils/getLocalCommands');
const { info, warn } = require('../../services/logger');

const names = (registered) => [...registered.values()].map(c => c.name).join(', ');

// Registers every command in one bulk call. Unchanged commands don't count toward Discord's
// daily creation limit, so doing this on each start is safe. With DEV_GUILD_ID set (a dev bot),
// all commands go to that one server only, where updates show up instantly.
// Bot owner commands (botOwnerOnly) only go to the owner's own server (OWNER_GUILD_ID), so nobody
// else ever sees them; they also check who's using them.
module.exports = async (client) => {
    const commands = getLocalCommands();
    const json = (list) => list.map(cmd => cmd.data.toJSON());

    const devGuildId = process.env.DEV_GUILD_ID;
    if (devGuildId) {
        const registered = await (await client.guilds.fetch(devGuildId)).commands.set(json(commands));
        return info(`Registered ${registered.size} commands in dev server ${devGuildId}: ${names(registered)}`);
    }

    const registered = await client.application.commands.set(json(commands.filter(cmd => !cmd.botOwnerOnly)));
    info(`Registered ${registered.size} commands globally: ${names(registered)}`);

    const ownerCommands = commands.filter(cmd => cmd.botOwnerOnly);
    const ownerGuildId = process.env.OWNER_GUILD_ID;
    if (!ownerGuildId) return warn('OWNER_GUILD_ID isn\'t set, so the bot owner commands (/botowner) aren\'t available anywhere.');
    const guild = await client.guilds.fetch(ownerGuildId).catch(() => null);
    if (!guild) return warn(`OWNER_GUILD_ID is ${ownerGuildId}, but I'm not in that server, so /botowner isn't available.`);
    const own = await guild.commands.set(json(ownerCommands));
    info(`Registered ${own.size} bot owner command(s) in ${guild.name}: ${names(own)}`);
};
