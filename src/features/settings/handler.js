// /settings panel and /setup wizard: opening them, and handling every click/select/form on them.
// The panel is stateless (custom IDs carry what's needed), so it survives restarts and works
// independently in every server. The only memory kept is each admin's newest panel (so opening
// /settings or /setup again closes the old one) and, for the wizard, which step it's on.
const {
    ChannelType,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { PAGES, WIZARD_STEPS, renderWizardStep, TICKET_CATEGORIES, ANNOUNCE_OPTIONS, MAX_LEVEL_ROLES, closed } = require('./pages');
const { getGuildSettings, updateGuildSettings } = require('../../services/guildSettings');
const { panelPayload } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { SHOP } = require('../../config/economy');

const TOKEN_LIFETIME_MS = 15 * 60_000; // after this, a panel's interaction can no longer edit it
const panels = new Map(); // `${guildId}:${userId}` → { messageId, interaction, at, step }

setInterval(() => {
    const cutoff = Date.now() - TOKEN_LIFETIME_MS;
    for (const [key, panel] of panels) if (panel.at < cutoff) panels.delete(key);
}, 5 * 60_000).unref();

const panelKey = (interaction) => `${interaction.guildId}:${interaction.user.id}`;

// `step` set: render that /setup wizard step; otherwise the /settings page
async function render(guild, { page, step }, notice, options) {
    const settings = await getGuildSettings(guild.id, { fresh: true });
    const view = step ? renderWizardStep(step, guild, settings, notice) : PAGES[page](guild, settings, notice);
    return panelPayload(view, options);
}

// ─── /settings and /setup ─────────────────────────────────────
async function openPanel(interaction, { wizard = false } = {}) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Close the previous panel first so only one is ever open per admin per server
    const key = panelKey(interaction);
    const previous = panels.get(key);
    panels.delete(key);
    if (previous) await previous.interaction.deleteReply().catch(() => {});

    const step = wizard ? 'welcome' : null;
    const message = await interaction.editReply(await render(interaction.guild, { page: 'home', step }, null, { convert: true }));
    panels.set(key, { messageId: message.id, interaction, at: Date.now(), step });
}

// ─── Panel interactions ───────────────────────────────────────
async function handleInteraction(client, interaction) {
    if (!interaction.inGuild()) return;
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply(ephemeral('You need the **Administrator** permission to change settings.'));
    }

    const key = panelKey(interaction);
    const messageId = interaction.message?.id;
    const newest = panels.get(key);
    if (newest && messageId && newest.messageId !== messageId) {
        return interaction.update(panelPayload(closed('This panel was replaced by a newer one. Use the latest panel, or run **/settings** again.')));
    }

    const [, area, action, arg] = interaction.customId.split(':');

    if (area === 'close') {
        panels.delete(key);
        await interaction.deferUpdate();
        await interaction.deleteReply().catch(() => {});
        return;
    }

    // Buttons that open a form answer with the form itself
    const modal = await formFor(`${area}:${action}`, interaction.guildId);
    if (modal) return interaction.showModal(modal);

    await interaction.deferUpdate(); // acknowledge right away; saving may take a moment

    // Wizard navigation picks the step; "Open settings" (nav) leaves the wizard; anything else
    // stays on the current wizard step (remembered per panel) and re-renders it with the result
    let step = newest?.messageId === messageId ? newest.step : null;
    if (area === 'wiz') step = WIZARD_STEPS.includes(action) ? action : 'welcome';
    if (area === 'nav') step = null;

    const { page, notice } = area === 'wiz' ? { page: 'home' } : await applyChange(interaction, area, action, arg);
    await interaction.editReply(await render(interaction.guild, { page, step }, notice));
    panels.set(key, { messageId, interaction, at: Date.now(), step });
}

const save = (interaction, update) => updateGuildSettings(interaction.guildId, update);

async function applyChange(interaction, area, action, arg) {
    const guild = interaction.guild;

    if (area === 'nav') return { page: PAGES[action] ? action : 'home' };

    switch (`${area}:${action}`) {
        // ── Voice ──
        case 'voice:hubs': {
            const hubs = interaction.values.map(id => ({ channelId: id, name: interaction.channels.get(id)?.name ?? null }));
            await save(interaction, { $set: { 'settings.voiceHubs': hubs } });
            return { page: 'voice', notice: `✅ Saved · ${hubs.length} hub${hubs.length === 1 ? '' : 's'}` };
        }

        // ── Server roles ──
        case 'server:staff':
        case 'server:mods': {
            const roleIds = interaction.values.filter(id => id !== guild.id); // never @everyone
            const path = action === 'staff' ? 'settings.staffRoleIds' : 'settings.modRoleIds';
            await save(interaction, { $set: { [path]: roleIds } });
            const label = action === 'staff' ? 'Staff' : 'Moderator';
            return { page: 'server', notice: roleIds.length ? `✅ ${label} roles: ${roleIds.map(id => `<@&${id}>`).join(', ')}` : `✅ ${label} roles cleared` };
        }

        // ── Tickets ──
        case 'tickets:target': {
            const category = TICKET_CATEGORIES.find(c => c.key === arg);
            if (!category) return { page: 'tickets' };
            const channel = interaction.channels.first();
            const value = channel
                ? { channelId: channel.id, type: channel.type === ChannelType.GuildForum ? 'forum' : 'channel' }
                : { channelId: null, type: null };
            await save(interaction, { $set: { [`settings.tickets.${category.key}`]: value } });
            return { page: 'tickets', notice: channel ? `✅ ${category.label} tickets now go to <#${channel.id}>` : `✅ ${category.label} tickets turned off` };
        }
        case 'tickets:transcripts': {
            const channelId = interaction.values[0] ?? null;
            await save(interaction, { $set: { 'settings.tickets.transcriptChannelId': channelId } });
            return { page: 'tickets', notice: channelId ? `✅ Transcripts go to <#${channelId}>` : '✅ Transcripts turned off' };
        }

        // ── Leveling ──
        case 'lvl:enabled':
            await save(interaction, { $set: { 'settings.leveling.enabled': arg === 'on' } });
            return { page: 'leveling', notice: arg === 'on' ? '✅ XP turned on' : '✅ XP turned off' };
        case 'lvl:keeplower':
            await save(interaction, { $set: { 'settings.leveling.keepLowerRoles': arg === 'yes' } });
            return { page: 'leveling', notice: '✅ Saved' };
        case 'lvl:announce': {
            const mode = interaction.values[0];
            if (!ANNOUNCE_OPTIONS.some(o => o.value === mode)) return { page: 'leveling' };
            const settings = await save(interaction, { $set: { 'settings.leveling.announce': mode } });
            const needsChannel = mode === 'channel' && !guild.channels.cache.has(settings.leveling.announceChannelId);
            return { page: 'leveling', notice: needsChannel ? '👇 Now choose the level-up channel below' : '✅ Saved' };
        }
        case 'lvl:announcechan': {
            const channelId = interaction.values[0];
            await save(interaction, { $set: { 'settings.leveling.announceChannelId': channelId } });
            return { page: 'leveling', notice: `✅ Level-ups will be posted in <#${channelId}>` };
        }
        case 'lvl:noxp':
            await save(interaction, { $set: { 'settings.leveling.noXpChannelIds': interaction.values } });
            return { page: 'leveling', notice: `✅ Saved · ${interaction.values.length} no-XP channel${interaction.values.length === 1 ? '' : 's'}` };
        case 'lvl:removerole': {
            const level = Number(interaction.values[0]);
            await save(interaction, { $pull: { 'settings.leveling.levelRoles': { level } } });
            return { page: 'leveling', notice: `✅ Removed the level ${level} role` };
        }
        case 'lvl:ratemodal':
            return { page: 'leveling', notice: await saveRate(interaction) };
        case 'lvl:addrolemodal':
            return { page: 'leveling', notice: await saveLevelRole(interaction) };

        // ── Moderation ──
        case 'mod:log': {
            const channelId = interaction.values[0] ?? null;
            await save(interaction, { $set: { 'settings.moderation.logChannelId': channelId } });
            return { page: 'moderation', notice: channelId ? `✅ Moderation actions will be logged in <#${channelId}>` : '✅ Logging turned off' };
        }

        // ── Economy (coin amounts are fixed in code; servers only choose what /shop sells) ──
        case 'eco:addrolemodal':
            return { page: 'economy', notice: await saveShopRole(interaction) };
        case 'eco:images': {
            const allow = arg === 'on';
            await save(interaction, { $set: { 'settings.economy.allowCardImages': allow } });
            return { page: 'economy', notice: allow ? '✅ Card pictures are on' : '✅ Card pictures are off · cards show their colors instead in this server' };
        }
        case 'eco:removerole': {
            const roleId = interaction.values[0];
            await save(interaction, { $pull: { 'settings.economy.shopRoles': { roleId } } });
            return { page: 'economy', notice: `✅ <@&${roleId}> removed from the shop. Members who bought it keep it (timed roles still expire).` };
        }
    }
    return { page: 'home' };
}

// ─── Forms ────────────────────────────────────────────────────
function parseWholeNumber(value) {
    const trimmed = value.trim().replace(/[,\s]/g, '');
    return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function numberInput(customId, value, maxLength = 7) {
    return new TextInputBuilder()
        .setCustomId(customId)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(maxLength)
        .setValue(String(value));
}

async function formFor(id, guildId) {
    const settings = await getGuildSettings(guildId);
    if (id === 'lvl:rate') {
        const lv = settings.leveling;
        return new ModalBuilder()
            .setCustomId('settings:lvl:ratemodal')
            .setTitle('XP rate')
            .addLabelComponents(
                new LabelBuilder().setLabel('Minimum XP per message').setDescription('1 to 1000').setTextInputComponent(numberInput('min', lv.xpMin, 4)),
                new LabelBuilder().setLabel('Maximum XP per message').setDescription('1 to 1000, at least the minimum').setTextInputComponent(numberInput('max', lv.xpMax, 4)),
                new LabelBuilder().setLabel('Cooldown (seconds)').setDescription('How long a member waits between XP gains (0 to 3600)').setTextInputComponent(numberInput('cooldown', lv.cooldownSeconds, 4)),
            );
    }
    if (id === 'lvl:addrole') {
        return new ModalBuilder()
            .setCustomId('settings:lvl:addrolemodal')
            .setTitle('Add a level role')
            .addLabelComponents(
                new LabelBuilder().setLabel('Level').setDescription('Members get the role when they reach this level').setTextInputComponent(
                    new TextInputBuilder().setCustomId('level').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setPlaceholder('e.g. 5')),
                new LabelBuilder().setLabel('Role').setDescription('Must be below my highest role').setRoleSelectMenuComponent(
                    new RoleSelectMenuBuilder().setCustomId('role').setMinValues(1).setMaxValues(1)),
            );
    }
    if (id === 'eco:addrole') {
        return new ModalBuilder()
            .setCustomId('settings:eco:addrolemodal')
            .setTitle('Sell a role in the shop')
            .addLabelComponents(
                new LabelBuilder().setLabel('Role').setDescription('Must be below my highest role').setRoleSelectMenuComponent(
                    new RoleSelectMenuBuilder().setCustomId('role').setMinValues(1).setMaxValues(1)),
                new LabelBuilder().setLabel('Price (coins)').setDescription(`1 to ${SHOP.maxPrice.toLocaleString()}`).setTextInputComponent(
                    new TextInputBuilder().setCustomId('price').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder('e.g. 2500')),
                new LabelBuilder().setLabel('How long buyers keep it').setStringSelectMenuComponent(
                    new StringSelectMenuBuilder().setCustomId('duration').setMinValues(1).setMaxValues(1).addOptions(
                        SHOP.durations.map(days => ({
                            label: days ? `${days} day${days === 1 ? '' : 's'}` : 'Permanent',
                            value: String(days),
                            default: days === 0,
                        })))),
            );
    }
    return null;
}

async function saveShopRole(interaction) {
    const roleId = interaction.fields.getSelectedRoles('role', true).first().id;
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role || role.id === interaction.guild.id) return '⚠️ Choose a regular role (not @everyone).';
    if (role.managed) return `⚠️ <@&${roleId}> is managed by an integration and can't be sold.`;
    if (!role.editable) return `⚠️ <@&${roleId}> is above my highest role. Move my role above it in Server Settings → Roles.`;

    const price = parseWholeNumber(interaction.fields.getTextInputValue('price'));
    if (price === null || price < 1 || price > SHOP.maxPrice) return `⚠️ The price must be a whole number from 1 to ${SHOP.maxPrice.toLocaleString()}.`;
    const durationDays = Number(interaction.fields.getStringSelectValues('duration')[0] ?? 0);
    if (!SHOP.durations.includes(durationDays)) return '⚠️ Choose how long buyers keep the role.';

    // One entry per role (re-adding a role updates it); the cap is part of the write itself
    await save(interaction, { $pull: { 'settings.economy.shopRoles': { roleId } } });
    const saved = await updateGuildSettings(
        interaction.guildId,
        { $push: { 'settings.economy.shopRoles': { roleId, price, durationDays } } },
        { [`settings.economy.shopRoles.${SHOP.maxRoles - 1}`]: { $exists: false } }
    );
    if (!saved) return `⚠️ The shop can hold up to ${SHOP.maxRoles} roles. Remove one first.`;
    return `✅ <@&${roleId}> is for sale: ${price.toLocaleString()} coins, ${durationDays ? `${durationDays} day${durationDays === 1 ? '' : 's'}` : 'permanent'}`;
}

async function saveRate(interaction) {
    const min = parseWholeNumber(interaction.fields.getTextInputValue('min'));
    const max = parseWholeNumber(interaction.fields.getTextInputValue('max'));
    const cooldown = parseWholeNumber(interaction.fields.getTextInputValue('cooldown'));

    if ([min, max].some(v => v === null || v < 1 || v > 1000)) return '⚠️ XP amounts must be whole numbers from 1 to 1000.';
    if (min > max) return '⚠️ The minimum XP can\'t be more than the maximum.';
    if (cooldown === null || cooldown > 3600) return '⚠️ The cooldown must be a whole number of seconds from 0 to 3600.';

    await save(interaction, { $set: {
        'settings.leveling.xpMin': min,
        'settings.leveling.xpMax': max,
        'settings.leveling.cooldownSeconds': cooldown,
    } });
    return `✅ Members now earn ${min}–${max} XP, at most once every ${cooldown}s`;
}

async function saveLevelRole(interaction) {
    const level = parseWholeNumber(interaction.fields.getTextInputValue('level'));
    if (level === null || level < 1 || level > 1000) return '⚠️ The level must be a whole number from 1 to 1000.';

    const roleId = interaction.fields.getSelectedRoles('role', true).first().id;
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role || role.id === interaction.guild.id) return '⚠️ Choose a regular role (not @everyone).';
    if (role.managed) return `⚠️ <@&${roleId}> is managed by an integration and can't be given out.`;
    if (!role.editable) return `⚠️ <@&${roleId}> is above my highest role. Move my role above it in Server Settings → Roles.`;

    // One role per level and one level per role: replace any existing entry for either
    await save(interaction, { $pull: { 'settings.leveling.levelRoles': { $or: [{ level }, { roleId }] } } });
    // The cap is part of the write itself, so two admins adding at once can't go over it
    const saved = await updateGuildSettings(
        interaction.guildId,
        { $push: { 'settings.leveling.levelRoles': { $each: [{ level, roleId }], $sort: { level: 1 } } } },
        { [`settings.leveling.levelRoles.${MAX_LEVEL_ROLES - 1}`]: { $exists: false } }
    );
    if (!saved) return `⚠️ You can have up to ${MAX_LEVEL_ROLES} level roles. Remove one first.`;
    return `✅ Members get <@&${roleId}> at level ${level}`;
}

module.exports = { openPanel, handleInteraction };
