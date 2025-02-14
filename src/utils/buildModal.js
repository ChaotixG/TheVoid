const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, SelectMenuBuilder } = require('discord.js');

/**
 * Builds a modal with the specified parameters.
 * @param {string} customId - The custom ID for the modal.
 * @param {string} title - The title of the modal.
 * @param {Array} inputs - An array of input objects for the modal.
 * @returns {ModalBuilder} - The built modal.
 */
module.exports = (customId, title, inputs) => {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    const actionRows = inputs.map(input => {
        let component;
        if (input.type === 'text') {
            component = new TextInputBuilder()
                .setCustomId(input.customId)
                .setLabel(input.label)
                .setStyle(input.style);
        } else if (input.type === 'select') {
            component = new SelectMenuBuilder()
                .setCustomId(input.customId)
                .setPlaceholder(input.placeholder)
                .addOptions(input.options);
        }

        return new ActionRowBuilder().addComponents(component);
    });

    modal.addComponents(...actionRows);

    return modal;
};