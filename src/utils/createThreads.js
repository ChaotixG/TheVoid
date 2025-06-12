// src/utils/createThreads.js
const { log, info, error } = require("../services/logger")
const {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ChannelType
} = require('discord.js');
const { ThreadAutoArchiveDuration } = require('discord.js');

/**
 * Creates either a ForumChannel post or a private TextChannel thread, then
 * sends the embed + buttons inside it. This function does NOT reply to the modal.
 *
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').ModalSubmitInteraction} interaction  The original modal submit interaction
 * @param {{ title: string, description: string }} modalResults
 * @param {string} channelId  The ID of either a ForumChannel or a TextChannel
 */
async function createThread(client, interaction, modalResults, channelId) {

  const title       = modalResults.title       || 'Untitled Thread';
  const description = modalResults.description || 'No description provided.';

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      error("❌ Channel not found: ", channelId);
      return;
    }

    // Build the embed + button row
    const threadEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: `Created by ${interaction.user.tag}` });

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('archive_ticket')
        .setLabel('Archive Ticket')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('delete_ticket')
        .setLabel('Delete Ticket')
        .setStyle(ButtonStyle.Danger)
        // Only the guild owner can delete:
        .setDisabled(interaction.guild.ownerId !== interaction.user.id)
    );

    // ──────────────────────────────────────────────────────────────────
    // CASE A: ForumChannel → create a “forum post” in one API call:
    // ──────────────────────────────────────────────────────────────────
    if (channel.type === ChannelType.GuildForum) {
      const thread = await channel.threads.create({
        name: title,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        invitable: true,
        // In a ForumChannel, you must give the initial message payload here:
        message: {
          content: `<@${interaction.user.id}>`,
          embeds: [threadEmbed],
          components: [actionRow]
        },
        appliedTags: [] // ← optional: supply an array of Tag IDs if you want to pre‐tag the post
      });
      info(`Forum post created: ${thread.id} (name="${thread.name}")`);
      return;
    }

    // ──────────────────────────────────────────────────────────────────
    // CASE B: Regular TextChannel (or Private Channel) → create a private thread:
    // ──────────────────────────────────────────────────────────────────
    if (channel.type === ChannelType.GuildText || channel.isTextBased()) {
      const thread = await channel.threads.create({
        name: title,
        type: 12, // PRIVATE_THREAD
        invitable: true,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek
      });
      info(`Thread created: ${thread.id} (name="${thread.name}")`);

      try {
        await thread.send({
          content: `<@${interaction.user.id}>`,
          embeds: [threadEmbed],
          components: [actionRow]
        });
        log("Message successfully sent into the thread.");
      } catch (err) {
        error("❌ thread.send() failed: ", err);
      }
      return;
    }

    error("❌ Unsupported channel type for ticket creation:", channel.type);
  } catch (err) {
    error("Error in createThread: ", err);
  }
}

module.exports = createThread;
