const { Client, Interaction, ApplicationCommandOptionType } = require('discord.js');
const Server = require('../../models/Server');

module.exports = {  
    /**
     * 
     * @param {Client} client
     * @param {Interaction} interaction
     */

    name: 'level',
    description: "Shows your/someone's level",
    options: [{
        name: 'target-user',
        description: 'The user whose the level you want to see',
        type: ApplicationCommandOptionType.Mentionable,
    }],

    callback: async (client, interaction) => {
        if(!interaction.inGuild()) {interaction.reply({content: "You can only run this command insinde a server.", flags: 64}); return;}
        await interaction.deferReply();

        try {
            const mentionedUser = interaction.options.get('target-user')?.value
            const targetUser = mentionedUser || interaction.user.id; // If user is not provided, use the interaction user
            const server = await Server.findOne({ guildId: interaction.guild.id }); // Find the server
            const serverUser = server.users.find(serverUser => serverUser.userId === targetUser); // Find the user in the server
            console.log(serverUser);
            if(!serverUser) {interaction.editReply(
                mentionedUser? `${targetUser.id} doesn't have a profile yet. Try again when they chat a little more.` 
                : "You dont have a profile yet. Chat a little more and try again."
                ); 
                return;
            }
        }catch (error) {
            console.error(`Error finding user in server: ${error}`);
        }
    }
}
