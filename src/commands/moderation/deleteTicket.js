const { PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'delete',
    description: 'Deletes the current ticket',
    callback: async (client, interaction) => {
        const modRoleName = 'mod';
        const ticket = interaction.channel;

        // Check if the command is used in a thread
        if (!ticket.isThread()) {
            return interaction.reply({ content: '❌ This command can only be used inside a ticket.', flags: 64 });
        }

        // Check if the user has the moderator role, admin permissions or created the thread
        if (interaction.member.id !== interaction.guild.ownerId && 
            !interaction.member.id === ticket.ownerId &&
            !interaction.member.roles.cache.some(role => role.name === modRoleName) && 
            !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ You do not have permission to delete this ticket.', flags: 64 });
        }

        // Check if the ticket was created by the bot
        /*if (ticket.ownerId !== client.user.id) {
            return interaction.reply({ content: '❌ This ticket is not a ticket.', flags: 64 });
        }*/

        // Delete the ticket
        try {
            await ticket.delete();
            console.log(`🗑️ ticket deleted by ${interaction.user.tag}: ${ticket.name}`);
        } catch (error) {
            console.error('❌ Error deleting ticket:', error);
            return interaction.reply({ content: '❌ Failed to delete the ticket.', flags: 64 });
        }
    }
};
