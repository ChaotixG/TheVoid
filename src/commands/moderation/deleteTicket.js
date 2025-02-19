const { PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'deltkt',
    description: 'Deletes the ticket',
    callback: async (client, interaction) => {
        const modRoleName = 'mod';
        const adminpermissions = new PermissionsBitField(PermissionsBitField.Flags.Administrator);
        const thread = interaction.channel;

        // Check if the command is used in a thread
        if (!thread.isThread()) {
            return interaction.reply({ content: '❌ This command can only be used inside a thread.', flags: 64 });
        }

        // Check if the user has the moderator role or admin permissions
        if (!interaction.member.roles.cache.some(role => role.name === modRoleName) || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ You do not have permission to delete this thread.', flags: 64 });
        }

        // Check if the thread was created by the bot
        if (thread.ownerId !== client.user.id) {
            return interaction.reply({ content: '❌ This thread is not a ticket.', flags: 64 });
        }

        // Delete the thread
        try {
            await thread.delete();
            console.log(`🗑️ Thread deleted by ${interaction.user.tag}: ${thread.name}`);
        } catch (error) {
            console.error('❌ Error deleting thread:', error);
            return interaction.reply({ content: '❌ Failed to delete the thread.', flags: 64 });
        }
    }
};
