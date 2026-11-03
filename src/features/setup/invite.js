// When the bot joins a server, invite the people who can set it up to run /setup.
// The wizard itself runs privately inside the server: Discord's channel and role pickers can only
// list a server's channels/roles there, not in DMs. So the DM is an invitation with a jump link.
const { AuditLogEvent, ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { container, linkButton, row, separator } = require('../../utils/panels');
const { info, warn } = require('../../services/logger');

// The person who added the bot, from the audit log (needs View Audit Log; null if unavailable)
async function findInviterId(guild) {
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    try {
        const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
        return logs.entries.find(entry => entry.targetId === guild.client.user.id)?.executorId ?? null;
    } catch {
        return null;
    }
}

// Where to send people (and the fallback invite): the system channel, else the first text channel I can post in
function setupChannel(guild) {
    const canPost = (channel) => channel?.type === ChannelType.GuildText
        && channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
    if (canPost(guild.systemChannel)) return guild.systemChannel;
    return guild.channels.cache
        .filter(canPost)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first() ?? null;
}

// `mentionIds` set: the in-server version, which pings those people instead of DMing them
function invitePanel(guild, jumpUrl, mentionIds = null) {
    const inServer = Boolean(mentionIds);
    const greeting = inServer
        ? `## 👋 Thanks for adding me!\n${mentionIds.map(id => `<@${id}>`).join(' ')}, run **/setup** in any channel here`
        : `## 👋 Thanks for adding me to **${guild.name}**!\nOpen the server and run **/setup** in any channel`;
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container([
            `${greeting}; it walks you through roles, log channels, tickets, voice hubs and leveling in about a minute. ` +
            'Only you will see the setup.',
            separator(),
            inServer ? null : row(linkButton(jumpUrl, `Open ${guild.name}`.slice(0, 80), '🏠')),
            '-# Server admins can change everything later with **/settings**.',
        ], 0x5865F2)],
        allowedMentions: { users: mentionIds ?? [] },
    };
}

async function sendSetupInvites(guild) {
    const channel = setupChannel(guild);
    const jumpUrl = `https://discord.com/channels/${guild.id}${channel ? `/${channel.id}` : ''}`;

    const recipients = new Set([guild.ownerId]);
    const inviterId = await findInviterId(guild);
    if (inviterId) recipients.add(inviterId);

    let delivered = 0;
    for (const userId of recipients) {
        try {
            const user = await guild.client.users.fetch(userId);
            if (user.bot) continue;
            await user.send(invitePanel(guild, jumpUrl));
            delivered++;
        } catch {
            // DMs closed (or the user can't be reached); the in-server fallback covers it
        }
    }

    if (delivered) {
        info(`Sent setup invites for guild ${guild.id} to ${delivered} people by DM`);
        return;
    }

    // Nobody could be DM'd: post the invite in the server and ping those people instead
    if (!channel) {
        warn(`Could not send a setup invite for guild ${guild.id}: no DMs and no channel I can post in`);
        return;
    }
    await channel.send(invitePanel(guild, jumpUrl, [...recipients]));
    info(`Posted the setup invite for guild ${guild.id} in #${channel.name}`);
}

module.exports = { sendSetupInvites, setupChannel, findInviterId };
