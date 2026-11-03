// /shop: server roles (chosen by each server's admins) and /rank card themes (fixed catalog).
// The panel is stateless ("shop:*" custom IDs carry the selection and the price shown), and every
// purchase is an atomic wallet debit, refunded if the role can't be given.
const { MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const Wallet = require('../../models/Wallet');
const RolePurchase = require('../../models/RolePurchase');
const Transaction = require('../../models/Transaction');
const { THEMES, CARD_THEMES_ENABLED } = require('../../config/economy');
const { getGuildSettings } = require('../../services/guildSettings');
const { getWallet, debit, credit } = require('../../services/wallet');
const { isPremium } = require('../../services/premium');
const { container, separator, row, section, button, panelPayload, ButtonStyle } = require('../../utils/panels');
const { coins } = require('../../utils/coins');
const { withLock } = require('../../utils/locks');
const { info, warn, error } = require('../../services/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCENT = 0xF1C40F;

const durationLabel = (days) => (days ? `${days} day${days === 1 ? '' : 's'}` : 'permanent');
const ownsTheme = (wallet, id) => id === 'default' || wallet.ownedThemes?.includes(id);

// ─── Rendering ────────────────────────────────────────────────
async function renderShop(interaction, { tab = 'roles', selected = null, notice = null, convert = false } = {}) {
    const [wallet, settings] = await Promise.all([
        getWallet(interaction.user.id),
        getGuildSettings(interaction.guildId, { fresh: true }),
    ]);
    const body = tab === 'themes'
        ? await themesTab(interaction, wallet, selected)
        : rolesTab(interaction, wallet, settings, selected);

    return panelPayload(container([
        `## 🛍️ Shop\nYou have ${coins(wallet.balance)} coins · one wallet for every server`,
        notice ? `-# ${notice}` : null,
        row(
            button('shop:tab:roles', 'Server roles', tab === 'roles' ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: '🎭' }),
            button('shop:tab:themes', 'Card themes', tab === 'themes' ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: '🎨' }),
        ),
        separator(),
        ...body,
        separator(),
        row(button('shop:close', 'Close')),
    ], ACCENT), { convert });
}

function rolesTab(interaction, wallet, settings, selectedRoleId) {
    const guild = interaction.guild;
    const items = settings.economy.shopRoles.filter(r => guild.roles.cache.has(r.roleId));
    if (!items.length) {
        return ['This server isn\'t selling any roles yet. Admins can add some in **/settings → Economy**.'];
    }

    const owned = (id) => interaction.member.roles.cache.has(id);
    const list = items.map(r => `<@&${r.roleId}> · ${coins(r.price)} · ${durationLabel(r.durationDays)}${owned(r.roleId) ? ' · ✅ yours' : ''}`).join('\n');
    const select = new StringSelectMenuBuilder()
        .setCustomId('shop:pickrole')
        .setPlaceholder('Choose a role to see it…')
        .addOptions(items.map(r => ({
            label: `@${guild.roles.cache.get(r.roleId).name}`.slice(0, 100),
            description: `${r.price.toLocaleString()} coins · ${durationLabel(r.durationDays)}`,
            value: r.roleId,
            default: r.roleId === selectedRoleId,
        })));

    const parts = [list, row(select)];
    const item = items.find(r => r.roleId === selectedRoleId);
    if (item) {
        const permanentOwned = owned(item.roleId) && !item.durationDays;
        const label = permanentOwned ? 'Owned' : owned(item.roleId) ? `Extend · ${item.price.toLocaleString()}` : `Buy · ${item.price.toLocaleString()}`;
        parts.push(section(
            `<@&${item.roleId}> · ${coins(item.price)} · ${durationLabel(item.durationDays)}` +
            (item.durationDays && owned(item.roleId) ? '\n-# Buying again adds more time.' : ''),
            button(`shop:buyrole:${item.roleId}:${item.price}`, label, ButtonStyle.Success, { disabled: permanentOwned || wallet.balance < item.price }),
        ));
    }
    return parts;
}

async function themesTab(interaction, wallet, selectedId) {
    if (!CARD_THEMES_ENABLED) return ['🎨 Card themes for your **/rank** card are coming soon.'];
    const premium = await isPremium(interaction.client, interaction.user.id);
    const status = (t) => wallet.equippedTheme === t.id ? '⭐ equipped' : ownsTheme(wallet, t.id) ? '✅ owned' : t.premium ? '💎 premium' : '';
    const list = THEMES.map(t => `**${t.name}** · ${t.price ? coins(t.price) : 'free'}${status(t) ? ` · ${status(t)}` : ''}`).join('\n');
    const select = new StringSelectMenuBuilder()
        .setCustomId('shop:picktheme')
        .setPlaceholder('Choose a theme for your /rank card…')
        .addOptions(THEMES.map(t => ({
            label: t.name,
            description: `${t.price ? `${t.price.toLocaleString()} coins` : 'Free'}${t.premium ? ' · premium only' : ''}`,
            value: t.id,
            default: t.id === selectedId,
        })));

    const parts = [list, row(select)];
    const theme = THEMES.find(t => t.id === selectedId);
    if (theme) {
        let action;
        if (wallet.equippedTheme === theme.id) action = button('shop:noop', 'Equipped', ButtonStyle.Secondary, { disabled: true });
        else if (ownsTheme(wallet, theme.id)) action = button(`shop:equip:${theme.id}`, 'Equip', ButtonStyle.Primary);
        else action = button(`shop:buytheme:${theme.id}`, `Buy · ${theme.price.toLocaleString()}`, ButtonStyle.Success,
            { disabled: wallet.balance < theme.price || (theme.premium && !premium) });
        parts.push(section(
            `**${theme.name}** · background ${theme.background} · accent ${theme.accent ?? 'your role color'}` +
            (theme.premium && !premium ? '\n-# Premium only. See **/premium**.' : ''),
            action,
        ));
    }
    return parts;
}

// ─── Purchases ────────────────────────────────────────────────
// One purchase (or expiry) at a time per member and role, so a double click can't charge twice
const roleLockKey = (guildId, userId, roleId) => `shoprole:${guildId}:${userId}:${roleId}`;

function buyRole(interaction, roleId, shownPrice) {
    return withLock(roleLockKey(interaction.guildId, interaction.user.id, roleId), () => buyRoleLocked(interaction, roleId, shownPrice));
}

async function buyRoleLocked(interaction, roleId, shownPrice) {
    const guild = interaction.guild;
    const userId = interaction.user.id;
    const { economy } = await getGuildSettings(guild.id, { fresh: true });
    const item = economy.shopRoles.find(r => r.roleId === roleId);
    if (!item) return '⚠️ That role isn\'t for sale any more.';
    if (item.price !== shownPrice) return `⚠️ The price changed to ${item.price.toLocaleString()} coins. Check it and try again.`;

    const role = guild.roles.cache.get(roleId);
    if (!role?.editable || !guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return '⚠️ I can\'t give out that role right now. Please tell an admin (my role must be above it).';
    }
    // The cached member reflects a role added by a purchase that just finished under this lock
    const member = guild.members.cache?.get(userId) ?? interaction.member;
    const hasRole = member.roles.cache.has(roleId);
    if (hasRole && !item.durationDays) return 'You already have that role.';

    if (!await debit(userId, item.price, { type: 'shop_role', guildId: guild.id, note: `@${role.name}` })) {
        return '⚠️ You don\'t have enough coins.';
    }
    try {
        if (!hasRole) await member.roles.add(roleId, 'Bought in the shop');
    } catch (err) {
        await credit(userId, item.price, { type: 'refund', guildId: guild.id, note: `@${role.name}` });
        warn(`Shop role grant failed in guild ${guild.id}: ${err.message}`);
        return '⚠️ I couldn\'t give you the role, so your coins were refunded.';
    }

    if (item.durationDays) {
        // Atomic extend: from the current expiry if it's still in the future, otherwise from now
        const now = new Date();
        await RolePurchase.collection.updateOne(
            { guildId: guild.id, userId, roleId },
            [{ $set: {
                guildId: guild.id, userId, roleId, updatedAt: now,
                createdAt: { $ifNull: ['$createdAt', now] },
                expiresAt: { $add: [{ $max: [{ $ifNull: ['$expiresAt', now] }, now] }, item.durationDays * DAY_MS] },
            } }],
            { upsert: true }
        );
        const purchase = await RolePurchase.findOne({ guildId: guild.id, userId, roleId }).lean();
        return `✅ <@&${roleId}> is yours until <t:${Math.floor(purchase.expiresAt / 1000)}:f>.`;
    }
    return `✅ <@&${roleId}> is yours!`;
}

async function buyTheme(interaction, themeId) {
    const userId = interaction.user.id;
    const theme = THEMES.find(t => t.id === themeId);
    if (!CARD_THEMES_ENABLED) return 'Card themes are coming soon.';
    if (!theme || !theme.price) return '⚠️ That theme can\'t be bought.';
    if (theme.premium && !await isPremium(interaction.client, userId)) return '⚠️ That theme is for premium members. See **/premium**.';

    // Pay, unlock and equip in one atomic update (fails if already owned or not enough coins)
    const wallet = await Wallet.findOneAndUpdate(
        { userId, balance: { $gte: theme.price }, ownedThemes: { $ne: theme.id } },
        { $inc: { balance: -theme.price, spent: theme.price }, $addToSet: { ownedThemes: theme.id }, $set: { equippedTheme: theme.id } },
        { returnDocument: 'after' }
    ).lean();
    if (!wallet) {
        const current = await getWallet(userId);
        return ownsTheme(current, theme.id) ? 'You already own that theme.' : '⚠️ You don\'t have enough coins.';
    }
    await Transaction.create({ userId, guildId: interaction.guildId, amount: -theme.price, type: 'shop_theme', note: theme.name }).catch(() => {});
    return `✅ **${theme.name}** unlocked and equipped. Check it out with **/rank**!`;
}

async function equipTheme(interaction, themeId) {
    const userId = interaction.user.id;
    const theme = THEMES.find(t => t.id === themeId);
    if (!CARD_THEMES_ENABLED) return 'Card themes are coming soon.';
    if (!theme) return '⚠️ Unknown theme.';
    if (theme.premium && !await isPremium(interaction.client, userId)) return '⚠️ That theme is for premium members. See **/premium**.';
    const result = await Wallet.updateOne(
        theme.id === 'default' ? { userId } : { userId, ownedThemes: theme.id },
        { $set: { equippedTheme: theme.id } },
        { upsert: theme.id === 'default' }
    );
    return result.matchedCount || result.upsertedCount ? `✅ **${theme.name}** equipped.` : 'You don\'t own that theme yet.';
}

// ─── Interactions ─────────────────────────────────────────────
async function openShop(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(await renderShop(interaction, { convert: true }));
}

async function handleInteraction(client, interaction) {
    const [, action, arg, extra] = interaction.customId.split(':');
    if (action === 'noop') return interaction.deferUpdate();
    if (action === 'close') {
        await interaction.deferUpdate();
        return interaction.deleteReply().catch(() => {});
    }

    await interaction.deferUpdate();
    let view;
    switch (action) {
        case 'tab': view = { tab: arg === 'themes' ? 'themes' : 'roles' }; break;
        case 'pickrole': view = { tab: 'roles', selected: interaction.values[0] }; break;
        case 'picktheme': view = { tab: 'themes', selected: interaction.values[0] }; break;
        case 'buyrole': view = { tab: 'roles', selected: arg, notice: await buyRole(interaction, arg, Number(extra)) }; break;
        case 'buytheme': view = { tab: 'themes', selected: arg, notice: await buyTheme(interaction, arg) }; break;
        case 'equip': view = { tab: 'themes', selected: arg, notice: await equipTheme(interaction, arg) }; break;
        default: view = {};
    }
    await interaction.editReply(await renderShop(interaction, view));
}

// ─── Timed roles ──────────────────────────────────────────────
const OVERDUE_GIVE_UP_MS = 7 * DAY_MS; // stop retrying a removal after a week (e.g. role deleted)

const UNKNOWN_MEMBER = 10007; // Discord API error code

async function removeExpiredRoles(client) {
    const due = await RolePurchase.find({ expiresAt: { $lte: new Date() } }).limit(100).lean();
    for (const stale of due) {
        await withLock(roleLockKey(stale.guildId, stale.userId, stale.roleId), () => expireOne(client, stale))
            .catch(err => error(`Error expiring shop role ${stale._id}: `, err));
    }
}

async function expireOne(client, stale) {
    // Re-read under the lock: it may have been extended while we waited
    const purchase = await RolePurchase.findOne({ _id: stale._id }).lean();
    if (!purchase || purchase.expiresAt > new Date()) return;

    const guild = client.guilds.cache.get(purchase.guildId);
    if (guild && !guild.available) return; // outage: try again later

    let member = null;
    if (guild) {
        try {
            member = await guild.members.fetch(purchase.userId);
        } catch (err) {
            // Only "they left the server" means there's no role to remove; anything else is retried
            if (err.code !== UNKNOWN_MEMBER) return;
        }
    }

    if (member?.roles.cache.has(purchase.roleId)) {
        try {
            await member.roles.remove(purchase.roleId, 'Shop role expired');
        } catch (err) {
            // Keep it and retry next time, unless it's been failing for a week
            if (Date.now() - purchase.expiresAt < OVERDUE_GIVE_UP_MS) return;
            warn(`Giving up removing expired shop role ${purchase.roleId} in ${purchase.guildId}: ${err.message}`);
        }
    }
    // Only delete the record we looked at; an extension in the meantime changes expiresAt
    await RolePurchase.deleteOne({ _id: purchase._id, expiresAt: purchase.expiresAt });
    info(`Shop role ${purchase.roleId} expired for ${purchase.userId} in guild ${purchase.guildId}`);
}

function startRoleExpiry(client) {
    removeExpiredRoles(client).catch(err => error('Error removing expired shop roles: ', err));
    setInterval(() => {
        removeExpiredRoles(client).catch(err => error('Error removing expired shop roles: ', err));
    }, 5 * 60_000).unref();
}

module.exports = { openShop, handleInteraction, renderShop, buyRole, buyTheme, equipTheme, removeExpiredRoles, startRoleExpiry };
