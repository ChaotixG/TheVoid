const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    name: "showmodal",
    description: "Shows a modal",
    
    callback: async (client, interaction) => { // Fix: Correct function parameters
        if (!interaction.isChatInputCommand()) return; // Ensure it's a valid command interaction

        const modal = new ModalBuilder()
            .setCustomId(`myModal-${interaction.user.id}`) // Fix: Custom ID must be unique
            .setTitle('My Modal');

        const favoriteColorInput = new TextInputBuilder()
            .setCustomId('favoriteColorInput')
            .setLabel('What is your favorite color?')
            .setStyle(TextInputStyle.Short);

        const hobbiesInput = new TextInputBuilder()
            .setCustomId('hobbiesInput')
            .setLabel('What are your favorite hobbies?')
            .setStyle(TextInputStyle.Paragraph);

        const firstActionRow = new ActionRowBuilder().addComponents(favoriteColorInput);
        const secondActionRow = new ActionRowBuilder().addComponents(hobbiesInput);

        modal.addComponents(firstActionRow, secondActionRow);

        await interaction.showModal(modal); // Ensure interaction is valid
    }
};
