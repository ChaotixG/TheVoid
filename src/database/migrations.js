// One-time data migrations, run on every startup. Each step only touches documents that still
// have the old shape, so re-running is a no-op. Nothing is deleted: the old embedded user list
// is kept as `legacyUsers` until you decide to drop it.
const Server = require('../models/Server');
const Member = require('../models/Member');
const TempVoiceChannel = require('../models/TempVoiceChannel');
const { totalXpForLevel } = require('../utils/leveling');
const { info } = require('../services/logger');

async function migrateEmbeddedUsers() {
    const servers = await Server.collection
        .find({ 'users.0': { $exists: true } }, { projection: { guildId: 1, users: 1 } })
        .toArray();

    let copied = 0;
    for (const server of servers) {
        // Old races could leave duplicate entries for one user; keep the one with the most XP
        const best = new Map();
        for (const u of server.users) {
            if (!u?.userId) continue;
            const totalXp = totalXpForLevel(Math.max(1, Number(u.level) || 1)) + Math.max(0, Number(u.xp) || 0);
            if (!best.has(u.userId) || best.get(u.userId).totalXp < totalXp) {
                best.set(u.userId, { totalXp, balance: Math.max(0, Number(u.balance) || 0), lastDaily: u.lastDaily ?? null });
            }
        }

        const ops = [...best].map(([userId, data]) => ({
            updateOne: {
                filter: { guildId: server.guildId, userId },
                update: { $setOnInsert: data }, // never overwrites a member that already exists
                upsert: true,
            },
        }));
        if (ops.length) {
            const result = await Member.bulkWrite(ops, { ordered: false });
            copied += result.upsertedCount;
        }
        await Server.collection.updateOne({ _id: server._id }, { $rename: { users: 'legacyUsers' } });
    }
    if (servers.length) info(`Migration: copied ${copied} members from ${servers.length} servers (old list kept as legacyUsers)`);
}

async function migrateVoiceHubs() {
    const result = await Server.collection.updateMany(
        { 'settings.channels': { $exists: true }, 'settings.voiceHubs': { $exists: false } },
        { $rename: { 'settings.channels': 'settings.voiceHubs' } }
    );
    if (result.modifiedCount) info(`Migration: moved voice hubs for ${result.modifiedCount} servers`);
}

async function migrateTempVoiceChannels() {
    const servers = await Server.collection
        .find({ channels: { $exists: true } }, { projection: { guildId: 1, channels: 1 } })
        .toArray();

    for (const server of servers) {
        const ops = (server.channels || []).filter(c => c?.channelId).map(c => ({
            updateOne: {
                filter: { channelId: c.channelId },
                update: { $setOnInsert: { guildId: server.guildId, ownerId: null } },
                upsert: true,
            },
        }));
        if (ops.length) await TempVoiceChannel.bulkWrite(ops, { ordered: false });
        await Server.collection.updateOne({ _id: server._id }, { $unset: { channels: '' } });
    }
    if (servers.length) info(`Migration: moved temp voice channels for ${servers.length} servers`);
}

// The single staff role became a list (staff and moderator roles are now separate lists)
async function migrateStaffRole() {
    const servers = await Server.collection
        .find({ 'settings.staffRoleId': { $exists: true } }, { projection: { 'settings.staffRoleId': 1, 'settings.staffRoleIds': 1 } })
        .toArray();

    for (const server of servers) {
        const { staffRoleId, staffRoleIds } = server.settings;
        const update = { $unset: { 'settings.staffRoleId': '' } };
        if (staffRoleId && !staffRoleIds?.length) update.$set = { 'settings.staffRoleIds': [staffRoleId] };
        await Server.collection.updateOne({ _id: server._id }, update);
    }
    if (servers.length) info(`Migration: moved the staff role to the staff role list for ${servers.length} servers`);
}

async function runMigrations() {
    // Build indexes first so the unique (guildId, userId) index guards the copy
    await Promise.all([Server.init(), Member.init(), TempVoiceChannel.init()]);
    await migrateEmbeddedUsers();
    await migrateVoiceHubs();
    await migrateTempVoiceChannels();
    await migrateStaffRole();
}

module.exports = { runMigrations };
