//handleTickets.js
const path = require('path');
const buildModal = require('../../utils/buildModal');
const getAllFiles = require('../../utils/getAllFiles');
const api = require('./../../services/customApi');
const { log, warn, error } = require("../../services/logger")

// Track processed interactions
const processedInteractions = new Set();

module.exports = async (client, interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticketType') return;

    // Prevent duplicate processing
    if (processedInteractions.has(interaction.id)) {
        warn(`Interaction ${interaction.id} already processed.`);
        return;
    }
    processedInteractions.add(interaction.id);

    const selectedType = interaction.values[0];
    log(`User selected: ${selectedType}`);

    const modals = getAllFiles('./src/modals/tickets', false, true, false, false);
    const modalFile = modals.find(file => file.toLowerCase().includes(selectedType));

    if (!modalFile) {
        error(`No matching modal file found for type: ${selectedType}`);
        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({
                content: `No matching modal file found for type: **${selectedType}**`,
                flags: 64
            });
        }
        return;
    }

    log(`Loading modal file: ${modalFile}`);

    try {
        const modalPath = path.join(__dirname, `./../../../${modalFile}`);
        const modalModule = require(modalPath);

        if (!modalModule.customId || !modalModule.title || !modalModule.inputs) {
            error(`Modal file ${modalFile} is missing required properties.`);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({
                    content: `Modal file ${modalFile} is missing required properties.`,
                    flags: 64
                });
            }
            return;
        }

        const modal = buildModal(modalModule.customId, modalModule.title, modalModule.inputs);
        //await interaction.showModal(modal); // Acknowledges the interaction

        // Await modal submission
        const filter = (modalInteraction) =>
            modalInteraction.customId === modalModule.customId && modalInteraction.user.id === interaction.user.id;

        try {
            const modalInteraction = await interaction.awaitModalSubmit({ filter, time: 90000 });

            const response = modalInteraction.fields.fields.map(field => ({
                customId: field.customId,
                value: field.value
            }));

            modalInteraction.reply({
                content: `Successfully submitted!`,
                flags: 64
            });

            // Delete the message after 5 seconds (5000 milliseconds)
            api.deleteMessage(modalInteraction, 5000);

            // Clean up processed interaction
            processedInteractions.delete(interaction.id);
            
            return response;
        } catch (err) {
            error("Error handling modal submission: ", err);
            if (!interaction.replied) {
                await interaction.followUp({
                    content: "There was an issue processing your submission or it timed out.",
                    flags: 64
                });
            }
        }

    } catch (err) {
        error(`Error loading modal file: `, err);
        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({
                content: `Error loading modal file: ${err}`,
                flags: 64
            });
        }
    }
};