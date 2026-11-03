const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, Collection, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase } = require('./helpers');
const TempVoiceChannel = require('../src/models/TempVoiceChannel');
const { updateGuildSettings } = require('../src/services/guildSettings');

before(startDatabase);
after(stopDatabase);
beforeEach(clearDatabase);

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const GRACE = 5_500; // a little over the 5s empty-channel grace period

// Fresh module per test so in-memory tracking doesn't leak between tests
function load() {
    for (const m of ['../src/features/voice/hubs', '../src/features/voice/panel']) delete require.cache[require.resolve(m)];
    return { hubs: require('../src/features/voice/hubs'), panel: require('../src/features/voice/panel') };
}

// A small in-memory guild that behaves like discord.js for the parts the voice code uses
function makeWorld({ botPermissions = PermissionsBitField.All } = {}) {
    let nextId = 1;
    const created = [];
    const guild = {
        id: 'g1', available: true, ownerId: 'owner',
        roles: { cache: new Collection([['g1', { id: 'g1', name: '@everyone' }]]) },
        members: { me: { id: 'bot', permissions: new PermissionsBitField(botPermissions) } },
        channels: { cache: new Collection() },
    };
    const makeChannel = (opts) => {
        const ch = {
            id: opts.id ?? `vc${nextId++}`, name: opts.name, type: ChannelType.GuildVoice, guild, userLimit: 0,
            members: new Collection(), failDelete: false,
            permissionOverwrites: {
                cache: new Map(),
                set: async (list) => { ch.permissionOverwrites.cache = new Map(list.map(o => [o.id, { ...o, deny: new PermissionsBitField(o.deny) }])); },
            },
            messages: { edit: async () => {} },
            send: async () => ({ id: `panel-${ch.id}` }),
            delete: async () => {
                if (ch.failDelete) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
                guild.channels.cache.delete(ch.id);
            },
        };
        if (opts.permissionOverwrites) ch.permissionOverwrites.set(opts.permissionOverwrites);
        guild.channels.cache.set(ch.id, ch);
        return ch;
    };
    guild.channels.create = async (opts) => { created.push(opts); return makeChannel(opts); };
    return { guild, makeChannel, created };
}

function makeMember(world, hubs, id) {
    const member = {
        id, displayName: `User ${id}`, user: { id, bot: false, tag: `user${id}` }, guild: world.guild,
        roles: { cache: new Collection() },
        voice: { channelId: null, setChannel: (ch) => move(world, hubs, member, ch) },
    };
    return member;
}

async function move(world, hubs, member, to) {
    const from = world.guild.channels.cache.get(member.voice.channelId);
    from?.members.delete(member.id);
    to?.members.set(member.id, member);
    member.voice.channelId = to?.id ?? null;
    const state = (ch) => ({ guild: world.guild, member, channelId: ch?.id ?? null, channel: ch ?? null });
    await hubs.handleVoiceStateUpdate(state(from), state(to));
}

async function setupHub() {
    await updateGuildSettings('g1', { $set: { 'settings.voiceHubs': [{ channelId: 'hub', name: 'Join to create' }] } });
}

test('joining a hub creates one channel (even on a double event), moves the member and gives the bot its own access', async () => {
    const { hubs } = load();
    const world = makeWorld();
    await setupHub();
    const hub = world.makeChannel({ id: 'hub', name: 'Join to create' });
    const alice = makeMember(world, hubs, 'a');

    await Promise.all([
        move(world, hubs, alice, hub),
        hubs.handleVoiceStateUpdate({ guild: world.guild, member: alice, channelId: null, channel: null }, { guild: world.guild, member: alice, channelId: 'hub', channel: hub }),
    ]);

    assert.equal(world.created.length, 1);
    const temp = world.guild.channels.cache.find(c => c.id !== 'hub');
    assert.ok(temp.members.has('a'));
    const record = await TempVoiceChannel.findOne({ channelId: temp.id }).lean();
    assert.equal(record.ownerId, 'a');
    assert.equal(record.panelMessageId, `panel-${temp.id}`);

    const botOverwrite = world.created[0].permissionOverwrites.find(o => o.id === 'bot');
    for (const perm of [P.ManageChannels, P.MoveMembers, P.Connect, P.ViewChannel]) assert.ok(botOverwrite.allow.includes(perm));

    // Mute/deafen style update (same channel) does nothing
    await hubs.handleVoiceStateUpdate({ guild: world.guild, member: alice, channelId: temp.id, channel: temp }, { guild: world.guild, member: alice, channelId: temp.id, channel: temp });
    assert.equal(world.created.length, 1);
});

test('every moderator role gets moderator powers in temp channels; the old "mod" role is the fallback', async () => {
    const { hubs } = load();
    const world = makeWorld();
    world.guild.roles.cache.set('m1', { id: 'm1', name: 'Mods' });
    world.guild.roles.cache.set('m2', { id: 'm2', name: 'Helpers' });
    world.guild.roles.cache.set('old', { id: 'old', name: 'mod' });
    await setupHub();
    const hub = world.makeChannel({ id: 'hub', name: 'Join to create' });

    await move(world, hubs, makeMember(world, hubs, 'a'), hub);
    assert.deepEqual(world.created[0].permissionOverwrites.filter(o => o.allow.includes(P.MuteMembers) && o.type === 0).map(o => o.id), ['old']);

    await updateGuildSettings('g1', { $set: { 'settings.modRoleIds': ['m1', 'm2', 'deleted'] } });
    await move(world, hubs, makeMember(world, hubs, 'b'), hub);
    assert.deepEqual(world.created[1].permissionOverwrites.filter(o => o.allow.includes(P.MuteMembers) && o.type === 0).map(o => o.id), ['m1', 'm2']);
});

test('overwrites only use permissions the bot has (Discord rejects the rest)', async () => {
    const { hubs } = load();
    const world = makeWorld({ botPermissions: [P.ManageChannels, P.MoveMembers, P.ManageRoles, P.ViewChannel, P.Connect, P.SendMessages] });
    await setupHub();
    const hub = world.makeChannel({ id: 'hub', name: 'Join to create' });
    await move(world, hubs, makeMember(world, hubs, 'a'), hub);

    const allowed = new Set([P.ManageChannels, P.MoveMembers, P.ManageRoles, P.ViewChannel, P.Connect, P.SendMessages]);
    for (const overwrite of world.created[0].permissionOverwrites) {
        for (const perm of [...overwrite.allow, ...overwrite.deny]) assert.ok(allowed.has(perm), `overwrite ${overwrite.id} uses a permission the bot lacks`);
    }
});

test('claim, lock and transfer from the control panel; deleted once empty', async () => {
    const { hubs, panel } = load();
    const world = makeWorld();
    await setupHub();
    const hub = world.makeChannel({ id: 'hub', name: 'Join to create' });
    const alice = makeMember(world, hubs, 'a');
    const bob = makeMember(world, hubs, 'b');
    await move(world, hubs, alice, hub);
    const temp = world.guild.channels.cache.find(c => c.id !== 'hub');

    const click = async (customId, user, extra = {}) => {
        const out = {};
        await panel.handleInteraction(null, {
            customId, channel: temp, guildId: 'g1', guild: world.guild, user: user.user, member: user,
            memberPermissions: new PermissionsBitField(0n), values: [], users: new Collection(),
            reply: async (p) => { out.reply = p.content; }, deferUpdate: async () => {},
            editReply: async (p) => { out.edit = p.content ?? 'panel'; }, followUp: async (p) => { out.follow = p.content; },
            showModal: async (m) => { out.modal = m.data.custom_id; }, ...extra,
        });
        return out;
    };

    await move(world, hubs, bob, temp);
    assert.match((await click('vc:lock', bob)).reply, /Only <@a> can change this channel/);
    assert.match((await click('vc:claim', bob)).reply, /still here/);

    await move(world, hubs, alice, null);
    assert.equal((await click('vc:claim', bob)).edit, 'panel');
    assert.equal((await TempVoiceChannel.findOne({ channelId: temp.id }).lean()).ownerId, 'b');

    assert.equal((await click('vc:rename', bob)).modal, 'vc:renamemodal');
    await click('vc:lock', bob);
    assert.equal(hubs.isLocked(temp), true);

    await move(world, hubs, alice, temp);
    await click('vc:transferselect', bob, { values: ['a'], users: new Collection([['a', alice.user]]) });
    assert.equal((await TempVoiceChannel.findOne({ channelId: temp.id }).lean()).ownerId, 'a');

    await move(world, hubs, alice, null);
    await move(world, hubs, bob, null);
    await sleep(GRACE);
    assert.equal(world.guild.channels.cache.has(temp.id), false);
    assert.equal(await TempVoiceChannel.countDocuments(), 0);
});

test('a channel that can\'t be deleted is retried later and doesn\'t block startup cleanup of others', async () => {
    const { hubs } = load();
    const world = makeWorld();
    const stuck = world.makeChannel({ id: 'stuck', name: 'Stuck' });
    stuck.failDelete = true;
    world.makeChannel({ id: 'empty', name: 'Empty' });
    const busy = world.makeChannel({ id: 'busy', name: 'Busy' });
    busy.members.set('x', {});
    await TempVoiceChannel.create(['stuck', 'empty', 'busy', 'vanished'].map(channelId => ({ guildId: 'g1', channelId })));

    await hubs.rehydrate({ guilds: { cache: new Collection([['g1', world.guild]]) } });
    const remaining = (await TempVoiceChannel.find().lean()).map(d => d.channelId).sort();
    assert.deepEqual(remaining, ['busy', 'stuck'], 'stuck is kept for a retry; the others were handled');

    // Once the bot can delete it again, the next empty check removes it
    stuck.failDelete = false;
    await hubs.handleVoiceStateUpdate({ guild: world.guild, channelId: 'stuck', channel: stuck }, { guild: world.guild, channelId: null, channel: null, member: null });
    await sleep(GRACE);
    assert.equal(world.guild.channels.cache.has('stuck'), false);
});
