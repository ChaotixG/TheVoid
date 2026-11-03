// One-time data migrations, run on every startup. Each step only touches documents that still
// have the old shape, so re-running is a no-op. Nothing is deleted: the old embedded user list
// is kept as `legacyUsers` until you decide to drop it.
const Server = require('../models/Server');
const Member = require('../models/Member');
const TempVoiceChannel = require('../models/TempVoiceChannel');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const RolePurchase = require('../models/RolePurchase');
const { totalXpForLevel } = require('../utils/leveling');
const { info } = require('../services/logger');

async function migrateEmbeddedUsers() {
    const servers = await Server.collection
        .find({ 'users.0': { $exists: true } }, { projection: { guildId: 1, users: 1, legacyUsers: { $slice: 1 } } })
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

        const now = new Date();
        const ops = [...best].map(([userId, data]) => ({
            updateOne: {
                filter: { guildId: server.guildId, userId },
                update: { $setOnInsert: { ...data, createdAt: now, updatedAt: now } }, // never overwrites a member that already exists
                upsert: true,
            },
        }));
        if (ops.length) {
            // Raw collection on purpose: balance/lastDaily aren't Member fields any more (coins moved
            // to the global Wallet) and Mongoose would strip them before migrateBalancesToWallets sums them
            const result = await Member.collection.bulkWrite(ops, { ordered: false });
            copied += result.upsertedCount;
        }
        // If old code wrote a new `users` list after a previous migration, keep it under its own
        // name; renaming it to `legacyUsers` would overwrite the original backup
        const keepAs = server.legacyUsers ? `legacyUsers_${Date.now()}` : 'legacyUsers';
        await Server.collection.updateOne({ _id: server._id }, { $rename: { users: keepAs } });
    }
    if (servers.length) info(`Migration: copied ${copied} members from ${servers.length} servers (old list kept as legacyUsers)`);
}

async function migrateVoiceHubs() {
    const result = await Server.collection.updateMany(
        { 'settings.channels': { $exists: true }, 'settings.voiceHubs': { $exists: false } },
        { $rename: { 'settings.channels': 'settings.voiceHubs' } }
    );
    if (result.modifiedCount) info(`Migration: moved voice hubs for ${result.modifiedCount} servers`);

    // Hubs added by old code after a previous migration: merge them in instead of ignoring them
    const both = await Server.collection
        .find({ 'settings.channels': { $exists: true }, 'settings.voiceHubs': { $exists: true } }, { projection: { settings: 1 } })
        .toArray();
    for (const server of both) {
        const known = new Set((server.settings.voiceHubs || []).map(h => h.channelId));
        const extra = (server.settings.channels || []).filter(h => h?.channelId && !known.has(h.channelId));
        await Server.collection.updateOne({ _id: server._id }, {
            ...(extra.length ? { $push: { 'settings.voiceHubs': { $each: extra } } } : {}),
            $unset: { 'settings.channels': '' },
        });
    }
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

// Coins moved from per-server balances to one global wallet per user: add them up.
// Each old per-server record is added to its owner's wallet exactly once (the wallet remembers
// which records it absorbed), then cleared. This adds correctly even when the wallet already exists,
// and a re-run or a crash between the two steps can't count anyone's coins twice.
async function migrateBalancesToWallets() {
    const records = await Member.collection
        .find({ $or: [{ balance: { $exists: true } }, { lastDaily: { $exists: true } }] }, { projection: { userId: 1, balance: 1, lastDaily: 1 } })
        .toArray();

    for (const record of records) {
        const amount = Math.max(0, Number(record.balance) || 0);
        await Wallet.updateOne({ userId: record.userId }, { $setOnInsert: { balance: 0 } }, { upsert: true });
        const update = { $inc: { balance: amount, earned: amount }, $push: { migratedFrom: record._id } };
        // The latest claim carries over, so nobody gets a second /daily today
        if (record.lastDaily instanceof Date) update.$max = { lastDaily: record.lastDaily };
        await Wallet.collection.updateOne({ userId: record.userId, migratedFrom: { $ne: record._id } }, update);
        await Member.collection.updateOne({ _id: record._id }, { $unset: { balance: '', lastDaily: '' } });
    }
    if (records.length) info(`Migration: moved coins from ${records.length} per-server records into global wallets`);
}

async function runMigrations() {
    // Build indexes first so the unique (guildId, userId) index guards the copy
    await Promise.all([Server.init(), Member.init(), TempVoiceChannel.init(), Wallet.init(), Transaction.init(), RolePurchase.init()]);
    await migrateEmbeddedUsers();
    await migrateVoiceHubs();
    await migrateTempVoiceChannels();
    await migrateStaffRole();
    await migrateBalancesToWallets();
}

module.exports = { runMigrations };
