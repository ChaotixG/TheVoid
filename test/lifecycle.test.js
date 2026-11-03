const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase } = require('./helpers');
const Member = require('../src/models/Member');
const Server = require('../src/models/Server');
const TempVoiceChannel = require('../src/models/TempVoiceChannel');
const { markGuildLeft, markGuildJoined, syncGuilds, purgeDepartedGuilds } = require('../src/database/guildLifecycle');

before(startDatabase);
after(stopDatabase);
beforeEach(clearDatabase);

const noGuilds = { guilds: { cache: new Collection() } };

test('leaving a server keeps its data for 30 days; re-joining cancels the deletion', async () => {
    await Member.create({ guildId: 'g1', userId: 'u1', totalXp: 500 });
    await markGuildJoined('g1');
    await markGuildLeft('g1');
    await purgeDepartedGuilds(noGuilds);
    assert.equal(await Member.countDocuments(), 1, 'kept right after leaving');

    await markGuildJoined('g1');
    assert.equal((await Server.findOne({ guildId: 'g1' }).lean()).leftAt, null);

    await Server.updateOne({ guildId: 'g1' }, { $set: { leftAt: new Date(Date.now() - 31 * 24 * 3600_000) } });
    await TempVoiceChannel.create({ guildId: 'g1', channelId: 'vc' });

    // Still in the server (stale flag): never purged
    await purgeDepartedGuilds({ guilds: { cache: new Collection([['g1', {}]]) } });
    assert.equal(await Member.countDocuments(), 1);

    await purgeDepartedGuilds(noGuilds);
    assert.equal(await Member.countDocuments(), 0);
    assert.equal(await Server.countDocuments(), 0);
    assert.equal(await TempVoiceChannel.countDocuments(), 0);
});

test('startup sync marks servers left while offline and rejoined ones', async () => {
    await Server.create([{ guildId: 'stillIn', leftAt: new Date() }, { guildId: 'gone' }]);
    await syncGuilds({ guilds: { cache: new Collection([['stillIn', {}], ['new', {}]]) } });

    const docs = Object.fromEntries((await Server.find().lean()).map(d => [d.guildId, d.leftAt]));
    assert.equal(docs.stillIn, null);
    assert.equal(docs.new, null);
    assert.ok(docs.gone instanceof Date);
});

test('a dev bot never marks other servers as left', async () => {
    process.env.DEV_GUILD_ID = 'devServer';
    try {
        await Server.create({ guildId: 'production' });
        await syncGuilds({ guilds: { cache: new Collection([['devServer', {}]]) } });
        await markGuildLeft('production');
        assert.equal((await Server.findOne({ guildId: 'production' }).lean()).leftAt, null);
    } finally {
        delete process.env.DEV_GUILD_ID;
    }
});
