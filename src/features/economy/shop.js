// /shop: server roles (chosen by each server's admins) and /rank card themes (fixed catalog).
// The panel is stateless ("shop:*" custom IDs carry the selection and the price shown), and every
// purchase is an atomic wallet debit, refunded if the role can't be given.
const {
    AttachmentBuilder,
    FileUploadBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const Wallet = require('../../models/Wallet');
const CardImage = require('../../models/CardImage');
const RolePurchase = require('../../models/RolePurchase');
const Transaction = require('../../models/Transaction');
const { THEMES, CARD_THEMES_ENABLED, CUSTOM_CARD_COLORS_ENABLED, CUSTOM_THEME } = require('../../config/economy');
const { cardForMember, normalizeHex, luminance, mixHex, prepareBackgroundImage } = require('../leveling/rankCard');
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
async function renderShop(interaction, { tab = 'roles', selected = null, part = null, notice = null, convert = false } = {}) {
    const [wallet, settings] = await Promise.all([
        getWallet(interaction.user.id),
        getGuildSettings(interaction.guildId, { fresh: true }),
    ]);
    const body = tab === 'themes'
        ? await themesTab(interaction, wallet, settings, selected, part)
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

async function themesTab(interaction, wallet, settings, selectedId, part) {
    if (!CARD_THEMES_ENABLED) return ['🎨 Card themes for your **/rank** card are coming soon.'];
    const premium = await isPremium(interaction.client, interaction.user.id);
    const status = (t) => wallet.equippedTheme === t.id ? '⭐ equipped' : ownsTheme(wallet, t.id) ? '✅ owned' : t.premium ? '💎 premium' : '';
    const custom = wallet.customTheme ?? {};
    const lines = THEMES.map(t => `**${t.name}** · ${t.price ? coins(t.price) : 'free'}${status(t) ? ` · ${status(t)}` : ''}`);
    if (CUSTOM_CARD_COLORS_ENABLED) {
        lines.push(`**Custom theme** · ${coins(CUSTOM_THEME.price)} · 💎 premium${wallet.equippedTheme === 'custom' ? ' · ⭐ equipped' : custom.owned ? ' · ✅ owned' : ''}`);
    }
    const select = new StringSelectMenuBuilder()
        .setCustomId('shop:picktheme')
        .setPlaceholder('Choose a theme for your /rank card…')
        .addOptions([
            ...THEMES.map(t => ({
                label: t.name,
                description: `${t.price ? `${t.price.toLocaleString()} coins` : 'Free'}${t.premium ? ' · premium only' : ''}`,
                value: t.id,
                default: t.id === selectedId,
            })),
            ...(CUSTOM_CARD_COLORS_ENABLED ? [{
                label: 'Custom theme',
                description: 'Premium · your own colors, gradients and picture',
                value: 'custom',
                default: selectedId === 'custom',
            }] : []),
        ]);

    const parts = [lines.join('\n'), row(select)];

    if (selectedId === 'custom' && CUSTOM_CARD_COLORS_ENABLED) {
        return [...parts, ...customEditor(wallet, settings, premium, part)];
    }
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
    if (themeId === 'custom') return equipCustom(interaction);
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

// ─── Premium custom theme ─────────────────────────────────────
// Three parts, each a solid color or a gradient; the background can be a picture instead.
// Gradient directions are shared by all parts: left → right comes with the theme, the rest are bought.
const PARTS = {
    background: { name: 'Background', emoji: '🖼️', modes: ['solid', 'gradient', 'image'] },
    inner: { name: 'Inner card', emoji: '🪪', modes: ['solid', 'gradient'] },
    outline: { name: 'Outline', emoji: '✏️', modes: ['solid', 'gradient'] },
};
const MODES = { solid: 'Solid color', gradient: 'Gradient', image: 'Picture' };
const DIRECTIONS = CUSTOM_THEME.directions;

const picturesAllowed = (settings) => settings.economy.allowCardImages !== false;
const customView = (part, notice = null) => ({ tab: 'themes', selected: 'custom', part, notice });
const notOwned = 'Buy the custom theme first.';

function describePart(custom, id) {
    const part = custom[id] ?? {};
    const color = part.color ?? CUSTOM_THEME.defaults[id];
    if (part.mode === 'image') return custom.hasImage ? 'picture' : `picture (none uploaded yet, so ${color})`;
    if (part.mode === 'gradient') return `${color} ${DIRECTIONS[part.direction]?.arrow ?? '→'} ${part.color2}`;
    return color;
}

function customEditor(wallet, settings, premium, partId) {
    const custom = wallet.customTheme ?? {};
    const { price, directionPrice } = CUSTOM_THEME;
    if (!custom.owned) {
        return [section(
            `**Custom theme** · ${coins(price)} · 💎 premium\n` +
            'Your own colors for the background, the inner card and the outline (solid or a gradient), or a picture as the background.\n' +
            `-# Comes with the left → right gradient; the other directions are ${coins(directionPrice)} each.` +
            (premium ? '' : ' Premium only. See **/premium**.'),
            button('shop:cbuy', `Buy · ${price.toLocaleString()}`, ButtonStyle.Success, { disabled: !premium || wallet.balance < price }),
        )];
    }
    if (!premium) return ['**Custom theme** · ✅ owned\n-# It needs premium to use or edit. See **/premium**.'];

    const part = PARTS[partId] ? partId : 'background';
    const info = PARTS[part];
    const saved = custom[part] ?? {};
    const mode = saved.mode ?? 'solid';
    const color = saved.color ?? CUSTOM_THEME.defaults[part];
    const unlocked = custom.directions ?? [];
    const pictures = picturesAllowed(settings);

    const out = [
        `**Custom theme**${wallet.equippedTheme === 'custom' ? ' · ⭐ equipped' : ''}\n` +
        Object.entries(PARTS).map(([id, p]) => `${p.emoji} ${p.name} · ${describePart(custom, id)}`).join('\n'),
        row(...Object.entries(PARTS).map(([id, p]) => button(`shop:cpart:${id}`, p.name, id === part ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: p.emoji }))),
        row(new StringSelectMenuBuilder()
            .setCustomId(`shop:cmode:${part}`)
            .addOptions(info.modes
                .filter(m => m !== 'image' || pictures || mode === 'image')
                .map(m => ({ label: `${info.name}: ${MODES[m]}`, value: m, default: m === mode })))),
    ];

    if (mode === 'gradient') {
        out.push(section(`**${info.name}** · ${color} → ${saved.color2}\n-# Two hex codes, e.g. #ff8800 and #8e2de2.`,
            button(`shop:cedit:${part}`, 'Edit colors', ButtonStyle.Primary, { emoji: '🎨' })));
        out.push(row(new StringSelectMenuBuilder()
            .setCustomId(`shop:cdir:${part}`)
            .setPlaceholder('Direction')
            .addOptions(Object.entries(DIRECTIONS)
                .filter(([id]) => unlocked.includes(id))
                .map(([id, d]) => ({ label: `${d.arrow} ${d.label}`, value: id, default: id === (saved.direction ?? 'lr') })))));
        const locked = Object.entries(DIRECTIONS).filter(([id]) => !unlocked.includes(id));
        if (locked.length) {
            out.push(row(new StringSelectMenuBuilder()
                .setCustomId(`shop:cunlock:${part}`)
                .setPlaceholder(`🔒 Unlock another direction · ${directionPrice.toLocaleString()} coins each`)
                .addOptions(locked.map(([id, d]) => ({
                    label: `${d.arrow} ${d.label}`,
                    description: `${directionPrice.toLocaleString()} coins · works for every part`,
                    value: id,
                })))));
        }
    } else if (mode === 'image') {
        out.push(section(
            `**Picture** · ${custom.hasImage ? 'uploaded' : 'none yet'}\n` +
            (pictures
                ? `-# Cropped to fill the card. In servers that turn pictures off, the background is ${color}.`
                : `-# Pictures are turned off in this server, so your background is ${color} here.`),
            button('shop:cupload', custom.hasImage ? 'Replace' : 'Upload', ButtonStyle.Primary, { emoji: '📤', disabled: !pictures })));
        out.push(row(
            button(`shop:cedit:${part}`, 'Fallback color', ButtonStyle.Secondary, { emoji: '🎨' }),
            button('shop:cimgdel', 'Remove picture', ButtonStyle.Danger, { disabled: !custom.hasImage }),
        ));
    } else {
        out.push(section(`**${info.name}** · ${color}\n-# Any hex code, e.g. #ff8800.`,
            button(`shop:cedit:${part}`, 'Edit color', ButtonStyle.Primary, { emoji: '🎨' })));
    }

    out.push(row(
        wallet.equippedTheme === 'custom'
            ? button('shop:noop', 'Equipped', ButtonStyle.Secondary, { disabled: true })
            : button('shop:equip:custom', 'Equip', ButtonStyle.Success),
        button('shop:cpreview', 'Preview', ButtonStyle.Secondary, { emoji: '👁️' }),
    ));
    return out;
}

/** Why the member can't use the custom theme right now, or null if they can */
async function customBlocked(interaction) {
    if (!CUSTOM_CARD_COLORS_ENABLED) return 'The custom theme is coming soon.';
    if (!await isPremium(interaction.client, interaction.user.id)) return '⚠️ The custom theme is for premium members. See **/premium**.';
    return null;
}

async function buyCustomTheme(interaction) {
    const blocked = await customBlocked(interaction);
    if (blocked) return blocked;
    const userId = interaction.user.id;
    const { price, freeDirection, defaults } = CUSTOM_THEME;
    const part = (color) => ({ mode: 'solid', color, color2: null, direction: freeDirection });

    // Pay, unlock and equip in one atomic update (fails if already owned or not enough coins)
    const wallet = await Wallet.findOneAndUpdate(
        { userId, balance: { $gte: price }, 'customTheme.owned': { $ne: true } },
        {
            $inc: { balance: -price, spent: price },
            $set: {
                'customTheme.owned': true,
                'customTheme.directions': [freeDirection],
                'customTheme.background': part(defaults.background),
                'customTheme.inner': part(defaults.inner),
                'customTheme.outline': part(defaults.outline),
                equippedTheme: 'custom',
            },
        },
        { returnDocument: 'after' }
    ).lean();
    if (!wallet) {
        const current = await getWallet(userId);
        return current.customTheme?.owned ? 'You already own the custom theme.' : '⚠️ You don\'t have enough coins.';
    }
    await Transaction.create({ userId, guildId: interaction.guildId, amount: -price, type: 'shop_theme', note: 'Custom theme' }).catch(() => {});
    return '✅ Custom theme unlocked and equipped. Choose a part below to change its colors.';
}

async function unlockDirection(interaction, directionId, partId) {
    const blocked = await customBlocked(interaction);
    if (blocked) return blocked;
    const userId = interaction.user.id;
    const { directionPrice, freeDirection } = CUSTOM_THEME;
    const direction = DIRECTIONS[directionId];
    if (!direction || directionId === freeDirection) return '⚠️ Unknown direction.';

    // Pay and unlock atomically; it's also applied to the gradient being edited
    const wallet = await Wallet.findOneAndUpdate(
        { userId, 'customTheme.owned': true, 'customTheme.directions': { $ne: directionId }, balance: { $gte: directionPrice } },
        {
            $inc: { balance: -directionPrice, spent: directionPrice },
            $addToSet: { 'customTheme.directions': directionId },
            ...(PARTS[partId] ? { $set: { [`customTheme.${partId}.direction`]: directionId } } : {}),
        },
        { returnDocument: 'after' }
    ).lean();
    if (!wallet) {
        const current = (await getWallet(userId)).customTheme ?? {};
        if (!current.owned) return notOwned;
        return current.directions?.includes(directionId) ? 'You already have that direction.' : '⚠️ You don\'t have enough coins.';
    }
    await Transaction.create({ userId, guildId: interaction.guildId, amount: -directionPrice, type: 'shop_theme', note: `Gradient ${direction.label}` }).catch(() => {});
    return `✅ ${direction.arrow} ${direction.label} unlocked${PARTS[partId] ? ` and used for your ${PARTS[partId].name.toLowerCase()}` : ''}.`;
}

async function setPartMode(interaction, partId, mode) {
    const blocked = await customBlocked(interaction);
    if (blocked) return blocked;
    const info = PARTS[partId];
    if (!info?.modes.includes(mode)) return '⚠️ Unknown option.';
    if (mode === 'image' && !picturesAllowed(await getGuildSettings(interaction.guildId, { fresh: true }))) {
        return '⚠️ Pictures are turned off in this server.';
    }
    const userId = interaction.user.id;
    const custom = (await getWallet(userId)).customTheme ?? {};
    if (!custom.owned) return notOwned;

    // A new gradient starts from the current color to a lighter (or darker) version of it
    const update = { [`customTheme.${partId}.mode`]: mode };
    const current = custom[partId] ?? {};
    if (mode === 'gradient' && !current.color2) {
        const color = current.color ?? CUSTOM_THEME.defaults[partId];
        update[`customTheme.${partId}.color2`] = mixHex(color, luminance(color) > 0.5 ? '#000000' : '#ffffff');
    }
    await Wallet.updateOne({ userId, 'customTheme.owned': true }, { $set: update });
    if (mode === 'image' && !custom.hasImage) return `${info.name}: picture. Upload one below.`;
    return `✅ ${info.name}: ${MODES[mode].toLowerCase()}.`;
}

async function setDirection(interaction, partId, directionId) {
    const blocked = await customBlocked(interaction);
    if (blocked) return blocked;
    const direction = DIRECTIONS[directionId];
    if (!PARTS[partId] || !direction) return '⚠️ Unknown direction.';
    const result = await Wallet.updateOne(
        { userId: interaction.user.id, 'customTheme.owned': true, 'customTheme.directions': directionId },
        { $set: { [`customTheme.${partId}.direction`]: directionId } }
    );
    return result.matchedCount ? `✅ ${PARTS[partId].name} gradient: ${direction.arrow} ${direction.label.toLowerCase()}.` : 'Unlock that direction first.';
}

function customColorsForm(wallet, partId) {
    const info = PARTS[partId];
    const saved = wallet.customTheme?.[partId] ?? {};
    const gradient = saved.mode === 'gradient';
    const input = (id, value) => {
        const field = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder('#rrggbb');
        if (value) field.setValue(value);
        return field;
    };
    const fields = [new LabelBuilder()
        .setLabel(gradient ? 'First color' : saved.mode === 'image' ? 'Color where pictures are off' : 'Color')
        .setDescription(gradient ? `Where the gradient starts (${(DIRECTIONS[saved.direction] ?? DIRECTIONS.lr).label.toLowerCase()})` : 'A hex code, e.g. #ff8800')
        .setTextInputComponent(input('color', saved.color ?? CUSTOM_THEME.defaults[partId]))];
    if (gradient) {
        fields.push(new LabelBuilder().setLabel('Second color').setDescription('Where the gradient ends').setTextInputComponent(input('color2', saved.color2)));
    }
    return new ModalBuilder()
        .setCustomId(`shop:csave:${partId}:${gradient ? 'gradient' : 'solid'}`)
        .setTitle(`${info.name} ${gradient ? 'colors' : 'color'}`)
        .addLabelComponents(fields);
}

/** Saves the colors from the form. Returns { notice, saved } */
async function saveCustomColors(interaction, partId, form) {
    const blocked = await customBlocked(interaction);
    if (blocked) return { notice: blocked };
    if (!PARTS[partId]) return { notice: '⚠️ Unknown part.' };

    const update = {};
    for (const id of form === 'gradient' ? ['color', 'color2'] : ['color']) {
        const raw = interaction.fields.getTextInputValue(id)?.trim() ?? '';
        const hex = normalizeHex(raw);
        if (!hex) return { notice: `⚠️ "${raw.slice(0, 20)}" isn't a hex color. Use something like #ff8800.` };
        update[`customTheme.${partId}.${id}`] = hex;
    }
    const result = await Wallet.updateOne({ userId: interaction.user.id, 'customTheme.owned': true }, { $set: update });
    if (!result.matchedCount) return { notice: notOwned };
    return { notice: `✅ ${PARTS[partId].name} saved. Here's a preview:`, saved: true };
}

function uploadForm() {
    return new ModalBuilder()
        .setCustomId('shop:cuploadsave')
        .setTitle('Background picture')
        .addLabelComponents(new LabelBuilder()
            .setLabel('Picture')
            .setDescription(`It's cropped to fill the card (a wide strip). Up to ${CUSTOM_THEME.maxImageBytes / 1024 / 1024} MB.`)
            .setFileUploadComponent(new FileUploadBuilder().setCustomId('image').setFileTypes('image').setMinValues(1).setMaxValues(1).setRequired(true)));
}

/** Saves an uploaded background picture (cropped and shrunk). Returns { notice, saved } */
async function saveBackgroundImage(interaction) {
    const blocked = await customBlocked(interaction);
    if (blocked) return { notice: blocked };
    const userId = interaction.user.id;
    if (!picturesAllowed(await getGuildSettings(interaction.guildId, { fresh: true }))) return { notice: '⚠️ Pictures are turned off in this server.' };
    if (!(await getWallet(userId)).customTheme?.owned) return { notice: notOwned };

    const file = interaction.fields.getUploadedFiles('image')?.first();
    if (!file) return { notice: '⚠️ No picture was uploaded.' };
    if (!file.contentType?.startsWith('image/')) return { notice: '⚠️ That file isn\'t a picture.' };
    if (file.size > CUSTOM_THEME.maxImageBytes) return { notice: `⚠️ That picture is too big (${CUSTOM_THEME.maxImageBytes / 1024 / 1024} MB at most).` };

    let data;
    try {
        const response = await fetch(file.url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`download failed (${response.status})`);
        data = await prepareBackgroundImage(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
        warn(`Could not use the card picture from ${userId}: ${err.message}`);
        return { notice: '⚠️ I couldn\'t read that picture. Try a PNG or JPG.' };
    }
    await CardImage.updateOne({ userId }, { $set: { data, contentType: 'image/jpeg' } }, { upsert: true });
    await Wallet.updateOne({ userId, 'customTheme.owned': true }, { $set: { 'customTheme.hasImage': true, 'customTheme.background.mode': 'image' } });
    return { notice: '✅ Picture saved as your background. Here\'s a preview:', saved: true };
}

// Anyone can remove their picture (no premium needed to delete your own data)
async function removeBackgroundImage(interaction) {
    const userId = interaction.user.id;
    await CardImage.deleteOne({ userId });
    await Wallet.updateOne({ userId }, { $set: { 'customTheme.hasImage': false } });
    await Wallet.updateOne({ userId, 'customTheme.background.mode': 'image' }, { $set: { 'customTheme.background.mode': 'solid' } });
    return '✅ Picture removed. Your background is a solid color again.';
}

async function equipCustom(interaction) {
    const blocked = await customBlocked(interaction);
    if (blocked) return blocked;
    const result = await Wallet.updateOne(
        { userId: interaction.user.id, 'customTheme.owned': true },
        { $set: { equippedTheme: 'custom' } }
    );
    return result.matchedCount ? '✅ Custom theme equipped.' : notOwned;
}

// Shows the member their card with the custom theme, equipped or not (best effort: it's only a preview)
async function sendCardPreview(interaction) {
    try {
        const member = interaction.guild.members.cache.get(interaction.user.id) ?? interaction.member;
        const card = await cardForMember(interaction.client, interaction.guild, member, { customPreview: true });
        await interaction.followUp({ files: [new AttachmentBuilder(card, { name: 'card-preview.png' })], flags: MessageFlags.Ephemeral });
    } catch (err) {
        warn(`Could not render a card preview for ${interaction.user.id}: ${err.message}`);
    }
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
    // Opening a form must be the first response
    if (action === 'cedit' && PARTS[arg]) return interaction.showModal(customColorsForm(await getWallet(interaction.user.id), arg));
    if (action === 'cupload') return interaction.showModal(uploadForm());

    await interaction.deferUpdate();
    if (action === 'cpreview') return sendCardPreview(interaction);

    let view;
    let preview = false;
    switch (action) {
        case 'tab': view = { tab: arg === 'themes' ? 'themes' : 'roles' }; break;
        case 'pickrole': view = { tab: 'roles', selected: interaction.values[0] }; break;
        case 'picktheme': view = { tab: 'themes', selected: interaction.values[0] }; break;
        case 'buyrole': view = { tab: 'roles', selected: arg, notice: await buyRole(interaction, arg, Number(extra)) }; break;
        case 'buytheme': view = { tab: 'themes', selected: arg, notice: await buyTheme(interaction, arg) }; break;
        case 'equip': view = { tab: 'themes', selected: arg, notice: await equipTheme(interaction, arg) }; break;
        case 'cbuy': view = customView('background', await buyCustomTheme(interaction)); break;
        case 'cpart': view = customView(arg); break;
        case 'cmode': view = customView(arg, await setPartMode(interaction, arg, interaction.values[0])); break;
        case 'cdir': view = customView(arg, await setDirection(interaction, arg, interaction.values[0])); break;
        case 'cunlock': view = customView(arg, await unlockDirection(interaction, interaction.values[0], arg)); break;
        case 'cimgdel': view = customView('background', await removeBackgroundImage(interaction)); break;
        case 'csave': {
            const { notice, saved } = await saveCustomColors(interaction, arg, extra);
            view = customView(arg, notice);
            preview = Boolean(saved);
            break;
        }
        case 'cuploadsave': {
            const { notice, saved } = await saveBackgroundImage(interaction);
            view = customView('background', notice);
            preview = Boolean(saved);
            break;
        }
        default: view = {};
    }
    await interaction.editReply(await renderShop(interaction, view));
    if (preview) await sendCardPreview(interaction);
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

module.exports = {
    openShop, handleInteraction, renderShop, buyRole, buyTheme, equipTheme,
    buyCustomTheme, unlockDirection, setPartMode, setDirection, saveCustomColors, saveBackgroundImage, removeBackgroundImage,
    removeExpiredRoles, startRoleExpiry,
};
