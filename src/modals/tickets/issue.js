const { TextInputStyle } = require('discord.js');

module.exports = {
    customId: 'complaintModal',
    title: 'Submit a Complaint',
    inputs: [
        {
            type: 'text',
            customId: 'title',
            label: 'Title',
            style: TextInputStyle.Short, // Use TextInputStyle.Short for a single-line input
            placeholder: 'Generalize the issue in a few words',
            required: true
        },
        {
            type: 'text',
            customId: 'complaint',
            label: 'Complaint',
            style: TextInputStyle.Paragraph, // Use TextInputStyle.Short for a single-line input
            placeholder: 'Describe the issue in detail.',
            required: true
        },
        {
            type: 'label',
            label: 'Choose your user (optional)',
            customId: 'reportedUser',
            component: {
                type: 'userSelect',
                customId: 'reportedUser',
                placeholder: 'Select a user to report (optional)',
            }
        }
    ]
};