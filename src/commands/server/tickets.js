// commands/server/tickets.js
const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
const Server = require('../../models/Server');
const { log, error } = require("../../services/logger");

module.exports = {
    name: 'ticket',
    description: 'Submit a ticket',

    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const server = await Server.findOne({ guildId: interaction.guild.id });
        if (!server?.settings?.tickets) {
            return interaction.editReply({
                content: 'Ticket system is not set up on this server.',
                ephemeral: true
            });
        }

        const options = [];

        if (server.settings.tickets?.suggestions?.channelId) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel('Suggestion')
                .setDescription('Suggest a new feature for the server.')
                .setValue('suggestion'));
        }
        if (server.settings.tickets?.complaints?.channelId) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel('Issue / Complaint')
                .setDescription('Report a bug or user issue.')
                .setValue('issue'));
        }
        if (server.settings.tickets?.troubleshooting?.channelId) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel('Support')
                .setDescription('Request general support.')
                .setValue('troubleshooting'));
        }

        if (options.length === 0) {
            return interaction.editReply({
                content: 'No ticket types are currently available.',
                ephemeral: true
            });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticketType')
            .setPlaceholder('Select Ticket Type')
            .addOptions(options);

        await interaction.editReply({
            content: 'Please select the type of ticket you wish to submit:',
            components: [new ActionRowBuilder().addComponents(menu)],
            ephemeral: true
        });

        // ────────────────────────────────────────────────
        // STOP HERE — no more code below this line
        // The select menu is now handled by handleTickets.js
        // The modal submit is handled by handleModals.js
        // ────────────────────────────────────────────────
    }
};