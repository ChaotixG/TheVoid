const path = require('path');
const buildModal = require('../../utils/buildModal');
const getAllFiles = require('../../utils/getAllFiles');
const api = require('./../../services/customApi')

module.exports = async (client, interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticketType') return;

    //await interaction.deferReply({ ephemeral: true }); // Prevents timeouts
    const selectedType = interaction.values[0];
    console.log(`User selected: ${selectedType}`);

    const modals = getAllFiles('./src/modals/tickets', false, true, false, false);
    const modalFile = modals.find(file => file.toLowerCase().includes(selectedType));

    if (!modalFile) {
        console.error(`No matching modal file found for type: ${selectedType}`);
        return interaction.editReply({ // Edit the deferred reply instead of replying again
            content: `No matching modal file found for type: **${selectedType}**`,
            flags: 64
        });
    }

    console.log(`Loading modal file: ${modalFile}`);

    try {
        const modalPath = path.join(__dirname, `./../../../${modalFile}`);
        const modalModule = require(modalPath);

        if (!modalModule.customId || !modalModule.title || !modalModule.inputs) {
            console.error(`Modal file ${modalFile} is missing required properties.`);
            return interaction.editReply({
                content: `Modal file ${modalFile} is missing required properties.`,
                flags: 64
            });
        }

        const modal = buildModal(modalModule.customId, modalModule.title, modalModule.inputs);
        console.log("Attempting to show modal.");
        await interaction.showModal(modal); // This acknowledges the interaction

        // Await modal submission
        const filter = (modalInteraction) => 
            modalInteraction.customId === modalModule.customId && modalInteraction.user.id === interaction.user.id;

        try {
            const modalInteraction = await interaction.awaitModalSubmit({ filter, time: 90000 });

            response = modalInteraction.fields.fields.map(field => ({
                customId: field.customId,
                value: field.value
            }));

            await modalInteraction.reply({
                content: `Successfully submitted!`,
                flags: 64
            });
            
            // Delete the message after 5 seconds (5000 milliseconds)
            api.deleteMessage(modalInteraction, 5000)
            

            return response;
        } catch (error) {
            console.error("Error handling modal submission:", error);
            return interaction.followUp({
                content: "There was an issue processing your submission or it timed out.",
                flags: 64
            });
        }

    } catch (error) {
        console.error(`Error loading modal file: ${error}`);
        return interaction.editReply({ // Always edit deferred replies
            content: `Error loading modal file: ${error}`,
        });
    }
};
