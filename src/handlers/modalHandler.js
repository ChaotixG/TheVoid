// src/handlers/modalHandler.js
module.exports = (interaction) => {
    const values = {};

    for (const [customId, field] of interaction.fields.fields) {
        values[customId] = field.value;
    }

    return {
        modalId: interaction.customId,
        values
    };
};
