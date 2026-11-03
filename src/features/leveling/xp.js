// Message XP, level-up announcements and level roles.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { randomInt } = require('crypto');
const Member = require('../../models/Member');
const { getGuildSettings } = require('../../services/guildSettings');
const { levelFromTotalXp } = require('../../utils/leveling');
const { warn } = require('../../services/logger');

const cooldowns = new Map(); // `${guildId}:${userId}` → time (ms) when XP can be earned again

// Drop expired cooldowns now and then so the map doesn't grow forever
setInterval(() => {
    const now = Date.now();
    for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
}, 10 * 60_000).unref();

/** @param {import('discord.js').Message} message */
async function grantMessageXp(message) {
    const guildId = message.guildId;
    const userId = message.author.id;
    const { leveling } = await getGuildSettings(guildId);
    if (!leveling.enabled) return;

    // No-XP list may contain the channel, its parent channel (for threads) or its category
    const channel = message.channel;
    const scope = [channel.id, channel.parentId, channel.parent?.parentId];
    if (scope.some(id => id && leveling.noXpChannelIds.includes(id))) return;

    const key = `${guildId}:${userId}`;
    const now = Date.now();
    if ((cooldowns.get(key) ?? 0) > now) return;
    cooldowns.set(key, now + leveling.cooldownSeconds * 1000);

    const min = Math.min(leveling.xpMin, leveling.xpMax);
    const max = Math.max(leveling.xpMin, leveling.xpMax);
    const gain = randomInt(min, max + 1);

    // Atomic increment; creates the member on their first message
    const member = await Member.findOneAndUpdate(
        { guildId, userId },
        { $inc: { totalXp: gain } },
        { upsert: true, returnDocument: 'after', projection: { totalXp: 1 } }
    ).lean();

    // Level is derived from total XP, so exactly one message ever crosses each threshold
    const newLevel = levelFromTotalXp(member.totalXp);
    if (newLevel <= levelFromTotalXp(member.totalXp - gain)) return;

    const guildMember = message.member ?? await message.guild.members.fetch(userId).catch(() => null);
    const newRoleIds = await applyLevelRoles(guildMember, newLevel, leveling);
    await announceLevelUp(message, newLevel, newRoleIds, leveling);
}

/**
 * Gives the member every level role they've earned (or only the highest one when
 * keepLowerRoles is off). Returns the role IDs added now, for the announcement.
 * @param {import('discord.js').GuildMember | null} member
 */
async function applyLevelRoles(member, level, leveling) {
    if (!member || !leveling.levelRoles.length) return [];
    const guild = member.guild;
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) return [];

    const earned = leveling.levelRoles.filter(r => r.level <= level);
    if (!earned.length) return [];

    const topLevel = Math.max(...earned.map(r => r.level));
    const wanted = new Set((leveling.keepLowerRoles ? earned : earned.filter(r => r.level === topLevel)).map(r => r.roleId));
    // role.editable: the role exists and sits below the bot's highest role
    const manageable = (id) => guild.roles.cache.get(id)?.editable;

    const toAdd = [...wanted].filter(id => !member.roles.cache.has(id) && manageable(id));
    const toRemove = leveling.keepLowerRoles ? [] : earned
        .map(r => r.roleId)
        .filter(id => !wanted.has(id) && member.roles.cache.has(id) && manageable(id));

    try {
        if (toAdd.length) await member.roles.add(toAdd, `Reached level ${level}`);
        if (toRemove.length) await member.roles.remove(toRemove, `Replaced by level ${level} role`);
    } catch (err) {
        warn(`Could not update level roles in guild ${guild.id}: ${err.message}`);
        return [];
    }
    return toAdd;
}

async function announceLevelUp(message, level, newRoleIds, leveling) {
    if (leveling.announce === 'off') return;

    let text = `<@${message.author.id}> reached **level ${level}**!`;
    if (newRoleIds.length) text += `\nNew role: ${newRoleIds.map(id => `<@&${id}>`).join(', ')}`;

    const embed = new EmbedBuilder()
        .setColor('#5a4786')
        .setTitle('Level Up!')
        .setDescription(text);

    try {
        const target = leveling.announce === 'channel'
            ? message.guild.channels.cache.get(leveling.announceChannelId)
            : null;

        if (target?.isTextBased()) {
            await target.send({ content: `<@${message.author.id}>`, embeds: [embed], allowedMentions: { users: [message.author.id] } });
        } else {
            // 'same', or the configured channel no longer exists
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: true } });
        }
    } catch (err) {
        warn(`Could not announce level-up in guild ${message.guildId}: ${err.message}`);
    }
}

module.exports = { grantMessageXp, applyLevelRoles };
