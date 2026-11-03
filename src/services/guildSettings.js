// Single place to read and write a guild's settings.
// Reads are cached (hot paths like messageCreate/voiceStateUpdate); every write goes through
// updateGuildSettings, which refreshes the cache with the saved result. The TTL only matters
// if another bot process changed the same guild.
const Server = require("../models/Server");

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // guildId → { settings, expires }
const writeVersions = new Map(); // guildId → number of writes/invalidations so far

const bumpVersion = (guildId) => writeVersions.set(guildId, (writeVersions.get(guildId) ?? 0) + 1);

function toSettings(doc, guildId) {
    // A missing document still gets the schema defaults (without saving anything)
    return (doc ?? new Server({ guildId })).toObject().settings;
}

async function getGuildSettings(guildId, { fresh = false } = {}) {
    const hit = cache.get(guildId);
    if (!fresh && hit && hit.expires > Date.now()) return hit.settings;

    const versionAtStart = writeVersions.get(guildId) ?? 0;
    const doc = await Server.findOne({ guildId }, { settings: 1 });
    const settings = toSettings(doc, guildId);
    // A write that finished while this read was in flight already cached newer data; don't overwrite it
    if ((writeVersions.get(guildId) ?? 0) === versionAtStart) {
        cache.set(guildId, { settings, expires: Date.now() + CACHE_TTL_MS });
    }
    return settings;
}

// `update` is a MongoDB update on paths under `settings.` (e.g. { $set: { 'settings.staffRoleIds': ids } }).
// `extraFilter` makes the write conditional; then nothing is created and null is returned if it doesn't match.
async function updateGuildSettings(guildId, update, extraFilter = null) {
    bumpVersion(guildId);
    const doc = await Server.findOneAndUpdate({ guildId, ...extraFilter }, update, {
        upsert: !extraFilter,
        returnDocument: 'after',
        runValidators: true,
        projection: { settings: 1 },
    });
    if (!doc) return null;

    const settings = toSettings(doc, guildId);
    bumpVersion(guildId);
    cache.set(guildId, { settings, expires: Date.now() + CACHE_TTL_MS });
    return settings;
}

function invalidateGuildSettings(guildId) {
    bumpVersion(guildId);
    cache.delete(guildId);
}

module.exports = { getGuildSettings, updateGuildSettings, invalidateGuildSettings };
