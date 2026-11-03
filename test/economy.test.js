const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, Collection, PermissionsBitField } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, fakeGuild } = require('./helpers');

// Card themes ship switched off until their colors are approved; turn them on here to test the
// shop logic (the off switch itself is tested at the end)
const economyConfig = require('../src/config/economy');
economyConfig.CARD_THEMES_ENABLED = true;

const Member = require('../src/models/Member');
const Wallet = require('../src/models/Wallet');
const Transaction = require('../src/models/Transaction');
const RolePurchase = require('../src/models/RolePurchase');
const { runMigrations } = require('../src/database/migrations');
const { getGuildSettings, updateGuildSettings } = require('../src/services/guildSettings');
const { forgetPremium } = require('../src/services/premium');
const { claimDaily } = require('../src/features/economy/rewards');
const { isActiveInVoice, payVoiceActivity } = require('../src/features/economy/voiceActivity');
const { renderLeaderboard } = require('../src/features/leveling/leaderboard');
const shop = require('../src/features/economy/shop');
const settings = require('../src/features/settings/handler');
const daily = require('../src/commands/economy/daily');
const pay = require('../src/commands/economy/pay');

before(startDatabase);
after(stopDatabase);
beforeEach(async () => {
    await clearDatabase();
    delete process.env.PREMIUM_GUILD_ID;
    delete process.env.PREMIUM_ROLE_IDS;
    for (const id of ['u1', 'u2', 'u3']) forgetPremium(id);
});

const HOUR = 3600_000;
const noClient = { guilds: { cache: new Collection() } };
const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;

// A client whose premium server gives `premiumUserIds` the premium role
function premiumClient(premiumUserIds) {
    process.env.PREMIUM_GUILD_ID = 'home';
    process.env.PREMIUM_ROLE_IDS = 'supporter';
    const members = new Collection(premiumUserIds.map(id => [id, { roles: { cache: new Collection([['supporter', {}]]) } }]));
    return { guilds: { cache: new Collection([['home', { members: { cache: members, fetch: async () => null } }]]) } };
}

function fakeCommand({ userId = 'u1', guildId = 'g1', options = {} } = {}) {
    const out = [];
    return {
        out,
        interaction: {
            user: { id: userId }, guildId,
            options: { getUser: (name) => options[name], getInteger: (name) => options[name] },
            deferReply: async () => {}, deleteReply: async () => {},
            editReply: async (p) => out.push(typeof p === 'string' ? p : p.content),
            followUp: async (p) => out.push(p.content),
            reply: async (p) => out.push(p.content),
        },
    };
}

test('per-server balances are added into one global wallet, exactly once', async () => {
    const day = (n) => new Date(Date.UTC(2026, 10, n));
    await Member.collection.insertMany([
        { guildId: 'g1', userId: 'u1', totalXp: 10, balance: 50, lastDaily: day(1) },
        { guildId: 'g2', userId: 'u1', totalXp: 10, balance: 30, lastDaily: day(2) },
        { guildId: 'g1', userId: 'u2', totalXp: 10, balance: 0, lastDaily: day(3) },
    ]);
    await runMigrations();
    await runMigrations(); // safe to run again

    const u1 = await Wallet.findOne({ userId: 'u1' }).lean();
    assert.equal(u1.balance, 80);
    assert.deepEqual(u1.lastDaily, day(2), 'latest claim carries over, so nobody claims twice today');
    assert.equal(await balanceOf('u2'), 0);
    assert.equal(await Member.countDocuments({ balance: { $exists: true } }), 0);
});

test('/daily pays once per 24 hours across all servers, and streaks grow then reset', async () => {
    const runs = ['g1', 'g2', 'g3', 'g1', 'g2'].map(guildId => fakeCommand({ guildId }));
    await Promise.all(runs.map(r => daily.callback(noClient, r.interaction)));
    assert.equal(runs.filter(r => r.out[0].startsWith('💰')).length, 1);
    assert.match(runs.find(r => r.out[0].startsWith('⏳')).out[0], /Come back <t:\d+:R>/);
    assert.equal(await balanceOf('u1'), 200);

    await Wallet.updateOne({ userId: 'u1' }, { $set: { lastDaily: new Date(Date.now() - 25 * HOUR) } });
    assert.equal((await claimDaily(noClient, 'u1', 'g1')).amount, 220, 'day 2 of the streak: +20');

    await Wallet.updateOne({ userId: 'u1' }, { $set: { lastDaily: new Date(Date.now() - 49 * HOUR) } });
    const reset = await claimDaily(noClient, 'u1', 'g1');
    assert.equal(reset.amount, 200, 'missed more than 48 hours: streak starts over');
    assert.equal(reset.wallet.dailyStreak, 1);
    assert.equal(await Transaction.countDocuments({ userId: 'u1', type: 'daily' }), 3);
});

test('premium comes only from the owner\'s server role and doubles /daily', async () => {
    const client = premiumClient(['u1']);
    assert.equal((await claimDaily(client, 'u1', 'g1')).amount, 400);
    assert.equal((await claimDaily(client, 'u2', 'g1')).amount, 200);
});

test('/pay moves coins minus tax and can never overdraw, even when spammed', async () => {
    await Wallet.create({ userId: 'u1', balance: 100 });
    const target = { id: 'u2', bot: false };
    const runs = [1, 2, 3].map(() => fakeCommand({ options: { user: target, amount: 60 } }));
    await Promise.all(runs.map(r => pay.callback(noClient, r.interaction)));

    assert.equal(await balanceOf('u1'), 40);
    assert.equal(await balanceOf('u2'), 57, '5% tax on 60 is 3');
    assert.equal(runs.filter(r => /don't have/.test(r.out[0])).length, 2);

    const self = fakeCommand({ options: { user: { id: 'u1', bot: false }, amount: 10 } });
    await pay.callback(noClient, self.interaction);
    assert.match(self.out[0], /can't pay yourself/);
});

test('chat coins pay once per minute per person, across all servers', async () => {
    delete require.cache[require.resolve('../src/features/economy/rewards')];
    const { grantChatCoins } = require('../src/features/economy/rewards');
    const first = await grantChatCoins(noClient, 'u1');
    assert.ok(first >= 1 && first <= 3);
    assert.equal(await grantChatCoins(noClient, 'u1'), 0, 'second message within the minute (any server) earns nothing');
});

test('voice: only active talkers earn coins and XP; muted, deafened, alone, AFK and bots earn nothing', async () => {
    const guild = fakeGuild();
    guild.afkChannelId = 'afk';
    const channels = {};
    const states = [];
    const join = (userId, channelId, flags = {}) => {
        const channel = channels[channelId] ??= { id: channelId, type: ChannelType.GuildVoice, parentId: null, parent: null, members: new Collection(), isTextBased: () => true, send: async () => {} };
        const member = { id: userId, user: { bot: Boolean(flags.bot) }, guild, client: noClient, roles: { cache: new Collection() } };
        const state = { guild, member, channel, selfMute: false, serverMute: false, selfDeaf: false, serverDeaf: false, ...flags };
        member.voice = state;
        channel.members.set(userId, member);
        states.push(state);
    };
    join('talk1', 'talk'); join('talk2', 'talk'); join('bot', 'talk', { bot: true });
    join('withMuted', 'quiet'); join('muted', 'quiet', { selfMute: true });
    join('afk1', 'afk'); join('afk2', 'afk');
    join('withDeaf', 'deafRoom'); join('deaf', 'deafRoom', { selfDeaf: true });
    join('alone', 'solo');
    guild.voiceStates = { cache: new Collection(states.map(s => [s.member.id, s])) };

    assert.deepEqual(states.filter(isActiveInVoice).map(s => s.member.id), ['talk1', 'talk2']);

    await payVoiceActivity({ guilds: { cache: new Collection([['g1', guild]]) } });
    assert.equal(await balanceOf('talk1'), 2);
    assert.equal(await balanceOf('talk2'), 2);
    assert.equal(await Wallet.countDocuments(), 2);
    assert.ok((await Member.findOne({ guildId: 'g1', userId: 'talk1' }).lean()).totalXp > 0, 'active voice also earns XP');
    assert.equal(await Member.countDocuments({ userId: { $in: ['muted', 'withMuted', 'afk1', 'alone', 'deaf'] } }), 0);
});

// ─── Shop ─────────────────────────────────────────────────────
function shopWorld({ balance = 0, roleAddFails = false } = {}) {
    const guild = fakeGuild({ roles: [{ id: 'vip', name: 'VIP', editable: true }, { id: 'temp', name: 'Weekend', editable: true }] });
    const memberRoles = new Collection();
    const removed = [];
    const member = {
        id: 'u1',
        roles: {
            cache: memberRoles,
            add: async (id) => { if (roleAddFails) throw new Error('Missing Permissions'); memberRoles.set(id, {}); },
            remove: async (id) => { removed.push(id); memberRoles.delete(id); },
        },
    };
    guild.members.fetch = async () => member;
    const interaction = { user: { id: 'u1' }, guildId: 'g1', guild, member, client: noClient };
    const client = { guilds: { cache: new Collection([['g1', guild]]) } };
    return { interaction, member, client, removed, setup: () => Promise.all([
        Wallet.create({ userId: 'u1', balance }),
        updateGuildSettings('g1', { $set: { 'settings.economy.shopRoles': [
            { roleId: 'vip', price: 100, durationDays: 0 },
            { roleId: 'temp', price: 50, durationDays: 7 },
        ] } }),
    ]) };
}

test('shop: buying a role takes the coins and gives the role; price changes and failures are safe', async () => {
    const world = shopWorld({ balance: 300 });
    await world.setup();

    assert.match(await shop.buyRole(world.interaction, 'vip', 90), /price changed/, 'charged only the price that was shown');
    assert.equal(await balanceOf('u1'), 300);

    assert.match(await shop.buyRole(world.interaction, 'vip', 100), /is yours/);
    assert.ok(world.member.roles.cache.has('vip'));
    assert.equal(await balanceOf('u1'), 200);
    assert.match(await shop.buyRole(world.interaction, 'vip', 100), /already have/);

    const broke = shopWorld({ balance: 300, roleAddFails: true });
    await Wallet.updateOne({ userId: 'u1' }, { $set: { balance: 300 } });
    assert.match(await shop.buyRole(broke.interaction, 'vip', 100), /refunded/);
    assert.equal(await balanceOf('u1'), 300, 'refunded when the role can\'t be given');
});

test('shop: timed roles extend when bought again and are removed when they expire', async () => {
    const world = shopWorld({ balance: 300 });
    await world.setup();
    await shop.buyRole(world.interaction, 'temp', 50);
    const first = (await RolePurchase.findOne({ userId: 'u1', roleId: 'temp' }).lean()).expiresAt;
    await shop.buyRole(world.interaction, 'temp', 50);
    const second = (await RolePurchase.findOne({ userId: 'u1', roleId: 'temp' }).lean()).expiresAt;
    assert.ok(Math.abs(second - first - 7 * 24 * HOUR) < 5000, 'second purchase adds another 7 days');
    assert.equal(await balanceOf('u1'), 200);

    await RolePurchase.updateOne({ userId: 'u1', roleId: 'temp' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await shop.removeExpiredRoles(world.client);
    assert.deepEqual(world.removed, ['temp']);
    assert.equal(await RolePurchase.countDocuments(), 0);
});

test('shop: card themes can be bought once, equipped, and premium themes need premium', async () => {
    const world = shopWorld({ balance: 600 });
    await world.setup();
    assert.match(await shop.buyTheme(world.interaction, 'midnight'), /unlocked and equipped/);
    assert.match(await shop.buyTheme(world.interaction, 'midnight'), /already own/);
    assert.equal(await balanceOf('u1'), 100);
    assert.match(await shop.buyTheme(world.interaction, 'gold'), /premium members/);
    assert.match(await shop.equipTheme(world.interaction, 'default'), /equipped/);
    assert.equal((await Wallet.findOne({ userId: 'u1' }).lean()).equippedTheme, 'default');
});

test('coin leaderboard ranks this server\'s members by their global wallets', async () => {
    await Member.create([{ guildId: 'g1', userId: 'a', totalXp: 5 }, { guildId: 'g1', userId: 'b', totalXp: 5 }, { guildId: 'g2', userId: 'rich', totalXp: 5 }]);
    await Wallet.create([{ userId: 'a', balance: 50 }, { userId: 'b', balance: 500 }, { userId: 'rich', balance: 99999 }]);
    const view = JSON.stringify((await renderLeaderboard(fakeGuild(), 0, 'a', undefined, 'coins')).components[0].toJSON());
    assert.ok(view.indexOf('<@b>') < view.indexOf('<@a>'), 'richest first');
    assert.ok(!view.includes('<@rich>'), 'members of other servers are not listed');
    assert.match(view, /Your rank: \*\*#2\*\*/);
});

test('settings: admins put roles in the shop with validated prices, one entry per role', async () => {
    const guild = fakeGuild({ roles: [{ id: 'vip', name: 'VIP', editable: true }, { id: 'top', name: 'Top', editable: false }] });
    const submit = async (fields) => {
        let rendered;
        await settings.handleInteraction(null, {
            customId: 'settings:eco:addrolemodal', guildId: 'g1', guild, user: { id: 'admin' }, message: { id: 'm1' },
            inGuild: () => true, memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
            deferUpdate: async () => {}, editReply: async (p) => { rendered = JSON.stringify(p.components[0].toJSON()); },
            fields: {
                getSelectedRoles: () => new Collection([[fields.role, { id: fields.role }]]),
                getTextInputValue: () => fields.price,
                getStringSelectValues: () => [fields.duration],
            },
        });
        return rendered;
    };
    assert.match(await submit({ role: 'top', price: '100', duration: '0' }), /above my highest role/);
    assert.match(await submit({ role: 'vip', price: 'lots', duration: '0' }), /whole number/);
    await submit({ role: 'vip', price: '1,500', duration: '7' });
    await submit({ role: 'vip', price: '2000', duration: '0' }); // re-adding updates it
    const { economy } = await getGuildSettings('g1', { fresh: true });
    assert.deepEqual(economy.shopRoles, [{ roleId: 'vip', price: 2000, durationDays: 0 }]);
});

test('card themes stay off (shop says "coming soon") until switched on', async () => {
    economyConfig.CARD_THEMES_ENABLED = false;
    delete require.cache[require.resolve('../src/features/economy/shop')];
    const gatedShop = require('../src/features/economy/shop');
    const world = shopWorld({ balance: 600 });
    await world.setup();
    assert.match(await gatedShop.buyTheme(world.interaction, 'midnight'), /coming soon/);
    assert.equal(await balanceOf('u1'), 600);
});

// ─── Fixes from review ────────────────────────────────────────
test('leaderboard page 2 renders: tab and page buttons never share an ID', async () => {
    await Member.create(Array.from({ length: 15 }, (_, i) => ({ guildId: 'g1', userId: `m${i}`, totalXp: 100 + i })));
    for (const board of ['xp', 'coins']) {
        if (board === 'coins') await Wallet.create(Array.from({ length: 15 }, (_, i) => ({ userId: `m${i}`, balance: 10 + i })));
        const { ids } = require('./helpers').inspectPanel(await renderLeaderboard(fakeGuild(), 1, 'm0', undefined, board));
        assert.equal(new Set(ids).size, ids.length, `${board}: duplicate custom_id on page 2`);
    }
});

test('migration adds old per-server coins to a wallet that already exists, exactly once', async () => {
    await Wallet.create({ userId: 'u1', balance: 100 });
    await Member.collection.insertOne({ guildId: 'g1', userId: 'u1', totalXp: 5, balance: 500 });
    await runMigrations();
    await runMigrations();
    assert.equal(await balanceOf('u1'), 600);
});

test('shop: a double click on Buy charges once', async () => {
    const world = shopWorld({ balance: 1000 });
    await world.setup();
    const results = await Promise.all([shop.buyRole(world.interaction, 'vip', 100), shop.buyRole(world.interaction, 'vip', 100)]);
    assert.equal(await balanceOf('u1'), 900);
    assert.equal(results.filter(r => /is yours/.test(r)).length, 1);
});

test('shop: renewing while the expiry job runs keeps the role and the new time', async () => {
    const world = shopWorld({ balance: 300 });
    await world.setup();
    await shop.buyRole(world.interaction, 'temp', 50);
    await RolePurchase.updateOne({ userId: 'u1' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await Promise.all([shop.removeExpiredRoles(world.client), shop.buyRole(world.interaction, 'temp', 50)]);
    const purchase = await RolePurchase.findOne({ userId: 'u1', roleId: 'temp' }).lean();
    assert.ok(world.member.roles.cache.has('temp'), 'role kept');
    assert.ok(purchase && purchase.expiresAt > new Date(), 'renewal recorded');
});

test('shop: a Discord error is not mistaken for "member left" (the role would become permanent)', async () => {
    const world = shopWorld({ balance: 300 });
    await world.setup();
    await shop.buyRole(world.interaction, 'temp', 50);
    await RolePurchase.updateOne({ userId: 'u1' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    world.interaction.guild.members.fetch = async () => { throw Object.assign(new Error('Service Unavailable'), { status: 503 }); };
    await shop.removeExpiredRoles(world.client);
    assert.equal(await RolePurchase.countDocuments(), 1, 'kept for a retry');

    world.interaction.guild.members.fetch = async () => { throw Object.assign(new Error('Unknown Member'), { code: 10007 }); };
    await shop.removeExpiredRoles(world.client);
    assert.equal(await RolePurchase.countDocuments(), 0, 'they left: nothing to remove');
});

test('voice: stage listeners (who can\x27t speak) don\x27t count as active', () => {
    const channel = { id: 'stage', members: new Collection() };
    const guild = { afkChannelId: null };
    const state = (id, suppress) => { const m = { id, user: { bot: false } }; const st = { guild, member: m, channel, suppress }; m.voice = st; channel.members.set(id, m); return st; };
    const listener = state('a', true);
    const speaker = state('b', false);
    state('c', false);
    assert.equal(isActiveInVoice(listener), false);
    assert.equal(isActiveInVoice(speaker), true);
});
