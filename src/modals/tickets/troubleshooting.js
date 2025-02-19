const { TextInputStyle } = require('discord.js');

module.exports = {
    customId: 'troubleshootingModal',
    title: 'Get help with troubleshooting',
    inputs: [
        {
            type: 'text',
            customId: 'helpTitleInput',
            label: 'Title for your help request',
            style: TextInputStyle.Short, // Use TextInputStyle.Short for a single-line input
            placeholder: 'Enter your title here...',
            required: true
        },
        {
            type: 'text',
            customId: 'helpDescriptionInput',
            label: 'Describe what your issue is.',
            style: TextInputStyle.Paragraph, // Use TextInputStyle.Paragraph for a multi-line input
            placeholder: 'Describe your issue here...',
            required: true
        }
    ]
};