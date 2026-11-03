const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, fakeGuild } = require('./helpers');
const Member = require('../src/models/Member');
const { updateGuildSettings } = require('../src/services/guildSettings');
const { totalXpForLevel } = require('../src/utils/leveling');

before(startDatabase);
after(stopDatabase);
beforeEach(clearDatabase);

// grantMessageXp keeps cooldowns in memory, so load a fresh copy when a test needs a clean slate
function freshXp() {
    delete require.cache[require.resolve('../src/features/leveling/xp')];
    return require('../src/features/leveling/xp');
}

function fakeMessage({ userId = 'u1', channelId = 'c1', parentId = null, guild = fakeGuild(), memberRoles = [] } = {}) {
    const replies = [];
    const sent = [];
    const roles = new Collection(memberRoles.map(id => [id, { id }]));
    const added = [];
    const member = {
        id: userId,
        guild,
        roles: {
            cache: roles,
            add: async (ids) => { added.push(...ids); ids.forEach(id => roles.set(id, { id })); },
            remove: async (ids) => ids.forEach(id => roles.delete(id)),
        },
    };
    guild.channels.cache.set('levels', { id: 'levels', isTextBased: () => true, send: async (p) => sent.push(p) });
    return {
        message: {
            guildId: guild.id,
            guild,
            member,
            author: { id: userId },
            channel: { id: channelId, parentId, parent: null },
            reply: async (p) => replies.push(p),
        },
        replies,
        sent,
        added,
    };
}

test('a member just under the threshold levels up exactly once', async () => {
    await Member.create({ guildId: 'g1', userId: 'u1', totalXp: 95 });
    const { message, replies } = fakeMessage();
    for (let i = 0; i < 5; i++) await freshXp().grantMessageXp(message);

    const member = await Member.findOne({ userId: 'u1' }).lean();
    assert.ok(member.totalXp >= 95 + 5 * 10);
    assert.equal(replies.length, 1);
    assert.match(replies[0].embeds[0].data.description, /level 2/);
});

test('the cooldown allows one XP gain per member', async () => {
    const { grantMessageXp } = freshXp();
    const { message } = fakeMessage();
    await Promise.all([grantMessageXp(message), grantMessageXp(message), grantMessageXp(message)]);
    const member = await Member.findOne({ userId: 'u1' }).lean();
    assert.ok(member.totalXp >= 10 && member.totalXp <= 35);
});

test('the same user is tracked separately in two servers', async () => {
    const { grantMessageXp } = freshXp();
    await grantMessageXp(fakeMessage({ guild: fakeGuild({ id: 'g1' }) }).message);
    await grantMessageXp(fakeMessage({ guild: fakeGuild({ id: 'g2' }) }).message);
    assert.equal(await Member.countDocuments({ userId: 'u1' }), 2);
});

test('no XP when leveling is off, or in a no-XP channel or its threads', async () => {
    await updateGuildSettings('g1', { $set: { 'settings.leveling.noXpChannelIds': ['quiet'] } });
    await freshXp().grantMessageXp(fakeMessage({ channelId: 'quiet' }).message);
    await freshXp().grantMessageXp(fakeMessage({ channelId: 'thread1', parentId: 'quiet' }).message);
    assert.equal(await Member.countDocuments(), 0);

    await updateGuildSettings('g1', { $set: { 'settings.leveling.enabled': false, 'settings.leveling.noXpChannelIds': [] } });
    await freshXp().grantMessageXp(fakeMessage().message);
    assert.equal(await Member.countDocuments(), 0);
});

test('level-ups go to the configured channel and award level roles', async () => {
    const guild = fakeGuild({ roles: [
        { id: 'r2', name: 'Level 2', editable: true },
        { id: 'r9', name: 'Level 9', editable: true },
        { id: 'high', name: 'Above bot', editable: false },
    ] });
    await updateGuildSettings('g1', { $set: {
        'settings.leveling.announce': 'channel',
        'settings.leveling.announceChannelId': 'levels',
        'settings.leveling.levelRoles': [{ level: 2, roleId: 'r2' }, { level: 2, roleId: 'high' }, { level: 9, roleId: 'r9' }],
    } });
    await Member.create({ guildId: 'g1', userId: 'u1', totalXp: totalXpForLevel(2) - 1 });

    const { message, replies, sent, added } = fakeMessage({ guild });
    await freshXp().grantMessageXp(message);

    assert.equal(replies.length, 0);
    assert.equal(sent.length, 1);
    assert.deepEqual(added, ['r2'], 'only earned roles the bot can manage');
    assert.match(sent[0].embeds[0].data.description, /New role: <@&r2>/);
});

test('with "keep lower roles" off, the previous level role is removed', async () => {
    const guild = fakeGuild({ roles: [{ id: 'r2', editable: true }, { id: 'r3', editable: true }] });
    await updateGuildSettings('g1', { $set: {
        'settings.leveling.keepLowerRoles': false,
        'settings.leveling.announce': 'off',
        'settings.leveling.levelRoles': [{ level: 2, roleId: 'r2' }, { level: 3, roleId: 'r3' }],
    } });
    await Member.create({ guildId: 'g1', userId: 'u1', totalXp: totalXpForLevel(3) - 1 });

    const { message, replies } = fakeMessage({ guild, memberRoles: ['r2'] });
    await freshXp().grantMessageXp(message);

    assert.deepEqual([...message.member.roles.cache.keys()], ['r3']);
    assert.equal(replies.length, 0, 'announcements are off');
});
