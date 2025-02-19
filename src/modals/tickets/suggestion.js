const { TextInputStyle } = require('discord.js');

module.exports = {
    customId: 'suggestionModal',
    title: 'Submit a Suggestion',
    inputs: [
        {
            type: 'text',
            customId: 'suggestionTitleInput',
            label: 'Title for your suggestion',
            style: TextInputStyle.Short, // Use TextInputStyle.Short for a single-line input
            placeholder: 'Explain your suggestion in a few words...',
            required: true
        },
        {
            type: 'text',
            customId: 'suggestionInput',
            label: 'Your Suggestion',
            style: TextInputStyle.Paragraph, // Use TextInputStyle.Short for a single-line input
            placeholder: 'Enter your suggestion here...',
            required: true
        }
    ]
};