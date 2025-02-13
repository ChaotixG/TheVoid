const {ApplicationCommandOptionType, PermissionFlagsBits} = require('discord.js');
module.exports = {
    name: 'ban',
    description: 'Bans a member from the server',
    options: [
        {
            name: 'target-user',
            description: 'bans a user from the server',
            required: true,
            type: ApplicationCommandOptionType.User
        },
        {
            name: 'reason',
            description: 'reason for banning ban',
            required: true,
            type: ApplicationCommandOptionType.String
        }//,
        //testOnly: true
    ],
    permissionsRequired: [PermissionFlagsBits.Administrator],
    botPermissions: [PermissionFlagsBits.Administrator],
    callback: (client, interaction) => {
        interaction.reply(`User has been banned`);
    },
};