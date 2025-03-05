const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
const handleModal = require('./../../events/interactionCreate/handleTickets');
const createHelpThread = require('./../../utils/createThreads');

module.exports = {
    name: 'ticket',
    description: 'Submit a ticket',
    callback: async (client, interaction) => {
        const userRoles = interaction.member.roles.cache;
        //channelIdList = mongodbarray
        var channelId = new String();


        const selectTypeMenu = new StringSelectMenuBuilder()
            .setCustomId('ticketType')
            .setPlaceholder('Select Ticket Type')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Suggestion')
                    .setDescription('Suggest a new feature for the server.')
                    .setValue('suggestion'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Complaint')
                    .setDescription('Report a user or issue.')
                    .setValue('complaint')
            );

        const roleOptions = [
            { role: '🔮 Seeker', label: 'Seeker', value: 'seeker' },
            { role: '📡 Streamer', label: 'Troubleshooting', value: 'troubleshooting' },
            { role: '🎮 Gamer', label: 'Gamer', value: 'gamer' },
            { role: '🎨 Artist', label: 'Artist', value: 'artist' },
            { role: 'mod', label: 'Moderator', value: 'moderator' },
        ];

        roleOptions.forEach(option => {
            if (userRoles.some(role => role.name === option.role)) {
                selectTypeMenu.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(option.label)
                        .setDescription(option.label)
                        .setValue(option.value)
                );
            }
        });

        const actionRow = new ActionRowBuilder().addComponents(selectTypeMenu);

        await interaction.reply({
            content: 'Please select the type of ticket you wish to submit:',
            components: [actionRow],
            flags: 64
        });

        try {
            console.log('Waiting for user to select a ticket type...');

            // Collect selection
            const selection = await interaction.channel.awaitMessageComponent({
                filter: (i) => i.user.id === interaction.user.id && i.customId === 'ticketType',
                time: 60000
            });

            console.log(`User selected ticket type: ${selection.values[0]}`);

            // **Handle modal interaction**
            const response = await handleModal(client, selection);

            if (selection.values[0] === 'suggestion') {
                channelId = '1339527658790195230';
                await createHelpThread(client, interaction, response,channelId);
                console.log('Help thread created.');
            }else if (selection.values[0] === 'troubleshooting') {
                channelId = '1333383662351286324';
                await createHelpThread(client, interaction, response,channelId);
                console.log('Help thread created.');
            }else if (selection.values[0] === 'complaint') {
                channelId = '1337544316926824552';
                await createHelpThread(client, interaction, response,channelId);
                console.log('Complain submited.');
            }

        } catch (error) {
            console.error("Error processing ticket:", error);
            if (!interaction.replied) {
                await interaction.followUp({
                    content: "There was an error processing your request.",
                    flags: 64
                });
            }
        }
    }
};
