const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelFlagsBitField, ChannelFlags, ChannelType, Collection, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { TicketError, createTicket, deleteTicket } = require('../src/features/tickets/tickets');
const { TICKET_TYPES } = require('../src/features/tickets/types');

const user = { id: '111111111111111111', tag: 'member' };
const values = { title: 'Broken thing', description: 'It broke' };

function makeGuild() {
    return {
        id: 'g1',
        roles: { cache: new Collection() },
        members: { me: { id: 'bot', permissions: new PermissionsBitField(PermissionsBitField.All) } },
        channels: { cache: new Collection() },
    };
}

function makeForum(guild, { id = 'forum', tags = [], requireTag = false, botCanManageThreads = true } = {}) {
    const posts = [];
    const forum = {
        id, type: ChannelType.GuildForum, guild,
        availableTags: tags,
        flags: new ChannelFlagsBitField(requireTag ? ChannelFlags.RequireTag : 0),
        permissionsFor: () => new PermissionsBitField(botCanManageThreads ? PermissionFlagsBits.ManageThreads : 0n),
        threads: { create: async (options) => { posts.push(options); return { id: `post${posts.length}`, name: options.name }; } },
        isTextBased: () => false,
        posts,
    };
    guild.channels.cache.set(id, forum);
    return forum;
}

const ticket = (guild, typeKey, channelId) => createTicket({
    guild, user, type: TICKET_TYPES[typeKey], values, target: { channelId }, staffRoleIds: [],
});

test('forum tickets get the tag matching their type', async () => {
    const guild = makeGuild();
    const forum = makeForum(guild, { tags: [
        { id: 't-support', name: '🛠️ Support' },
        { id: 't-idea', name: 'Suggestions' },
        { id: 't-bug', name: 'Bug report' },
    ] });

    await ticket(guild, 'troubleshooting', 'forum');
    await ticket(guild, 'suggestion', 'forum');
    await ticket(guild, 'issue', 'forum');

    assert.deepEqual(forum.posts.map(p => p.appliedTags), [['t-support'], ['t-idea'], ['t-bug']]);
    assert.equal(forum.posts[0].name, 'Broken thing');
    assert.match(forum.posts[0].message.content, /^<@111111111111111111>/);
});

test('a forum that requires tags still works when no tag name matches', async () => {
    const guild = makeGuild();
    const forum = makeForum(guild, { requireTag: true, botCanManageThreads: false, tags: [
        { id: 't-staff', name: 'Staff only', moderated: true },
        { id: 't-open', name: 'Open' },
    ] });

    await ticket(guild, 'suggestion', 'forum');
    assert.deepEqual(forum.posts[0].appliedTags, ['t-open'], 'first tag the bot may use (moderated tags need Manage Threads)');
});

test('no tag is forced when the forum doesn\'t require one', async () => {
    const guild = makeGuild();
    const forum = makeForum(guild, { tags: [{ id: 't-open', name: 'Open' }] });
    await ticket(guild, 'suggestion', 'forum');
    assert.deepEqual(forum.posts[0].appliedTags, []);
});

test('a clear message when a forum requires tags the bot can\'t use', async () => {
    const guild = makeGuild();
    makeForum(guild, { requireTag: true, botCanManageThreads: false, tags: [{ id: 't-staff', name: 'Staff only', moderated: true }] });
    await assert.rejects(ticket(guild, 'suggestion', 'forum'), (err) => err instanceof TicketError && /requires a tag/.test(err.message));
});

test('transcripts can go to a forum, one post per deleted ticket', async () => {
    const guild = makeGuild();
    const forum = makeForum(guild, { id: 'transcripts', requireTag: true, tags: [{ id: 't-misc', name: 'Misc' }, { id: 't-closed', name: 'Closed' }] });
    let deleted = false;
    const message = { content: '<@111111111111111111>', embeds: [], attachments: new Collection(), author: { tag: 'bot' }, createdAt: new Date(), createdTimestamp: 1, id: 'm1' };
    const thread = {
        id: 't1', name: 'Broken thing', guild, parent: { name: 'support' }, createdAt: new Date(),
        messages: { fetch: async () => new Collection([['m1', message]]) },
        delete: async () => { deleted = true; },
    };

    await deleteTicket(thread, { id: 'mod', tag: 'mod' }, { transcriptChannelId: 'transcripts', creatorId: user.id });

    assert.equal(deleted, true);
    assert.equal(forum.posts.length, 1);
    assert.equal(forum.posts[0].name, 'Transcript: Broken thing');
    assert.deepEqual(forum.posts[0].appliedTags, ['t-closed']);
    assert.equal(forum.posts[0].message.files[0].name, 'transcript-t1.txt');
});

test('text channels still get a private thread', async () => {
    const guild = makeGuild();
    const sent = [];
    const thread = { id: 'th1', send: async (p) => sent.push(p), members: { add: async () => {} } };
    let createOptions;
    guild.channels.cache.set('text', { id: 'text', type: ChannelType.GuildText, threads: { create: async (o) => { createOptions = o; return thread; } } });

    const created = await ticket(guild, 'troubleshooting', 'text');
    assert.equal(created, thread);
    assert.equal(createOptions.type, ChannelType.PrivateThread);
    assert.equal(sent.length, 1);
});
