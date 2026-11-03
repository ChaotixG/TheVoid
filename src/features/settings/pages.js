// Renders each page of the /settings panel (and the /setup wizard) from the guild's settings.
// Custom IDs encode everything needed to handle a click, so the panel needs no session state.
const {
    ChannelSelectMenuBuilder,
    ChannelType,
    PermissionFlagsBits: P,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
} = require('discord.js');
const { separator, button, row, section, container, ButtonStyle } = require('../../utils/panels');

const ACCENT = 0x5865F2;

const TICKET_CATEGORIES = [
    { key: 'troubleshooting', label: 'Troubleshooting', emoji: '🛠️' },
    { key: 'suggestions', label: 'Suggestions', emoji: '💡' },
    { key: 'complaints', label: 'Complaints', emoji: '⚠️' },
];

const ANNOUNCE_OPTIONS = [
    { value: 'same', label: 'Reply to the message', description: 'Announce in the channel where they leveled up' },
    { value: 'channel', label: 'Post in one channel', description: 'All level-ups go to a channel you choose' },
    { value: 'off', label: "Don't announce", description: 'Level up silently' },
];

const MAX_LEVEL_ROLES = 25;
const MAX_ROLE_PICKS = 10;

// What each feature needs from the bot, for the permission check
const FEATURE_PERMISSIONS = [
    { name: '🔊 Voice hubs', permissions: [P.ManageChannels, P.MoveMembers, P.ManageRoles] },
    { name: '🎫 Tickets', permissions: [P.SendMessages, P.CreatePrivateThreads, P.SendMessagesInThreads, P.ManageThreads, P.ReadMessageHistory, P.AttachFiles] },
    { name: '🏅 Level roles', permissions: [P.ManageRoles] },
    { name: '🛡️ Moderation', permissions: [P.BanMembers, P.KickMembers, P.ModerateMembers] },
    { name: '👋 Setup messages', permissions: [P.ViewAuditLog] },
];

// ─── Helpers ──────────────────────────────────────────────────
// Only pre-select things that still exist; a deleted channel/role can't be a default value
const liveChannels = (guild, ids) => ids.filter(id => id && guild.channels.cache.has(id));
const liveRoles = (guild, ids) => ids.filter(id => id && guild.roles.cache.has(id));
const channelOrNone = (guild, id) => (id && guild.channels.cache.has(id) ? `<#${id}>` : '*not set*');
const rolesOrNone = (guild, ids) => (liveRoles(guild, ids).map(id => `<@&${id}>`).join(', ') || '*not set*');
const permissionNames = (names) => names.map(p => p.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ');

function missingPermissions(guild, permissions) {
    const missing = guild.members.me.permissions.missing(permissions);
    if (!missing.length) return null;
    return `⚠️ I'm missing the **${permissionNames(missing)}** permission${missing.length > 1 ? 's' : ''}, so this won't fully work yet.`;
}

function permissionReport(guild) {
    return FEATURE_PERMISSIONS.map(({ name, permissions }) => {
        const missing = guild.members.me.permissions.missing(permissions);
        return missing.length ? `⚠️ ${name} · missing ${permissionNames(missing)}` : `✅ ${name}`;
    }).join('\n');
}

function channelSelect(customId, { types, selected = [], min = 0, max = 1, placeholder }, guild) {
    const menu = new ChannelSelectMenuBuilder()
        .setCustomId(customId)
        .setChannelTypes(...types)
        .setMinValues(min)
        .setMaxValues(max)
        .setPlaceholder(placeholder);
    const defaults = liveChannels(guild, selected);
    if (defaults.length) menu.setDefaultChannels(...defaults);
    return menu;
}

function roleSelect(customId, selectedIds, placeholder, guild, max = 1) {
    const menu = new RoleSelectMenuBuilder()
        .setCustomId(customId)
        .setMinValues(0)
        .setMaxValues(max)
        .setPlaceholder(placeholder);
    const defaults = liveRoles(guild, selectedIds).slice(0, max);
    if (defaults.length) menu.setDefaultRoles(...defaults);
    return menu;
}

const header = (title, description, notice) => [
    `## ${title}\n${description}`,
    notice ? `-# ${notice}` : null,
];

// Footer for /settings pages; the /setup wizard passes its own (see wizardFooter)
const settingsFooter = () => [
    separator(),
    row(
        button('settings:nav:home', 'Back', ButtonStyle.Secondary, { emoji: '◀️' }),
        button('settings:close', 'Close', ButtonStyle.Secondary),
    ),
];

function summary(guild, s) {
    const lv = s.leveling;
    const ticketCount = TICKET_CATEGORIES.filter(c => s.tickets[c.key]?.channelId).length;
    return {
        server: `**🏠 Server**\nStaff: ${rolesOrNone(guild, s.staffRoleIds)} · Moderators: ${rolesOrNone(guild, s.modRoleIds)}`,
        voice: `**🔊 Voice hubs**\n${s.voiceHubs.length ? `${s.voiceHubs.length} hub${s.voiceHubs.length === 1 ? '' : 's'}` : 'No hubs yet'} · join a hub to get your own voice channel`,
        tickets: `**🎫 Tickets**\n${ticketCount}/3 ticket types set up · Transcripts: ${channelOrNone(guild, s.tickets.transcriptChannelId)}`,
        leveling: `**⭐ Leveling**\n${lv.enabled
            ? `On · ${lv.xpMin}–${lv.xpMax} XP every ${lv.cooldownSeconds}s · ${lv.levelRoles.length} level role${lv.levelRoles.length === 1 ? '' : 's'}`
            : 'Off'}`,
        moderation: `**🛡️ Moderation**\nLog channel: ${channelOrNone(guild, s.moderation.logChannelId)}`,
        economy: `**💰 Economy**\nDaily reward: ${s.economy.dailyAmount.toLocaleString()} coins`,
    };
}

// ─── Pages ────────────────────────────────────────────────────
function home(guild, s, notice) {
    const lines = summary(guild, s);
    return container([
        ...header('⚙️ Settings', `Configure the bot for **${guild.name}**. Changes save as soon as you make them.`, notice),
        separator(),
        ...['server', 'voice', 'tickets', 'leveling', 'moderation', 'economy']
            .map(page => section(lines[page], button(`settings:nav:${page}`, 'Manage'))),
        separator(),
        '-# New here? **/setup** walks you through everything step by step.',
        row(button('settings:close', 'Close')),
    ], ACCENT);
}

function server(guild, s, notice, footer = settingsFooter()) {
    // Moderation commands follow Discord's own permissions, so point out moderator roles that lack them
    const modsWithoutPowers = liveRoles(guild, s.modRoleIds)
        .filter(id => (guild.roles.cache.get(id).permissions?.missing([P.BanMembers, P.KickMembers, P.ModerateMembers]) ?? []).length);

    return container([
        ...header('🏠 Server', 'Tell me who\'s who on this server. Changes save as soon as you make them.', notice),
        separator(),
        '**👮 Staff roles** · handle tickets: they can archive and delete any ticket and get pinged on new ones',
        row(roleSelect('settings:server:staff', s.staffRoleIds, 'Not set · choose staff roles', guild, MAX_ROLE_PICKS)),
        '**🛡️ Moderator roles** · moderate voice hub channels (mute, move, lock, transfer). **/ban**, **/kick** and **/timeout** follow Discord\'s own permissions.',
        row(roleSelect('settings:server:mods', s.modRoleIds, 'Not set · choose moderator roles', guild, MAX_ROLE_PICKS)),
        modsWithoutPowers.length
            ? `-# ${modsWithoutPowers.map(id => `<@&${id}>`).join(', ')} can't use /ban, /kick or /timeout yet. Give ${modsWithoutPowers.length === 1 ? 'it' : 'them'} the Ban Members, Kick Members and Timeout Members permissions in Server Settings → Roles.`
            : null,
        separator(),
        `**🔍 Permission check**\n${permissionReport(guild)}\n-# My role must also sit above any role I hand out (level roles).`,
        ...footer,
    ], ACCENT);
}

function voice(guild, s, notice, footer = settingsFooter()) {
    return container([
        ...header('🔊 Voice hubs',
            'When someone joins a hub, I create a voice channel for them in the same category, move them in and post ' +
            'controls there (rename, user limit, lock, transfer). It\'s deleted once everyone leaves.', notice),
        missingPermissions(guild, [P.ManageChannels, P.MoveMembers, P.ManageRoles]),
        separator(),
        '**Hub channels** · add or remove hubs in this picker',
        row(channelSelect('settings:voice:hubs', {
            types: [ChannelType.GuildVoice],
            selected: s.voiceHubs.map(h => h.channelId),
            max: 25,
            placeholder: 'Choose voice channels to use as hubs',
        }, guild)),
        `-# Moderators (${rolesOrNone(guild, s.modRoleIds)}, set under 🏠 Server) can moderate everyone's channels.`,
        ...footer,
    ], ACCENT);
}

function tickets(guild, s, notice, footer = settingsFooter()) {
    return container([
        ...header('🎫 Tickets',
            'Members open tickets with **/ticket**. A text channel gets a private thread for each ticket; a forum gets a post, ' +
            'tagged by type when the forum has a matching tag (e.g. "Support", "Suggestion", "Complaint").', notice),
        missingPermissions(guild, FEATURE_PERMISSIONS.find(f => f.name.includes('Tickets')).permissions),
        separator(),
        ...TICKET_CATEGORIES.flatMap(cat => [
            `**${cat.emoji} ${cat.label}**`,
            row(channelSelect(`settings:tickets:target:${cat.key}`, {
                types: [ChannelType.GuildText, ChannelType.GuildForum],
                selected: [s.tickets[cat.key]?.channelId],
                placeholder: 'Not set · choose a text channel or forum',
            }, guild)),
        ]),
        separator(),
        '**📜 Transcripts** · a copy of each ticket is posted here before it\'s deleted (in a forum, one post per ticket)',
        row(transcriptSelect(guild, s)),
        `-# Staff (${rolesOrNone(guild, s.staffRoleIds)}, set under 🏠 Server) can manage every ticket and get pinged on new ones.`,
        ...footer,
    ], ACCENT);
}

const transcriptSelect = (guild, s) => channelSelect('settings:tickets:transcripts', {
    types: [ChannelType.GuildText, ChannelType.GuildForum],
    selected: [s.tickets.transcriptChannelId],
    placeholder: 'Not set · tickets are deleted without a copy',
}, guild);

const modLogSelect = (guild, s) => channelSelect('settings:mod:log', {
    types: [ChannelType.GuildText],
    selected: [s.moderation.logChannelId],
    placeholder: 'Not set · actions are not logged',
}, guild);

function leveling(guild, s, notice, footer = settingsFooter()) {
    const lv = s.leveling;
    // Capped at 25 because that's the most a select menu can list
    const roles = [...lv.levelRoles].sort((a, b) => a.level - b.level).slice(0, MAX_LEVEL_ROLES);

    const announce = new StringSelectMenuBuilder()
        .setCustomId('settings:lvl:announce')
        .addOptions(ANNOUNCE_OPTIONS.map(o => ({ ...o, default: o.value === lv.announce })));

    const removeRole = roles.length ? new StringSelectMenuBuilder()
        .setCustomId('settings:lvl:removerole')
        .setPlaceholder('Remove a level role…')
        .addOptions(roles.map(r => ({
            label: `Level ${r.level} → @${guild.roles.cache.get(r.roleId)?.name ?? 'deleted role'}`.slice(0, 100),
            value: String(r.level),
        }))) : null;

    const roleList = roles.length
        ? roles.map(r => `Level **${r.level}** → <@&${r.roleId}>`).join('\n')
        : 'None yet · add one to reward members automatically.';

    return container([
        ...header('⭐ Leveling', 'Members earn XP by chatting and level up over time. They can check it with **/rank** and **/leaderboard**.', notice),
        roles.length ? missingPermissions(guild, [P.ManageRoles]) : null,
        separator(),
        section(`**XP** · ${lv.enabled ? '🟢 On' : '🔴 Off'}`, lv.enabled
            ? button('settings:lvl:enabled:off', 'Turn off', ButtonStyle.Danger)
            : button('settings:lvl:enabled:on', 'Turn on', ButtonStyle.Success)),
        section(`**Rate** · ${lv.xpMin}–${lv.xpMax} XP per message, at most once every ${lv.cooldownSeconds}s`,
            button('settings:lvl:rate', 'Edit')),
        separator(),
        '**📣 Level-up messages**',
        row(announce),
        lv.announce === 'channel' ? row(channelSelect('settings:lvl:announcechan', {
            types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            selected: [lv.announceChannelId],
            min: 1,
            placeholder: 'Choose the level-up channel',
        }, guild)) : null,
        '**🚫 No-XP channels** · messages here earn nothing (a category covers every channel in it)',
        row(channelSelect('settings:lvl:noxp', {
            types: [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildForum, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice],
            selected: lv.noXpChannelIds,
            max: 25,
            placeholder: 'XP is earned everywhere',
        }, guild)),
        separator(),
        `**🏅 Level roles**\n${roleList}`,
        section(`Keep lower level roles when a higher one is earned: **${lv.keepLowerRoles ? 'Yes' : 'No'}**`, lv.keepLowerRoles
            ? button('settings:lvl:keeplower:no', 'Only keep highest')
            : button('settings:lvl:keeplower:yes', 'Keep all')),
        row(button('settings:lvl:addrole', 'Add level role', ButtonStyle.Success, { disabled: roles.length >= MAX_LEVEL_ROLES })),
        removeRole ? row(removeRole) : null,
        ...footer,
    ], ACCENT);
}

function moderation(guild, s, notice, footer = settingsFooter()) {
    return container([
        ...header('🛡️ Moderation',
            '**/ban**, **/kick** and **/timeout** respect role order: moderators can\'t act on members with an equal or higher role.', notice),
        missingPermissions(guild, [P.BanMembers, P.KickMembers, P.ModerateMembers]),
        separator(),
        '**📋 Log channel** · every moderation action is recorded here',
        row(modLogSelect(guild, s)),
        ...footer,
    ], ACCENT);
}

function economy(guild, s, notice, footer = settingsFooter()) {
    return container([
        ...header('💰 Economy', 'Members claim a daily reward with **/daily** (once every 24 hours) and check their coins with **/balance**.', notice),
        separator(),
        section(`**Daily reward** · ${s.economy.dailyAmount.toLocaleString()} coins`, button('settings:eco:daily', 'Edit')),
        ...footer,
    ], ACCENT);
}

function closed(message) {
    return container([message]);
}

// ─── /setup wizard ────────────────────────────────────────────
const WIZARD_STEPS = ['welcome', 'server', 'logs', 'tickets', 'voice', 'leveling', 'done'];
const NUMBERED_STEPS = WIZARD_STEPS.length - 2; // welcome and done aren't numbered

function wizardFooter(step) {
    const i = WIZARD_STEPS.indexOf(step);
    if (step === 'welcome') {
        return [separator(), row(
            button('settings:wiz:server', 'Start', ButtonStyle.Primary, { emoji: '▶️' }),
            button('settings:close', 'Not now'),
        )];
    }
    if (step === 'done') {
        return [separator(), row(
            button(`settings:wiz:${WIZARD_STEPS[i - 1]}`, 'Back', ButtonStyle.Secondary, { emoji: '◀️' }),
            button('settings:nav:home', 'Open settings', ButtonStyle.Primary),
            button('settings:close', 'Close'),
        )];
    }
    return [
        separator(),
        `-# Setup · step ${i} of ${NUMBERED_STEPS} · everything saves as you go, and you can skip any step`,
        row(
            button(`settings:wiz:${WIZARD_STEPS[i - 1]}`, 'Back', ButtonStyle.Secondary, { emoji: '◀️' }),
            button(`settings:wiz:${WIZARD_STEPS[i + 1]}`, i === NUMBERED_STEPS ? 'Finish' : 'Next', ButtonStyle.Primary, { emoji: '▶️' }),
            button('settings:close', 'Exit setup'),
        ),
    ];
}

function welcome(guild, s, notice, footer) {
    return container([
        `## 👋 Server setup\nLet's get **${guild.name}** ready. It takes about a minute, everything saves as you go, and you can skip any step.`,
        notice ? `-# ${notice}` : null,
        separator(),
        '1. 🏠 **Roles** · who is staff and who moderates\n2. 📋 **Log channels** · moderation log and ticket transcripts\n' +
        '3. 🎫 **Tickets** · where tickets go\n4. 🔊 **Voice hubs** · join-to-create voice channels\n5. ⭐ **Leveling** · XP, level-up messages and level roles',
        '-# You can change all of this later with **/settings**.',
        ...footer,
    ], ACCENT);
}

function logs(guild, s, notice, footer) {
    return container([
        ...header('📋 Log channels', 'Where I keep records. Both are optional.', notice),
        separator(),
        '**🛡️ Moderation log** · every /ban, /kick and /timeout is recorded here',
        row(modLogSelect(guild, s)),
        '**📜 Ticket transcripts** · a copy of each ticket is posted here before it\'s deleted (in a forum, one post per ticket)',
        row(transcriptSelect(guild, s)),
        ...footer,
    ], ACCENT);
}

function done(guild, s, notice, footer) {
    const lines = summary(guild, s);
    return container([
        `## ✅ Setup complete\nHere's how **${guild.name}** is set up.`,
        notice ? `-# ${notice}` : null,
        separator(),
        Object.values(lines).join('\n'),
        separator(),
        `**🔍 Permission check**\n${permissionReport(guild)}`,
        '-# Change anything later with **/settings**.',
        ...footer,
    ], ACCENT);
}

const WIZARD_PAGES = { welcome, server, logs, tickets, voice, leveling, done };

function renderWizardStep(step, guild, s, notice) {
    return WIZARD_PAGES[step](guild, s, notice, wizardFooter(step));
}

const PAGES = { home, server, voice, tickets, leveling, moderation, economy };

module.exports = { PAGES, WIZARD_STEPS, renderWizardStep, TICKET_CATEGORIES, ANNOUNCE_OPTIONS, MAX_LEVEL_ROLES, closed };
