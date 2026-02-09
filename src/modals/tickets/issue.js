const { TextInputStyle } = require('discord.js');

module.exports = {
    customId: 'ticket_complaint',
    title: 'Submit a Complaint',
    inputs: [
        {
            type: 'text',
            customId: 'title',                    // ← standardized
            label: 'Title',
            style: TextInputStyle.Short,
            placeholder: 'Generalize the issue in a few words',
            required: true
        },
        {
            type: 'text',
            customId: 'description',              // ← standardized (was 'complaint')
            label: 'Complaint',
            style: TextInputStyle.Paragraph,
            placeholder: 'Describe the issue in detail.',
            required: true
        },
        {
            type: 'label',
            label: 'Choose your user (optional)',
            component: {
                type: 'userSelect',
                customId: 'reportedUser',
                placeholder: 'Select a user to report (optional)',
            },
            required: false
        }
    ]
};