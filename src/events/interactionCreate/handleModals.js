// src/events/interactionCreate/handleModals.js
const { error, log } = require("../../services/logger");
const modalHandler = require("../../handlers/modalHandler");
const Server = require("../../models/Server");
const createThread = require("../../utils/createThreads");

const processed = new Set();

module.exports = async (client, interaction) => {
    log('[debug] handlemodals called');
    // Very first check – exit immediately if not a modal
    if (!interaction ||
        !interaction.isModalSubmit()) {
        return; // silent exit
    }

    const id = interaction.id;
    if (processed.has(id)) return;
    processed.add(id);
    setTimeout(() => processed.delete(id), 120_000);

    log(`Modal submitted: ${interaction.customId} by ${interaction.user.tag}`);

    try {
        // ───────────────────────────────────────
        // Handle ticket creation modals
        // ───────────────────────────────────────
        if (interaction.customId.startsWith("ticket_")) {
            // Acknowledge the modal submission immediately
            await interaction.deferReply({ ephemeral: true });
            log(`[MODAL] Deferred modal submission: ${interaction.customId}`);

            const { values } = modalHandler(interaction);

            // Determine ticket type from customId
            let ticketType;
            if (interaction.customId.includes("suggestion"))      ticketType = "suggestions";
            else if (interaction.customId.includes("issue") ||
                     interaction.customId.includes("complaint"))  ticketType = "complaints";
            else if (interaction.customId.includes("troubleshooting") ||
                     interaction.customId.includes("support"))    ticketType = "troubleshooting";
            else {
                throw new Error(`Unknown ticket modal: ${interaction.customId}`);
            }

            const server = await Server.findOne({ guildId: interaction.guild.id });
            const channelId = server?.settings?.tickets?.[ticketType]?.channelId;

            if (!channelId) {
                throw new Error(`No destination channel for ${ticketType}`);
            }

            // Create thread
            await createThread(client, interaction, values, channelId);

            // Final reply
            await interaction.editReply({
                content: "✅ Your ticket has been submitted successfully!",
                ephemeral: true
            });

            log(`Ticket created: ${ticketType} by ${interaction.user.tag}`);
            return;
        }

        // Unknown modal
        await interaction.reply({
            content: "This modal type is not handled yet.",
            ephemeral: true
        });

    } catch (err) {
        error(`Modal ${interaction.customId} failed:`, err);

        const content = "❌ An error occurred while creating your ticket.";

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content, ephemeral: true }).catch(() => {});
        } else {
            await interaction.followUp({ content, ephemeral: true }).catch(() => {});
        }
    }
};