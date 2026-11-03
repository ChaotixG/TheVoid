const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase } = require('./helpers');
const Member = require('../src/models/Member');
const Server = require('../src/models/Server');
const TempVoiceChannel = require('../src/models/TempVoiceChannel');
const daily = require('../src/commands/economy/daily');
const { markGuildLeft, markGuildJoined, syncGuilds, purgeDepartedGuilds } = require('../src/database/guildLifecycle');

before(startDatabase);
after(stopDatabase);
beforeEach(clearDatabase);

function fakeCommand(userId = 'u1') {
    const replies = [];
    return { replies, interaction: {
        guildId: 'g1', user: { id: userId },
        deferReply: async () => {}, deleteReply: async () => {},
        editReply: async (p) => replies.push(p), followUp: async (p) => replies.push(p),
    } };
}
const noGuilds = { guilds: { cache: new Collection() } };

test('/daily pays once per 24 hours, even when spammed', async () => {
    const runs = Array.from({ length: 5 }, () => fakeCommand());
    await Promise.all(runs.map(r => daily.callback(null, r.interaction)));

    const member = await Member.findOne({ userId: 'u1' }).lean();
    assert.equal(member.balance, 100);
    const paid = runs.filter(r => typeof r.replies[0] === 'string').length;
    assert.equal(paid, 1);
    assert.match(runs.find(r => typeof r.replies[0] !== 'string').replies[0].content, /Come back <t:\d+:R>/);

    // A day later it works again
    await Member.updateOne({ userId: 'u1' }, { $set: { lastDaily: new Date(Date.now() - 25 * 3600_000) } });
    await daily.callback(null, fakeCommand().interaction);
    assert.equal((await Member.findOne({ userId: 'u1' }).lean()).balance, 200);
});

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
