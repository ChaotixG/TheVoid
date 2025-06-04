// src/handlers/modalHandler.js
const { InteractionType } = require('discord.js');

module.exports = async (interaction) => {
  if (interaction.type !== InteractionType.ModalSubmit) return;

  // Extract all submitted fields into a simple object: { title: '…', description: '…', … }
  const values = {};
  for (const [customId, textInput] of interaction.fields.fields) {
    values[customId] = textInput.value;
  }

  // Return the values—no replies or deferrals here.
  return { customId: interaction.customId, values };
};
