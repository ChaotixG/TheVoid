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
