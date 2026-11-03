// XP from chatting and voice activity, level-up announcements and level roles.
// XP is per server (each server's leveling settings); coins go to the global wallet.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { randomInt } = require('crypto');
const Member = require('../../models/Member');
const { getGuildSettings } = require('../../services/guildSettings');
const { isPremium } = require('../../services/premium');
const { grantChatCoins } = require('../economy/rewards');
const { levelFromTotalXp } = require('../../utils/leveling');
const { PREMIUM } = require('../../config/economy');
const { warn } = require('../../services/logger');

const cooldowns = new Map(); // `${guildId}:${userId}` → time (ms) when chat XP can be earned again

// Drop expired cooldowns now and then so the map doesn't grow forever
setInterval(() => {
    const now = Date.now();
    for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
}, 10 * 60_000).unref();

// No-earn list may contain the channel, its parent channel (for threads) or its category
function earnsInChannel(channel, leveling) {
    const scope = [channel.id, channel.parentId, channel.parent?.parentId];
    return !scope.some(id => id && leveling.noXpChannelIds.includes(id));
}

async function rollXp(client, userId, leveling) {
    const min = Math.min(leveling.xpMin, leveling.xpMax);
    const max = Math.max(leveling.xpMin, leveling.xpMax);
    const premium = await isPremium(client, userId);
    return Math.round(randomInt(min, max + 1) * (premium ? PREMIUM.xpMultiplier : 1));
}

/** @param {import('discord.js').Message} message */
async function grantMessageXp(message) {
    const guildId = message.guildId;
    const userId = message.author.id;
    const { leveling } = await getGuildSettings(guildId);
    if (!earnsInChannel(message.channel, leveling)) return;

    // Coins are global and have their own (global) cooldown
    await grantChatCoins(message.client, userId);

    if (!leveling.enabled) return;
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    if ((cooldowns.get(key) ?? 0) > now) return;
    cooldowns.set(key, now + leveling.cooldownSeconds * 1000);

    await addXp({
        guild: message.guild,
        userId,
        member: message.member ?? await message.guild.members.fetch(userId).catch(() => null),
        amount: await rollXp(message.client, userId, leveling),
        leveling,
        reply: (payload) => message.reply(payload),
    });
}

/** XP for one voice-activity interval; `channel` is the voice channel they're active in. */
async function grantVoiceXp(member, channel) {
    const { leveling } = await getGuildSettings(member.guild.id);
    if (!leveling.enabled || !earnsInChannel(channel, leveling)) return;
    await addXp({
        guild: member.guild,
        userId: member.id,
        member,
        amount: await rollXp(member.client, member.id, leveling),
        leveling,
        here: channel, // a voice channel's text chat
    });
}

/**
 * Adds XP atomically. Because the level is derived from total XP, exactly one gain ever crosses
 * each threshold, so a level-up is announced once even with chat and voice at the same time.
 */
async function addXp({ guild, userId, member, amount, leveling, reply = null, here = null }) {
    const record = await Member.findOneAndUpdate(
        { guildId: guild.id, userId },
        { $inc: { totalXp: amount } },
        { upsert: true, returnDocument: 'after', projection: { totalXp: 1 } }
    ).lean();

    const newLevel = levelFromTotalXp(record.totalXp);
    if (newLevel <= levelFromTotalXp(record.totalXp - amount)) return null;

    const newRoleIds = await applyLevelRoles(member, newLevel, leveling);
    await announceLevelUp({ guild, userId, level: newLevel, newRoleIds, leveling, reply, here });
    return newLevel;
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

// Announces in the level-up channel if one is set; otherwise replies to the message (chat)
// or posts in the voice channel's chat (voice)
async function announceLevelUp({ guild, userId, level, newRoleIds, leveling, reply, here }) {
    if (leveling.announce === 'off') return;

    let text = `<@${userId}> reached **level ${level}**!`;
    if (newRoleIds.length) text += `\nNew role: ${newRoleIds.map(id => `<@&${id}>`).join(', ')}`;
    const embed = new EmbedBuilder().setColor('#5a4786').setTitle('Level Up!').setDescription(text);
    const mention = { content: `<@${userId}>`, embeds: [embed], allowedMentions: { users: [userId] } };

    try {
        const target = leveling.announce === 'channel' ? guild.channels.cache.get(leveling.announceChannelId) : null;
        if (target?.isTextBased()) await target.send(mention);
        else if (reply) await reply({ embeds: [embed], allowedMentions: { repliedUser: true } });
        else if (here?.isTextBased()) await here.send(mention);
    } catch (err) {
        warn(`Could not announce level-up in guild ${guild.id}: ${err.message}`);
    }
}

module.exports = { grantMessageXp, grantVoiceXp, addXp, applyLevelRoles };
