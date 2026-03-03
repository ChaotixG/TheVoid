// src/events/interactionCreate/handleButtons.js
const { error, log } = require("../../services/logger");

module.exports = async (client, interaction) => {
  if (!interaction.isButton()) return;

  try {
    const thread = interaction.channel;

    // ────────────────────────────────────────────────
    // Check if user is the thread creator or an admin
    // ────────────────────────────────────────────────
    
    const mesg = await thread.messages.fetch({ limit: 1 });
    const firstMessage = mesg.first();
    const creator = firstMessage?.content.slice(2, -1);
    console.log("Thread creator ID:", creator);
    
    const isCreator = interaction.user.id === creator;
    const isAdmin = interaction.member.permissions.has("Administrator") || 
                    interaction.member.permissions.has("ManageThreads");

    if (interaction.customId === "archive_ticket") {
      await interaction.deferUpdate().catch(() => {}); // Defer only here

      if (!isCreator && !isAdmin) {
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

      if (!isCreator && !isAdmin && interaction.guild.ownerId !== interaction.user.id) {
        return interaction.followUp({
          content: "You do not have permission to delete this ticket.",
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