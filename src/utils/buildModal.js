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

        if (input.placeholder) {
            component.setPlaceholder(input.placeholder);
        }

        return new ActionRowBuilder().addComponents(component);
    });

    modal.addComponents(...actionRows); // Spread operator to add multiple action rows

    return modal;
};