// Shared checks and logging for /ban, /kick and /timeout.
const { EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('../../services/guildSettings');
const { warn } = require('../../services/logger');

const ACTIONS = {
    ban: { title: '🔨 Member banned', color: 0xED4245 },
    kick: { title: '👢 Member kicked', color: 0xFEE75C },
    timeout: { title: '⏳ Member timed out', color: 0xF0B232 },
    untimeout: { title: '✅ Timeout removed', color: 0x57F287 },
};

/**
 * Why the moderator can't act on `target`, or null if they can.
 * Moderators can only act on members whose highest role is below theirs (the owner can act on anyone).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').GuildMember} target
 */
function hierarchyProblem(interaction, target) {
    const guild = interaction.guild;
    if (target.id === interaction.user.id) return 'You can\'t do that to yourself.';
    if (target.id === guild.ownerId) return 'The server owner can\'t be moderated.';
    if (target.id === interaction.client.user.id) return 'I can\'t do that to myself.';
    if (interaction.user.id !== guild.ownerId && target.roles.highest.comparePositionTo(interaction.member.roles.highest) >= 0) {
        return `<@${target.id}> has a role equal to or higher than yours.`;
    }
    return null;
}

// Best effort: many members don't accept DMs
async function notifyUser(user, text) {
    await user.send(text).catch(() => {});
}

async function logModAction(guild, { action, target, moderator, reason, details }) {
    const { moderation } = await getGuildSettings(guild.id);
    const channel = moderation.logChannelId ? guild.channels.cache.get(moderation.logChannelId) : null;
    if (!channel?.isTextBased()) return;

    const { title, color } = ACTIONS[action];
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .addFields(
            { name: 'Member', value: `<@${target.id}> (${target.tag}, ${target.id})` },
            { name: 'Moderator', value: `<@${moderator.id}>`, inline: true },
            ...(details ? [{ name: 'Details', value: details, inline: true }] : []),
            { name: 'Reason', value: reason },
        )
        .setTimestamp();

    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
        .catch(err => warn(`Could not write to the mod log in guild ${guild.id}: ${err.message}`));
}

module.exports = { hierarchyProblem, notifyUser, logModAction };
