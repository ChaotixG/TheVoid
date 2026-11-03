const { TextInputStyle } = require('discord.js');

module.exports = {
    title: 'Get help with troubleshooting',
    inputs: [
        {
            type: 'text',
            customId: 'title',                    // ← standardized
            label: 'Title for your help request',
            style: TextInputStyle.Short,
            maxLength: 100,                       // thread name limit
            placeholder: 'Enter your title here...',
            required: true
        },
        {
            type: 'text',
            customId: 'description',              // ← standardized
            label: 'Describe what your issue is.',
            style: TextInputStyle.Paragraph,
            placeholder: 'Describe your issue here...',
            required: true
        }
    ]
};