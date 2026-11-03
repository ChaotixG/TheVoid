// Temporary voice channels ("hubs"): join a hub → get your own channel; deleted once empty.
// State lives in the TempVoiceChannel collection (survives restarts); `active` mirrors it for
// quick lookups and holds each channel's pending empty-check timer.
const { ChannelType, OverwriteType, PermissionFlagsBits: P } = require('discord.js');
const TempVoiceChannel = require('../../models/TempVoiceChannel');
const Member = require('../../models/Member');
const { getGuildSettings } = require('../../services/guildSettings');
const { voicePanel } = require('./view');
const { info, warn, error } = require('../../services/logger');

const EMPTY_GRACE_MS = 5_000; // an empty channel is deleted after this long
const UNKNOWN_CHANNEL = 10003; // Discord API error code

const active = new Map(); // channelId → { guildId, ownerId, timer }
const creating = new Set(); // `${guildId}:${userId}` while their channel is being created

// ─── Permissions (same sets as before; STAFF applies to the configured moderator roles) ──
const EVERYONE = {
    allow: [P.UseEmbeddedActivities, P.UseExternalStickers, P.UseSoundboard, P.UseExternalApps, P.ReadMessageHistory, P.EmbedLinks, P.Stream, P.AddReactions, P.UseApplicationCommands, P.ViewChannel, P.Connect, P.Speak, P.UseVAD, P.SendMessages, P.AttachFiles, P.SendMessagesInThreads, P.UseExternalEmojis],
    deny: [P.SendPolls, P.ManageRoles, P.ManageEvents, P.ManageWebhooks, P.CreateEvents, P.UseExternalSounds, P.SendTTSMessages, P.SendVoiceMessages, P.ManageChannels, P.CreateInstantInvite, P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.PrioritySpeaker, P.ManageMessages, P.MentionEveryone],
};
const STAFF = {
    allow: [P.SendPolls, P.UseEmbeddedActivities, P.UseExternalStickers, P.UseSoundboard, P.UseExternalApps, P.ReadMessageHistory, P.EmbedLinks, P.Stream, P.AddReactions, P.UseApplicationCommands, P.ViewChannel, P.Connect, P.Speak, P.UseVAD, P.SendMessages, P.AttachFiles, P.SendMessagesInThreads, P.UseExternalEmojis, P.ManageChannels, P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.ManageMessages],
    deny: [P.ManageRoles, P.ManageEvents, P.ManageWebhooks, P.CreateEvents, P.UseExternalSounds, P.SendTTSMessages, P.SendVoiceMessages, P.CreateInstantInvite, P.PrioritySpeaker, P.MentionEveryone],
};
const OWNER = {
    allow: [P.SendPolls, P.UseEmbeddedActivities, P.UseSoundboard, P.UseExternalApps, P.ReadMessageHistory, P.EmbedLinks, P.Stream, P.AddReactions, P.UseApplicationCommands, P.ViewChannel, P.Connect, P.Speak, P.UseVAD, P.SendMessages, P.AttachFiles, P.SendMessagesInThreads, P.UseExternalEmojis, P.ManageChannels, P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.ManageMessages],
    deny: [P.ManageRoles, P.ManageEvents, P.ManageWebhooks, P.CreateEvents, P.UseExternalSounds, P.SendTTSMessages, P.SendVoiceMessages, P.CreateInstantInvite, P.PrioritySpeaker, P.MentionEveryone, P.UseExternalStickers],
};

// Moderator roles from settings; falls back to a role named "mod" (the old hard-coded behavior)
function modRoleIdsFor(guild, modRoleIds = []) {
    const configured = modRoleIds.filter(id => guild.roles.cache.has(id));
    if (configured.length) return configured;
    const legacy = guild.roles.cache.find(role => role.name === 'mod');
    return legacy ? [legacy.id] : [];
}

// What the bot itself needs in the channel. Without this, the @everyone denies above would also
// apply to the bot and it couldn't rename, lock, move people or delete the channel.
const BOT = {
    allow: [P.ViewChannel, P.Connect, P.ManageChannels, P.ManageRoles, P.MoveMembers, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory],
    deny: [],
};

function buildOverwrites(guild, ownerId, modRoleIds, { locked = false } = {}) {
    const me = guild.members.me;
    // Discord rejects overwrites that allow or deny a permission the bot doesn't have itself
    const grantable = ({ allow, deny }) => ({
        allow: allow.filter(p => me.permissions.has(p)),
        deny: deny.filter(p => me.permissions.has(p)),
    });

    return [
        {
            id: guild.id,
            type: OverwriteType.Role,
            ...grantable({
                allow: locked ? EVERYONE.allow.filter(p => p !== P.Connect) : EVERYONE.allow,
                deny: locked ? [...EVERYONE.deny, P.Connect] : EVERYONE.deny,
            }),
        },
        ...modRoleIdsFor(guild, modRoleIds).map(id => ({ id, type: OverwriteType.Role, ...grantable(STAFF) })),
        ownerId && ownerId !== me.id && { id: ownerId, type: OverwriteType.Member, ...grantable(OWNER) },
        { id: me.id, type: OverwriteType.Member, ...grantable(BOT) },
    ].filter(Boolean);
}

const isLocked = (channel) => channel.permissionOverwrites.cache.get(channel.guild.id)?.deny.has(P.Connect) ?? false;

// ─── Lifecycle ────────────────────────────────────────────────
async function handleVoiceStateUpdate(oldState, newState) {
    // Mute/deafen/stream changes also fire this event; only act when the member changes channel
    if (oldState.channelId === newState.channelId) return;

    // Always check the channel they left, even while their new channel is being created
    if (oldState.channelId && active.has(oldState.channelId)) scheduleEmptyCheck(oldState.guild, oldState.channelId);

    const hub = newState.channel;
    const member = newState.member;
    if (!hub || !member || member.user.bot) return;

    const { voiceHubs, modRoleIds } = await getGuildSettings(newState.guild.id);
    if (!voiceHubs.some(h => h.channelId === hub.id)) return;

    const key = `${newState.guild.id}:${member.id}`;
    if (creating.has(key)) return;
    creating.add(key);
    try {
        await createTempChannel(member, hub, modRoleIds);
    } finally {
        creating.delete(key);
    }
}

async function createTempChannel(member, hub, modRoleIds) {
    const guild = member.guild;
    const saved = await Member.findOne({ guildId: guild.id, userId: member.id }, { voiceChannelName: 1 }).lean();
    const name = (saved?.voiceChannelName || `${member.displayName}'s Chat`).slice(0, 100);

    const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: hub.parentId ?? undefined,
        bitrate: 64000,
        permissionOverwrites: buildOverwrites(guild, member.id, modRoleIds),
        reason: `Voice hub channel for ${member.user.tag}`,
    });
    active.set(channel.id, { guildId: guild.id, ownerId: member.id, timer: null });

    try {
        await TempVoiceChannel.create({ guildId: guild.id, channelId: channel.id, ownerId: member.id });
    } catch (err) {
        // Without a record it would never be cleaned up after a restart, so don't keep it
        active.delete(channel.id);
        await channel.delete('Could not save temporary channel').catch(() => {});
        throw err;
    }
    info(`Created voice channel "${channel.name}" for ${member.user.tag} in guild ${guild.id}`);

    // They may have left the hub already; the empty check below then removes the channel
    await member.voice.setChannel(channel).catch(() => {});
    scheduleEmptyCheck(guild, channel.id);

    try {
        const panel = await channel.send(voicePanel(channel, member.id, false));
        await TempVoiceChannel.updateOne({ channelId: channel.id }, { $set: { panelMessageId: panel.id } });
    } catch (err) {
        warn(`Could not post the voice panel in ${channel.id}: ${err.message}`);
    }
}

function scheduleEmptyCheck(guild, channelId) {
    const entry = active.get(channelId);
    if (!entry) return;
    // One pending check per channel; each leave restarts the grace period
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
        deleteIfEmpty(guild, channelId).catch(err => error(`Error cleaning up voice channel ${channelId}: `, err));
    }, EMPTY_GRACE_MS);
}

async function deleteIfEmpty(guild, channelId) {
    const entry = active.get(channelId);
    if (!entry || entry.deleting) return;
    const channel = guild.channels.cache.get(channelId);
    if (channel && channel.members.size > 0) return;

    entry.deleting = true;
    try {
        if (channel) {
            await channel.delete('Temporary voice channel is empty').catch(err => {
                if (err.code !== UNKNOWN_CHANNEL) throw err;
            });
        }
    } catch (err) {
        // Keep tracking it so the next empty check (or the next startup) tries again
        entry.deleting = false;
        warn(`Could not delete empty voice channel ${channel?.name ?? channelId} in guild ${guild.id}: ${err.message}`);
        return;
    }

    active.delete(channelId);
    await TempVoiceChannel.deleteOne({ channelId });
    info(`Deleted empty voice channel ${channel?.name ?? channelId}`);
}

// Someone deleted a temp channel by hand
async function forgetChannel(channelId) {
    const entry = active.get(channelId);
    if (!entry) return;
    clearTimeout(entry.timer);
    active.delete(channelId);
    await TempVoiceChannel.deleteOne({ channelId });
}

// On startup: pick up channels from before the restart; delete the ones that emptied meanwhile
async function rehydrate(client) {
    const docs = await TempVoiceChannel.find({ guildId: { $in: [...client.guilds.cache.keys()] } }).lean();
    let restored = 0;
    let removed = 0;

    for (const doc of docs) {
        const guild = client.guilds.cache.get(doc.guildId);
        if (!guild?.available) continue; // during an outage the channel cache is incomplete

        // One channel failing (e.g. missing permissions in that server) must not stop the rest
        try {
            const channel = guild.channels.cache.get(doc.channelId);
            if (!channel) {
                await TempVoiceChannel.deleteOne({ channelId: doc.channelId });
                removed++;
                continue;
            }

            active.set(channel.id, { guildId: guild.id, ownerId: doc.ownerId, timer: null });
            if (channel.members.size === 0) {
                await deleteIfEmpty(guild, channel.id);
                if (!active.has(channel.id)) removed++;
            } else {
                restored++;
            }
        } catch (err) {
            error(`Error restoring voice channel ${doc.channelId} in guild ${doc.guildId}: `, err);
        }
    }
    info(`Voice channels: ${restored} restored, ${removed} cleaned up`);
}

// Ownership changes are conditional on the current owner, so two people can't both win a claim
async function setOwner(channel, fromId, toId, modRoleIds) {
    const updated = await TempVoiceChannel.findOneAndUpdate(
        { channelId: channel.id, ownerId: fromId },
        { $set: { ownerId: toId } },
        { returnDocument: 'after' }
    );
    if (!updated) return false;

    const entry = active.get(channel.id);
    if (entry) entry.ownerId = toId;
    await channel.permissionOverwrites.set(buildOverwrites(channel.guild, toId, modRoleIds, { locked: isLocked(channel) }));
    return true;
}

async function setLocked(channel, ownerId, modRoleIds, locked) {
    await channel.permissionOverwrites.set(buildOverwrites(channel.guild, ownerId, modRoleIds, { locked }));
}

// Owner from memory (kept in sync by setOwner), so the panel can answer without a database round trip.
// Returns undefined for channels this bot doesn't manage.
function trackedOwner(channelId) {
    const entry = active.get(channelId);
    return entry ? entry.ownerId : undefined;
}

module.exports = {
    trackedOwner,
    handleVoiceStateUpdate,
    forgetChannel,
    rehydrate,
    setOwner,
    setLocked,
    isLocked,
    modRoleIdsFor,
};
