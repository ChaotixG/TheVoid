const { Client, Interaction, ApplicationCommandOptionType, AttachmentBuilder } = require('discord.js');
const canvacord = require('canvacord');
const calculateLevelXp = require('../../utils/calculateLevelXp');
const Server = require('../../models/Server');

module.exports = {  
    /**
     * 
     * @param {Client} client
     * @param {Interaction} interaction
     */

    name: 'rank',
    description: "Shows your/someone's player Card",
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
            const targetUserObj = await interaction.guild.members.fetch(targetUser);
            const server = await Server.findOne({ guildId: interaction.guild.id }); // Find the server
            const serverUser = server.users.find(serverUser => serverUser.userId === targetUser); // Find the user in the server
            console.log(serverUser);
            if(!serverUser) {interaction.editReply(
                mentionedUser? `${targetUser.id} doesn't have a profile yet. Try again when they chat a little more.` 
                : "You dont have a profile yet. Chat a little more and try again."
                ); 
                return;
            }


            let allLevels = await server.users.sort((a, b) =>{
                if(a.level === b.level) {
                    return b.xp - a.xp;
                }else{
                return b.level - a.level;
                }
            });
            console.log(targetUser)
            console.log(targetUserObj)
            let currRank = allLevels.findIndex((user) => user.userId === targetUser) + 1;
            const rank = new canvacord.RankCardBuilder()
            .setAvatar(targetUserObj.user.displayAvatarURL({ size: 256 })) // Avatar from the user object
            .setCurrentXP(serverUser.xp)
            .setRequiredXP(calculateLevelXp(serverUser.level))
            .setLevel(serverUser.level)
            .setRank(currRank)
            .setStatus(targetUserObj.presence?.status || 'offline')
            .setFonts({ // Add this line to load fonts
                progress: 'Arial', // For example, use Arial for progress
                level: 'Arial', // Font for level text
                rank: 'Arial', // Font for rank text
                xp: 'Arial', // Font for XP text
                username: 'Arial' // Font for username text
            })
            const data = await rank.build();
            const attachement = new AttachmentBuilder(data);
            interaction.editReply({files: [attachement]});


        }catch (error) {
            console.error(`Error finding user in server: ${error}`);
        }
    }
}
