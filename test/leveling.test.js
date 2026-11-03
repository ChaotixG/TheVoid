const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startDatabase, stopDatabase, clearDatabase } = require('./helpers');
const { levelFromTotalXp, totalXpForLevel, levelProgress } = require('../src/utils/leveling');
const Server = require('../src/models/Server');
const Member = require('../src/models/Member');
const TempVoiceChannel = require('../src/models/TempVoiceChannel');
const { runMigrations } = require('../src/database/migrations');

before(startDatabase);
after(stopDatabase);
beforeEach(clearDatabase);

test('level math matches the original curve (100 × level XP per level)', () => {
    assert.equal(levelFromTotalXp(0), 1);
    assert.equal(levelFromTotalXp(99), 1);
    assert.equal(levelFromTotalXp(100), 2);
    assert.equal(levelFromTotalXp(299), 2);
    assert.equal(levelFromTotalXp(300), 3);
    for (let level = 1; level <= 500; level++) {
        assert.equal(levelFromTotalXp(totalXpForLevel(level)), level);
        assert.equal(levelFromTotalXp(totalXpForLevel(level) - 1), Math.max(1, level - 1));
    }
    assert.deepEqual(levelProgress(350), { level: 3, xpIntoLevel: 50, xpForNext: 300 });
});

test('migration copies embedded users without changing anyone\'s level, and keeps the old data', async () => {
    await Server.collection.insertOne({
        guildId: 'g1',
        users: [
            { userId: 'a', level: 1, xp: 40, balance: 5 },
            { userId: 'b', level: 7, xp: 123, balance: 0 },
            { userId: 'b', level: 3, xp: 10 }, // duplicate from an old race: the higher one wins
        ],
        channels: [{ channelId: 'vc1' }],
        settings: { channels: [{ name: 'Hub', channelId: 'h1' }], staffRoleId: 'mods', tickets: { complaints: { channelId: 'c', type: 'channel' } } },
    });

    await runMigrations();
    await runMigrations(); // safe to run again

    const a = await Member.findOne({ guildId: 'g1', userId: 'a' }).lean();
    const b = await Member.findOne({ guildId: 'g1', userId: 'b' }).lean();
    assert.equal(await Member.countDocuments(), 2);
    assert.deepEqual(levelProgress(a.totalXp), { level: 1, xpIntoLevel: 40, xpForNext: 100 });
    assert.deepEqual(levelProgress(b.totalXp), { level: 7, xpIntoLevel: 123, xpForNext: 700 });
    assert.equal(a.balance, 5);

    const raw = await Server.collection.findOne({ guildId: 'g1' });
    assert.equal(raw.users, undefined);
    assert.equal(raw.legacyUsers.length, 3, 'old list is kept, not deleted');
    assert.deepEqual(raw.settings.voiceHubs, [{ name: 'Hub', channelId: 'h1' }]);
    assert.deepEqual(raw.settings.staffRoleIds, ['mods']);
    assert.equal(raw.settings.staffRoleId, undefined);
    assert.equal(raw.channels, undefined);
    assert.equal(await TempVoiceChannel.countDocuments({ channelId: 'vc1' }), 1);
});

test('old code running after a migration: the original backup is never overwritten', async () => {
    await Server.collection.insertOne({
        guildId: 'g1',
        users: [{ userId: 'a', level: 5, xp: 10 }],
        channels: [],
        settings: { channels: [{ name: 'Hub', channelId: 'h1' }] },
    });
    await runMigrations();

    // The old bot keeps running on the migrated data: fresh XP list, a new hub, a temp channel
    await Server.collection.updateOne({ guildId: 'g1' }, { $set: {
        users: [{ userId: 'a', level: 1, xp: 30 }, { userId: 'newcomer', level: 1, xp: 20 }],
        channels: [{ channelId: 'vc9', channelName: 'Temp' }],
        'settings.channels': [{ name: 'Hub', channelId: 'h1' }, { name: 'Hub 2', channelId: 'h2' }],
    } });
    await runMigrations();

    const raw = await Server.collection.findOne({ guildId: 'g1' });
    assert.deepEqual(raw.legacyUsers, [{ userId: 'a', level: 5, xp: 10 }], 'original backup untouched');
    const extraKey = Object.keys(raw).find(k => k.startsWith('legacyUsers_'));
    assert.equal(raw[extraKey].length, 2, 'the old bot\x27s later list is kept separately');
    assert.equal(raw.users, undefined);

    const a = await Member.findOne({ guildId: 'g1', userId: 'a' }).lean();
    assert.equal(levelProgress(a.totalXp).level, 5, 'existing members keep their real level');
    assert.ok(await Member.exists({ guildId: 'g1', userId: 'newcomer' }), 'people who first chatted meanwhile are added');

    assert.deepEqual(raw.settings.voiceHubs.map(h => h.channelId), ['h1', 'h2'], 'hubs added meanwhile are merged');
    assert.equal(raw.settings.channels, undefined);
    assert.ok(await TempVoiceChannel.exists({ channelId: 'vc9' }));
});
