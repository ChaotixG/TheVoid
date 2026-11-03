const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, Collection, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, fakeGuild, inspectPanel } = require('./helpers');
const { getGuildSettings, updateGuildSettings } = require('../src/services/guildSettings');
const { PAGES, WIZARD_STEPS, renderWizardStep } = require('../src/features/settings/pages');
const settings = require('../src/features/settings/handler');

before(startDatabase);
after(stopDatabase);
beforeEach(clearDatabase);

const channels = [
    { id: 'vc1', name: 'Lobby', type: ChannelType.GuildVoice },
    { id: 'vc2', name: 'Gaming', type: ChannelType.GuildVoice },
    { id: 'forum', name: 'tickets', type: ChannelType.GuildForum },
    { id: 'text', name: 'general', type: ChannelType.GuildText },
];
const roles = [{ id: 'staff', name: 'Staff', editable: true }, { id: 'vip', name: 'VIP', editable: true }, { id: 'top', name: 'Top', editable: false }];

let messageCounter = 0;

// Minimal stand-in for a command/component/modal interaction on the settings panel
function fakeInteraction({ guild, userId = 'admin', customId, message, values = [], selected = [], fields = {}, admin = true }) {
    const calls = { rendered: null, modal: null, deleted: false, replied: null, updated: null };
    const self = {
        guildId: guild.id,
        guild,
        user: { id: userId },
        customId,
        message,
        values,
        channels: new Collection(selected.map(c => [c.id, c])),
        memberPermissions: new PermissionsBitField(admin ? PermissionFlagsBits.Administrator : 0n),
        inGuild: () => true,
        deferReply: async () => {},
        deferUpdate: async () => {},
        editReply: async (payload) => { calls.rendered = payload; return message ?? { id: `msg${++messageCounter}` }; },
        update: async (payload) => { calls.updated = payload; },
        reply: async (payload) => { calls.replied = payload; },
        deleteReply: async () => { calls.deleted = true; },
        showModal: async (modal) => { calls.modal = modal; },
        fields: {
            getTextInputValue: (id) => fields[id],
            getSelectedRoles: () => new Collection([[fields.role, { id: fields.role }]]),
        },
    };
    return { interaction: self, calls };
}

test('every settings page fits Discord\'s limits (40 components, 4000 characters) in its fullest state', async () => {
    const guild = fakeGuild({ channels, roles });
    await updateGuildSettings('g1', { $set: {
        'settings.voiceHubs': [{ channelId: 'vc1', name: 'Lobby' }, { channelId: 'deleted', name: 'Gone' }],
        'settings.leveling.announce': 'channel',
        'settings.leveling.levelRoles': Array.from({ length: 25 }, (_, i) => ({ level: i + 1, roleId: `role${i}` })),
        'settings.leveling.noXpChannelIds': ['text'],
        'settings.staffRoleIds': ['staff', 'gone'],
        'settings.modRoleIds': ['vip'],
    } });
    const s = await getGuildSettings('g1', { fresh: true });

    const views = [
        ...Object.entries(PAGES).map(([name, render]) => [name, render(guild, s, 'A notice line')]),
        ...WIZARD_STEPS.map(step => [`setup:${step}`, renderWizardStep(step, guild, s, 'A notice line')]),
    ];
    for (const [name, view] of views) {
        const { count, textLength } = inspectPanel({ components: [view] });
        assert.ok(count <= 40, `${name} page has ${count} components`);
        assert.ok(textLength <= 4000, `${name} page has ${textLength} characters`);
    }

    // Deleted channels are not offered as pre-selected values
    const voice = inspectPanel({ components: [PAGES.voice(guild, s)] }).json;
    const hubSelect = JSON.stringify(voice).match(/"custom_id":"settings:voice:hubs"[^}]*"default_values":\[([^\]]*)\]/);
    assert.ok(hubSelect && !hubSelect[1].includes('deleted') && hubSelect[1].includes('vc1'));
});

test('opening /settings again closes the previous panel; clicks on it are refused', async () => {
    const guild = fakeGuild({ channels, roles });
    const first = fakeInteraction({ guild });
    await settings.openPanel(first.interaction);
    const firstMessage = { id: 'msg' + messageCounter };

    const second = fakeInteraction({ guild });
    await settings.openPanel(second.interaction);
    assert.equal(first.calls.deleted, true, 'old panel deleted when the new one opens');

    const stale = fakeInteraction({ guild, customId: 'settings:nav:voice', message: firstMessage });
    await settings.handleInteraction(null, stale.interaction);
    assert.match(JSON.stringify(stale.calls.updated), /replaced by a newer one/);

    // Another admin's panel in the same server is unaffected
    const other = fakeInteraction({ guild, userId: 'admin2' });
    await settings.openPanel(other.interaction);
    assert.equal(second.calls.deleted, false);
});

test('picking hubs, ticket targets and staff role saves them', async () => {
    const guild = fakeGuild({ channels, roles });
    const open = fakeInteraction({ guild });
    await settings.openPanel(open.interaction);
    const message = { id: 'msg' + messageCounter };

    const click = (opts) => settings.handleInteraction(null, fakeInteraction({ guild, message, ...opts }).interaction);
    await click({ customId: 'settings:voice:hubs', values: ['vc1', 'vc2'], selected: [channels[0], channels[1]] });
    await click({ customId: 'settings:tickets:target:suggestions', values: ['forum'], selected: [channels[2]] });
    await click({ customId: 'settings:server:staff', values: ['staff', 'g1'] }); // @everyone is ignored
    await click({ customId: 'settings:server:mods', values: ['vip'] });
    await click({ customId: 'settings:tickets:target:complaints', values: [], selected: [] }); // cleared

    const s = await getGuildSettings('g1', { fresh: true });
    assert.deepEqual(s.voiceHubs, [{ channelId: 'vc1', name: 'Lobby' }, { channelId: 'vc2', name: 'Gaming' }]);
    assert.deepEqual(s.tickets.suggestions, { channelId: 'forum', type: 'forum' });
    assert.deepEqual(s.tickets.complaints, { channelId: null, type: null });
    assert.deepEqual(s.staffRoleIds, ['staff']);
    assert.deepEqual(s.modRoleIds, ['vip']);
});

test('forms validate input and level roles stay one-per-level', async () => {
    const guild = fakeGuild({ channels, roles });
    const open = fakeInteraction({ guild });
    await settings.openPanel(open.interaction);
    const message = { id: 'msg' + messageCounter };
    const submit = async (customId, fields) => {
        const i = fakeInteraction({ guild, message, customId, fields });
        await settings.handleInteraction(null, i.interaction);
        return JSON.stringify(i.calls.rendered);
    };

    // The Edit button opens a pre-filled form instead of saving anything
    const button = fakeInteraction({ guild, message, customId: 'settings:lvl:rate' });
    await settings.handleInteraction(null, button.interaction);
    assert.equal(button.calls.modal.data.custom_id, 'settings:lvl:ratemodal');

    assert.match(await submit('settings:lvl:ratemodal', { min: '50', max: '10', cooldown: '30' }), /can't be more than the maximum/);
    assert.match(await submit('settings:lvl:ratemodal', { min: '5', max: '15', cooldown: '30' }), /5–15 XP/);

    assert.match(await submit('settings:lvl:addrolemodal', { level: '5', role: 'top' }), /above my highest role/);
    await submit('settings:lvl:addrolemodal', { level: '5', role: 'vip' });
    await submit('settings:lvl:addrolemodal', { level: '10', role: 'vip' }); // moves VIP to level 10
    await submit('settings:lvl:addrolemodal', { level: '2', role: 'staff' });

    let s = await getGuildSettings('g1', { fresh: true });
    assert.deepEqual(s.leveling.levelRoles, [{ level: 2, roleId: 'staff' }, { level: 10, roleId: 'vip' }]);
    assert.equal(s.leveling.xpMin, 5);

    const remove = fakeInteraction({ guild, message, customId: 'settings:lvl:removerole', values: ['2'] });
    await settings.handleInteraction(null, remove.interaction);
    s = await getGuildSettings('g1', { fresh: true });
    assert.deepEqual(s.leveling.levelRoles, [{ level: 10, roleId: 'vip' }]);
});

test('toggles set the value that was clicked, so double-clicks are harmless', async () => {
    const guild = fakeGuild({ channels, roles });
    const open = fakeInteraction({ guild });
    await settings.openPanel(open.interaction);
    const message = { id: 'msg' + messageCounter };
    for (let i = 0; i < 2; i++) {
        await settings.handleInteraction(null, fakeInteraction({ guild, message, customId: 'settings:lvl:enabled:off' }).interaction);
    }
    assert.equal((await getGuildSettings('g1', { fresh: true })).leveling.enabled, false);
});

test('non-admins can\'t change settings', async () => {
    const guild = fakeGuild({ channels, roles });
    const i = fakeInteraction({ guild, customId: 'settings:lvl:enabled:off', admin: false });
    await settings.handleInteraction(null, i.interaction);
    assert.match(i.calls.replied.content, /Administrator/);
    assert.equal((await getGuildSettings('g1', { fresh: true })).leveling.enabled, true);
});

test('two admins adding level roles at once can\'t go over 25', async () => {
    const guild = fakeGuild({ channels, roles: [...roles, { id: 'a', editable: true }, { id: 'b', editable: true }] });
    await updateGuildSettings('g1', { $set: { 'settings.leveling.levelRoles': Array.from({ length: 24 }, (_, i) => ({ level: i + 100, roleId: `r${i}` })) } });
    const open = fakeInteraction({ guild });
    await settings.openPanel(open.interaction);
    const message = { id: 'msg' + messageCounter };
    const add = (level, role) => settings.handleInteraction(null, fakeInteraction({ guild, message, customId: 'settings:lvl:addrolemodal', fields: { level, role } }).interaction);

    await Promise.all([add('1', 'a'), add('2', 'b')]);
    assert.equal((await getGuildSettings('g1', { fresh: true })).leveling.levelRoles.length, 25);
});

test('/setup walks through the steps and keeps its place while settings change', async () => {
    const guild = fakeGuild({ channels, roles });
    const open = fakeInteraction({ guild });
    await settings.openPanel(open.interaction, { wizard: true });
    assert.match(JSON.stringify(open.calls.rendered), /Server setup/);
    const message = { id: 'msg' + messageCounter };

    const click = async (opts) => {
        const i = fakeInteraction({ guild, message, ...opts });
        await settings.handleInteraction(null, i.interaction);
        return JSON.stringify(i.calls.rendered);
    };

    let view = await click({ customId: 'settings:wiz:server' });
    assert.match(view, /step 1 of 5/);
    view = await click({ customId: 'settings:server:staff', values: ['staff'] });
    assert.match(view, /step 1 of 5/, 'a change keeps you on the same step');
    assert.match(view, /Staff roles: <@&staff>/);

    for (const [step, number] of [['logs', 2], ['tickets', 3], ['voice', 4], ['leveling', 5]]) {
        assert.match(await click({ customId: `settings:wiz:${step}` }), new RegExp(`step ${number} of 5`));
    }
    // A form submitted from the leveling step re-renders that step
    assert.match(await click({ customId: 'settings:lvl:ratemodal', fields: { min: '5', max: '15', cooldown: '30' } }), /step 5 of 5/);

    view = await click({ customId: 'settings:wiz:done' });
    assert.match(view, /Setup complete/);
    assert.match(view, /Staff: <@&staff>/);

    // "Open settings" leaves the wizard
    assert.match(await click({ customId: 'settings:nav:home' }), /⚙️ Settings/);
    assert.doesNotMatch(await click({ customId: 'settings:lvl:enabled:off' }), /step d of 5/);
});
