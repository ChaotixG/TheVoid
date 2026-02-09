// handleTickets.js
const path = require('path');
const buildModal = require('../../utils/buildModal');
const getAllFiles = require('../../utils/getAllFiles');
const { log, warn, error } = require("../../services/logger");

// Track processed interactions (good practice)
const processedInteractions = new Set();

module.exports = async (client, interaction) => {
    log('[debug] handleTickets called');

    if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticketType') return;

    if (processedInteractions.has(interaction.id)) {
        warn(`Interaction ${interaction.id} already processed.`);
        return;
    }
    processedInteractions.add(interaction.id);

    const selectedType = interaction.values[0];
    log(`User selected: ${selectedType}`);

    try {
        // Load modal config/file (your existing logic)
        const modals = getAllFiles('./src/modals/tickets', false, true, false, false);
        const modalFile = modals.find(file => file.toLowerCase().includes(selectedType));

        if (!modalFile) {
            error(`No matching modal file for: ${selectedType}`);
            await interaction.reply({
                content: `No form available for **${selectedType}**.`,
                ephemeral: true
            });
            return;
        }

        log(`Loading modal: ${modalFile}`);
        const modalPath = path.join(__dirname, `./../../../${modalFile}`);
        const modalModule = require(modalPath);

        if (!modalModule.customId || !modalModule.title || !modalModule.inputs) {
            throw new Error(`Missing properties in ${modalFile}`);
        }

        const modal = buildModal(modalModule.customId, modalModule.title, modalModule.inputs);

        // SHOW MODAL FIRST — this automatically acknowledges the interaction
        log(`Showing modal: ${modalModule.customId}`);
        await interaction.showModal(modal);

        // Clean up
        processedInteractions.delete(interaction.id);

    } catch (err) {
        error(`Error in handleTickets for ${selectedType}:`, err);

        // Only reply if we haven't acknowledged yet (showModal would have failed earlier if so)
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "Sorry, couldn't open the form. Try again or contact support.",
                ephemeral: true
            }).catch(() => {});
        }
    }
};