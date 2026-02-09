// src/events/interactionCreate/handleButtons.js
const { error, log } = require("../../services/logger");

module.exports = async (client, interaction) => {
  if (!interaction.isButton()) return;

  try {
    const thread = interaction.channel;

    // ────────────────────────────────────────────────
    // Get creator ID reliably using fetchStarterMessage()
    // ────────────────────────────────────────────────
    let creatorId = null;
    try {
      const starterMessage = await thread.fetchStarterMessage({ cache: false });
      if (starterMessage) {
        const mentionMatch = starterMessage.content?.match(/<@(\d+)>/);
        creatorId = mentionMatch ? mentionMatch[1] : null;
      }
    } catch (fetchErr) {
      error("Failed to fetch starter message for creator check:", fetchErr);
      // Continue anyway – we'll treat as no creator match
    }

    const isCreator = creatorId && interaction.user.id === creatorId;
    const hasManageThreads = interaction.member.permissions.has("MANAGE_THREADS");

    if (interaction.customId === "archive_ticket") {
      await interaction.deferUpdate().catch(() => {}); // Defer only here

      if (!isCreator && !hasManageThreads) {
        return interaction.followUp({
          content: "You do not have permission to archive this ticket.",
          ephemeral: true,
        }).catch(() => {});
      }

      await thread.setArchived(true, `Archived by ${interaction.user.tag}`);
      await interaction.followUp({
        content: "Ticket archived successfully.",
        ephemeral: true,
      }).catch(() => {});

      log(`Ticket archived by ${interaction.user.tag} in thread ${thread.id}`);
    } else if (interaction.customId === "delete_ticket") {
      await interaction.deferUpdate().catch(() => {}); // Defer only here

      if (interaction.guild.ownerId !== interaction.user.id) {
        return interaction.followUp({
          content: "Only the server owner can delete tickets.",
          ephemeral: true,
        }).catch(() => {});
      }

      await thread.delete(`Deleted by ${interaction.user.tag}`);
      log(`Ticket deleted by ${interaction.user.tag} in thread ${thread.id}`);
    }
    // For other buttons, do nothing - let other handlers (like collectors) manage them
  } catch (err) {
    error("Error handling button interaction:", err);
    await interaction.followUp({
      content: "An error occurred while processing this action.",
      ephemeral: true,
    }).catch(() => {});
  }
};