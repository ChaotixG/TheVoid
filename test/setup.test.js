const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuditLogEvent, ChannelType, Collection, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { inspectPanel } = require('./helpers');
const { sendSetupInvites } = require('../src/features/setup/invite');

function makeGuild({ botPermissions = PermissionsBitField.All, dmsOpen = ['owner', 'inviter'], inviterId = 'inviter' } = {}) {
    const dms = [];
    const posted = [];
    const auditLogCalls = [];
    const general = {
        id: 'general', name: 'general', type: ChannelType.GuildText, rawPosition: 0,
        permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.SendMessages]),
        send: async (payload) => posted.push(payload),
    };
    const guild = {
        id: 'g1', name: 'Test Guild', ownerId: 'owner',
        systemChannel: general,
        channels: { cache: new Collection([['general', general]]) },
        members: { me: { permissions: new PermissionsBitField(botPermissions) } },
        client: {
            user: { id: 'bot' },
            users: {
                fetch: async (id) => ({
                    id, bot: false,
                    send: async (payload) => {
                        if (!dmsOpen.includes(id)) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
                        dms.push({ id, payload });
                    },
                }),
            },
        },
        fetchAuditLogs: async (options) => {
            auditLogCalls.push(options);
            return { entries: new Collection([['e1', { targetId: 'bot', executorId: inviterId }]]) };
        },
    };
    return { guild, dms, posted, auditLogCalls };
}

test('the owner and whoever added the bot get a setup DM with a link into the server', async () => {
    const { guild, dms, posted, auditLogCalls } = makeGuild();
    await sendSetupInvites(guild);

    assert.deepEqual(dms.map(d => d.id).sort(), ['inviter', 'owner']);
    assert.equal(posted.length, 0, 'nothing posted in the server when DMs work');
    assert.equal(auditLogCalls[0].type, AuditLogEvent.BotAdd);

    const { json, count } = inspectPanel(dms[0].payload);
    assert.ok(count <= 40);
    const text = JSON.stringify(json);
    assert.match(text, /\/setup/);
    assert.match(text, /https:\/\/discord\.com\/channels\/g1\/general/);
});

test('when nobody can be DM\'d, the invite is posted in the server and pings them', async () => {
    const { guild, dms, posted } = makeGuild({ dmsOpen: [] });
    await sendSetupInvites(guild);

    assert.equal(dms.length, 0);
    assert.equal(posted.length, 1);
    assert.match(JSON.stringify(inspectPanel(posted[0]).json), /<@owner> <@inviter>, run \*\*\/setup\*\*/);
    assert.deepEqual(posted[0].allowedMentions, { users: ['owner', 'inviter'] });
});

test('without View Audit Log, only the owner is invited', async () => {
    const { guild, dms, auditLogCalls } = makeGuild({ botPermissions: [P.SendMessages, P.ViewChannel] });
    await sendSetupInvites(guild);
    assert.deepEqual(dms.map(d => d.id), ['owner']);
    assert.equal(auditLogCalls.length, 0);
});
