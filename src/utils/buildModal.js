const { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');

module.exports = (customId, title, inputs) => {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    const actionRows = inputs.map(input => {
        const component = new TextInputBuilder()
            .setCustomId(input.customId)
            .setLabel(input.label)
            .setStyle(input.style);

        // Check if placeholder exists, and set it if it does
        if (input.placeholder) {
            component.setPlaceholder(input.placeholder);
        }

        // Ensure 'required' is applied correctly, defaulting to true unless explicitly set to false
        if (input.hasOwnProperty('required')) {
            component.setRequired(input.required);
        } else {
            component.setRequired(true); // Default to true if not specified
        }

        return new ActionRowBuilder().addComponents(component);
    });

    modal.addComponents(...actionRows); // Spread operator to add multiple action rows

    return modal;
};
