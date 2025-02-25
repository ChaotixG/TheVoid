const {Client, Message, EmbedBuilder} = require('discord.js');
const User = require('../../models/User');
const calculateLevelXp = require('../../utils/calculateLevelXp');
const cooldowns = new Set();   

function getRandomXp(min,max){
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 
 * @param {Client} client
 * @param {Message} message
 */

module.exports = async (client, message) => {
    const embed = new EmbedBuilder()
    .setColor('#5a4786')
    .setTitle('Level Up!')
    if(!message.inGuild() || message.author.bot || cooldowns.has(message.author.id)) return;

    const xpToGive = getRandomXp(10,35);

    const query = {
        userId: message.author.id
    };

    try {
        const level = await User.findOne(query);
        if(level){
            console.log('_________________________________________________________')
            level.xp += xpToGive;
            if(level.xp >= calculateLevelXp(level.level)){
                level.level += 1;
                level.xp = 0;
                message.reply({embeds: [embed]});
            }
            await level.save().catch((error) => console.log(`Error saving updated level: ${error}`));
            cooldowns.add(message.author.id);
            setTimeout(() => {
                cooldowns.delete(message.author.id);
            }, 60000);
        }
        //if !level
        else  {
            const newUser = new User({
                userId: message.author.id,
                level: 1,
                xp: xpToGive,
                balance: 0,
                lastDaily: new Date(),
            })
            await newUser.save();
            cooldowns.add(message.author.id);
            setTimeout(() => {
                cooldowns.delete(message.author.id);
            }, 60000);
        }
    } catch (error) {
        console.log(`Error giving xp: ${error}`);
    }
}