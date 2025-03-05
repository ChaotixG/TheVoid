const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    name: "showmodal",
    description: "Shows a modal",
    
    callback: async (client, interaction) => {

        if (!interaction.isChatInputCommand()) return; // Ensure it's a valid command interaction

        const modal = new ModalBuilder()
            .setCustomId(`myModal-${interaction.user.id}`) // Custom ID must be unique
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

        await interaction.showModal(modal); // Show the modal to the user

        // After the modal is submitted, show a select menu in the response message
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('colorSelectMenu')
            .setPlaceholder('Choose a color')
            .addOptions(
                { label: 'Red', value: 'red' },
                { label: 'Blue', value: 'blue' }
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.followUp({
            content: 'Please select a color from the menu below:',
            components: [row]
        });
    }
};
