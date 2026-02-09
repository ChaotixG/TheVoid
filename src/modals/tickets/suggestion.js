const { TextInputStyle } = require('discord.js');

module.exports = {
    customId: 'ticket_suggestion',
    title: 'Submit a Suggestion',
    inputs: [
        {
            type: 'text',
            customId: 'title',                    // ← standardized
            label: 'Title for your suggestion',
            style: TextInputStyle.Short,
            placeholder: 'Explain your suggestion in a few words...',
            required: true
        },
        {
            type: 'text',
            customId: 'description',              // ← standardized
            label: 'Your Suggestion',
            style: TextInputStyle.Paragraph,
            placeholder: 'Enter your suggestion here...',
            required: true
        }
    ]
};