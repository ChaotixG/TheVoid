const { PermissionsBitField, TextInputStyle } = require('discord.js');
const buildModal = require('../../utils/buildModal');

module.exports = {
    name: 'ticket',
    description: 'Submit a ticket',
    callback: async (client, interaction) => {
        const userRoles = interaction.member.roles.cache;
        const hasSpecialRole = userRoles.some(role => role.name === 'SpecialRole'); // Replace 'SpecialRole' with the actual role name

        const allOptions = [
            { label: 'Suggestion', value: 'suggestion' },
            { label: 'Complaint', value: 'complaint' },
            { label: '', value: 'special_option', requiredRole: 'SpecialRole' } // Example of an option with a required role
        ];

        const options = allOptions.filter(option => {
            if (option.requiredRole) {
                return userRoles.some(role => role.name === option.requiredRole);
            }
            return true;
        });

        const modal = buildModal('ticketModal', 'Submit a Ticket', [
            {
                type: 'text',
                customId: 'ticketDescription',
                label: 'Description',
                style: TextInputStyle.Paragraph
            },
            {
                type: 'select',
                customId: 'ticketType',
                placeholder: 'Select Ticket Type',
                options: options
            }
        ]);

        await interaction.showModal(modal);
    }
};