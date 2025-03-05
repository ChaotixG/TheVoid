const { ModalSubmitInteraction } = require('discord.js');

module.exports = async (interaction) => {
    if (!(interaction instanceof ModalSubmitInteraction)) return;  // Early return for non-modal interactions

    try {
        // This will store the form data
        const formData = {};

        // Check if there are fields in the modal submission
        if (interaction.fields) {
            interaction.fields.fields.forEach((field, key) => {
                formData[key] = field.value;
            });
        } else {
            throw new Error('No fields found in the modal interaction');
        }

        // Return the form data
        return formData;
    } catch (error) {
        console.error('Error handling modal submission:', error);

        // Handle error gracefully by replying to the interaction
        if (interaction && typeof interaction.reply === 'function') {
            await interaction.reply({
                content: 'An error occurred while processing the modal submission.',
                flags: 64,
            });
        }

        // Return null or handle the error as needed
        return null;
    }
};
