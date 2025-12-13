// src/events/interactionCreate/handleModals.js
const { ModalSubmitInteraction } = require('discord.js');
const parseModal = require('../../handlers/modalHandler');
const { error } = require('../../services/logger');

module.exports = async (interaction) => {
    if (!(interaction instanceof ModalSubmitInteraction)) return;

    try {
        const { modalId, values } = parseModal(interaction);

        switch (modalId) {
            case 'complaintModal':
                await handleComplaint(interaction, values);
                break;

            default:
                console.warn(`Unhandled modal: ${modalId}`);
        }
    } catch (err) {
        error('Error handling modal submission:', err);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'An error occurred while processing the form.',
                flags: 64,
            });
        }
    }
};
