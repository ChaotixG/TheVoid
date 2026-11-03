// Creating, identifying, archiving and deleting tickets.
const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelFlags,
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits,
    ThreadAutoArchiveDuration,
} = require('discord.js');
const { TRANSCRIPT_TAG_NAMES } = require('./types');
const { info } = require('../../services/logger');

// Delete buttons identify a ticket's first message (old tickets use the un-namespaced ID)
const DELETE_BUTTON_IDS = ['ticket:delete', 'delete_ticket'];
const TRANSCRIPT_PAGE_LIMIT = 50; // × 100 messages
const MAX_APPLIED_TAGS = 5; // Discord's limit per forum post

// Errors whose message is safe to show to the user as-is
class TicketError extends Error {}

/**
 * Tags for a new forum post: every tag whose name contains one of `preferredNames`.
 * If the forum requires a tag and none match, the first tag the bot may use.
 * Moderated tags can only be applied with Manage Threads, so they're skipped without it.
 * @param {import('discord.js').ForumChannel} forum
 */
function pickForumTags(forum, preferredNames = []) {
    const canUseModerated = forum.permissionsFor(forum.guild.members.me)?.has(PermissionFlagsBits.ManageThreads);
    const usable = forum.availableTags.filter(tag => !tag.moderated || canUseModerated);
    const matching = usable.filter(tag => preferredNames.some(name => tag.name.toLowerCase().includes(name)));
    if (matching.length) return matching.slice(0, MAX_APPLIED_TAGS).map(tag => tag.id);

    if (forum.flags?.has(ChannelFlags.RequireTag)) {
        if (!usable.length) {
            throw new TicketError(`<#${forum.id}> requires a tag on every post, but I'm not allowed to use any of its tags. Please tell an admin.`);
        }
        return [usable[0].id];
    }
    return [];
}

// Creates a forum post, tagged so it works even in forums that require tags
async function createForumPost(forum, { name, message, preferredTagNames }) {
    return forum.threads.create({
        name: name.slice(0, 100),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        message,
        appliedTags: pickForumTags(forum, preferredTagNames),
    });
}

/**
 * Creates a forum post or private thread for a ticket and posts its first message.
 * @returns {Promise<import('discord.js').ThreadChannel>}
 */
async function createTicket({ guild, user, type, values, target, staffRoleIds = [] }) {
    const channel = guild.channels.cache.get(target.channelId);
    if (!channel) throw new TicketError('The channel for this ticket type no longer exists. Please tell an admin.');

    const title = (values.title || 'Untitled ticket').slice(0, 100);
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setAuthor({ name: type.label })
        .setTitle(title)
        .setDescription(values.description || 'No description provided.')
        .setFooter({ text: `Created by ${user.tag}` })
        .setTimestamp();

    // Optional user picked in the complaint form
    if (values.reportedUserIds?.length) {
        embed.addFields({ name: 'Reported user', value: values.reportedUserIds.map(id => `<@${id}>`).join(', ') });
    }

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:archive').setLabel('Archive Ticket').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket:delete').setLabel('Delete Ticket').setStyle(ButtonStyle.Danger),
    );

    // Starts with the creator's mention (that's how the creator is recognized later).
    // Mentioning the staff roles pings them and, in a private thread, adds them to it.
    const staffRoles = staffRoleIds.filter(id => guild.roles.cache.has(id));
    const firstMessage = {
        content: [`<@${user.id}>`, ...staffRoles.map(id => `<@&${id}>`)].join(' '),
        embeds: [embed],
        components: [buttons],
        allowedMentions: { users: [user.id], roles: staffRoles },
    };

    if (channel.type === ChannelType.GuildForum) {
        const thread = await createForumPost(channel, { name: title, message: firstMessage, preferredTagNames: type.tagNames });
        info(`Ticket forum post created: ${thread.id} in guild ${guild.id}`);
        return thread;
    }

    if (channel.type === ChannelType.GuildText) {
        const thread = await channel.threads.create({
            name: title,
            type: ChannelType.PrivateThread,
            invitable: true,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        });
        await thread.send(firstMessage);
        await thread.members.add(user.id); // the mention usually adds them; make sure
        info(`Ticket thread created: ${thread.id} in guild ${guild.id}`);
        return thread;
    }

    throw new TicketError('The channel for this ticket type can\'t hold tickets. Please tell an admin.');
}

/**
 * Finds the bot's ticket message in a thread. Returns null when the thread isn't a ticket.
 * @param {import('discord.js').ThreadChannel} thread
 */
async function getTicketInfo(thread) {
    if (!thread?.isThread()) return null;
    const oldest = await thread.messages.fetch({ after: '0', limit: 10 });
    const ticketMessage = [...oldest.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .find(m => m.author.id === thread.client.user.id && hasDeleteButton(m));
    if (!ticketMessage) return null;
    return { creatorId: creatorFromMessage(ticketMessage) };
}

function hasDeleteButton(message) {
    return message.components.some(row => row.components?.some(c => DELETE_BUTTON_IDS.includes(c.customId)));
}

const creatorFromMessage = (message) => message.content.match(/^<@!?(\d+)>/)?.[1] ?? null;

// Creator, staff roles, or anyone who can manage threads
function canManageTicket(interaction, creatorId, staffRoleIds = []) {
    return interaction.user.id === creatorId
        || interaction.memberPermissions.has(PermissionFlagsBits.ManageThreads)
        || interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
        || staffRoleIds.some(id => interaction.member.roles.cache.has(id));
}

async function archiveTicket(thread, user) {
    await thread.setArchived(true, `Archived by ${user.tag}`);
    info(`Ticket ${thread.id} archived by ${user.tag}`);
}

/**
 * Posts a transcript (when configured) and deletes the ticket. If the transcript can't be
 * saved, the ticket is kept so nothing is lost.
 */
async function deleteTicket(thread, user, { transcriptChannelId, creatorId }) {
    if (transcriptChannelId) {
        const logChannel = thread.guild.channels.cache.get(transcriptChannelId);
        const isForum = logChannel?.type === ChannelType.GuildForum;
        if (!logChannel || (!isForum && !logChannel.isTextBased())) {
            throw new TicketError('The transcript channel no longer exists, so the ticket was kept. An admin can fix this in /settings → Tickets.');
        }
        const { file, count } = await buildTranscript(thread, user);
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`Ticket deleted: ${thread.name}`.slice(0, 256))
            .addFields(
                { name: 'Opened by', value: creatorId ? `<@${creatorId}>` : 'unknown', inline: true },
                { name: 'Deleted by', value: `<@${user.id}>`, inline: true },
                { name: 'Messages', value: String(count), inline: true },
            )
            .setTimestamp();
        const message = { embeds: [embed], files: [file], allowedMentions: { parse: [] } };
        try {
            // A forum gets one post per transcript; a text channel gets a message
            if (isForum) {
                await createForumPost(logChannel, { name: `Transcript: ${thread.name}`, message, preferredTagNames: TRANSCRIPT_TAG_NAMES });
            } else {
                await logChannel.send(message);
            }
        } catch (err) {
            if (err instanceof TicketError) throw err;
            throw new TicketError(`I couldn't post the transcript in <#${transcriptChannelId}> (${err.message}), so the ticket was kept.`);
        }
    }

    await thread.delete(`Deleted by ${user.tag}`);
    info(`Ticket ${thread.id} deleted by ${user.tag}`);
}

async function buildTranscript(thread, closedBy) {
    const lines = [
        `Ticket: ${thread.name}`,
        `Channel: #${thread.parent?.name ?? 'unknown'}`,
        `Created: ${thread.createdAt?.toISOString() ?? 'unknown'}`,
        `Deleted by: ${closedBy.tag} at ${new Date().toISOString()}`,
        '',
    ];

    let after = '0';
    let count = 0;
    for (let page = 0; page < TRANSCRIPT_PAGE_LIMIT; page++) {
        const batch = await thread.messages.fetch({ limit: 100, after, cache: false });
        if (!batch.size) break;
        const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        for (const message of sorted) lines.push(formatMessage(message));
        count += batch.size;
        after = sorted.at(-1).id;
        if (batch.size < 100) break;
    }

    const file = new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `transcript-${thread.id}.txt` });
    return { file, count };
}

function formatMessage(message) {
    const time = message.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const parts = [message.content];
    for (const embed of message.embeds) {
        parts.push([embed.title, embed.description, ...embed.fields.map(f => `${f.name}: ${f.value}`)].filter(Boolean).join(' | '));
    }
    for (const attachment of message.attachments.values()) parts.push(`[attachment] ${attachment.url}`);
    return `[${time}] ${message.author.tag}: ${parts.filter(Boolean).join('\n    ')}`;
}

module.exports = {
    TicketError,
    createTicket,
    getTicketInfo,
    creatorFromMessage,
    canManageTicket,
    archiveTicket,
    deleteTicket,
};
