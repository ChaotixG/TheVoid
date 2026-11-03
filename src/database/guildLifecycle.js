// Tracks which guilds the bot is in. Leaving a guild only marks it; its data is deleted
// 30 days later, so an accidental kick followed by a re-invite loses nothing.
const Server = require('../models/Server');
const Member = require('../models/Member');
const TempVoiceChannel = require('../models/TempVoiceChannel');
const { invalidateGuildSettings } = require('../services/guildSettings');
const { info } = require('../services/logger');

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// A dev bot is only in a few servers. If it ever points at the production database, it must not
// mark (and eventually purge) every other server as "left", so it never marks or purges anything.
const isDevBot = () => Boolean(process.env.DEV_GUILD_ID);

async function markGuildJoined(guildId) {
    await Server.updateOne({ guildId }, { $set: { leftAt: null } }, { upsert: true });
}

async function markGuildLeft(guildId) {
    if (isDevBot()) return;
    await Server.updateOne({ guildId }, { $set: { leftAt: new Date() } });
    invalidateGuildSettings(guildId);
}

// Catch up on joins/leaves that happened while the bot was offline.
// (Assumes a single process sees every guild; revisit if the bot is ever sharded.)
async function syncGuilds(client) {
    const ids = [...client.guilds.cache.keys()];
    if (ids.length) {
        await Server.bulkWrite(ids.map(guildId => ({
            updateOne: { filter: { guildId }, update: { $set: { leftAt: null } }, upsert: true },
        })), { ordered: false });
    }
    if (isDevBot()) return;

    const left = await Server.updateMany(
        { guildId: { $nin: ids }, leftAt: null },
        { $set: { leftAt: new Date() } }
    );
    if (left.modifiedCount) info(`Marked ${left.modifiedCount} servers as left while offline`);
}

async function purgeDepartedGuilds(client) {
    if (isDevBot()) return;
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const stale = await Server.find({ leftAt: { $ne: null, $lte: cutoff } }, { guildId: 1 }).lean();

    // Never purge a guild the bot is in right now, whatever the stored flag says
    const guildIds = stale.map(s => s.guildId).filter(id => !client.guilds.cache.has(id));
    if (!guildIds.length) return;

    await Promise.all([
        Member.deleteMany({ guildId: { $in: guildIds } }),
        TempVoiceChannel.deleteMany({ guildId: { $in: guildIds } }),
        Server.deleteMany({ guildId: { $in: guildIds }, leftAt: { $ne: null, $lte: cutoff } }),
    ]);
    info(`Deleted data for ${guildIds.length} servers the bot left over 30 days ago`);
}

module.exports = { markGuildJoined, markGuildLeft, syncGuilds, purgeDepartedGuilds };
