// commands/server/tickets.js
const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
const buildModal = require('./../../utils/buildModal');
const createThread = require('./../../utils/createThreads');
const modalHandler = require('./../../handlers/modalHandler');
const { error } = require("../../services/logger")

module.exports = {
    name: 'ticket',
    description: 'Submit a ticket',
    callback: async (client, interaction) => {
        const userRoles = interaction.member.roles.cache;

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

        await interaction.deferReply({ flags: 64 });

const actionRow = new ActionRowBuilder().addComponents(selectTypeMenu);
await interaction.editReply({
    content: 'Please select the type of ticket you wish to submit:',
    components: [actionRow]
});

try {
    const selection = await interaction.channel.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id && i.customId === 'ticketType',
        time: 60000
    });

    const modal = buildModal(
        `${selection.values[0]}Modal`,
        `Submit a ${selection.values[0]}`,
        [
            { customId: 'title', label: 'Title', style: 'Short', required: true },
            { customId: 'description', label: 'Description', style: 'Paragraph', required: true }
        ]
    );

    await selection.showModal(modal);

    const modalSubmission = await selection.awaitModalSubmit({
        filter: (i) =>
            i.customId === `${selection.values[0]}Modal` &&
            i.user.id === interaction.user.id,
        time: 90000
    });

    const { values } = await modalHandler(modalSubmission);

    const channelMap = {
        suggestion: '1379556048192667678',
        troubleshooting: '1379552742523011353',
        complaint: '1337544316926824552'
    };

    const channelId = channelMap[selection.values[0]];
    if (channelId) {
        await createThread(client, modalSubmission, values, channelId);
    }

    await modalSubmission.reply({
        content: 'Your ticket has been submitted successfully!',
        flags: 64
    });
} catch (err) {
    error("Error processing ticket: ", err);

    if (!interaction.replied) {
        await interaction.followUp({
            content: "There was an error processing your request.",
            flags: 64
        });
    }
}

    }
};
