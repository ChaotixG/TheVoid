const { Client, Message, EmbedBuilder } = require('discord.js');
const Server = require('../../models/Server');
const calculateLevelXp = require('../../utils/calculateLevelXp');
const cooldowns = new Set();
const { error } = require("../../services/logger")


function getRandomXp(min, max) {
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
        .setTitle('Level Up!');

    // Check if message is in a guild, author is not a bot, and if cooldown has passed
    if (!message.inGuild() || message.author.bot || cooldowns.has(message.author.id)) return;

    // Random XP to give
    const xpToGive = getRandomXp(10, 35);

    // Define the query to find the user inside the server
    const guildId = message.guild.id;
    const userId = message.author.id;

    try {
        // Find the server by guildId
        const server = await Server.findOne({ guildId });

        if (server) {
            // Find the user within the server's users array
            const user = server.users.find(user => user.userId === userId);

            if (user) {
                // If user exists, update their XP
                user.xp += xpToGive;
                if (user.xp >= calculateLevelXp(user.level)) {
                    user.level += 1;
                    user.xp = 0;
                    message.reply({ embeds: [embed] });
                }
                await server.save();
            } else {
                // If user doesn't exist, create a new user in the server's users array
                const newUser = {
                    userId: message.author.id,
                    level: 1,
                    xp: xpToGive,
                    balance: 0,
                    lastDaily: new Date(),
                };
                server.users.push(newUser);
                await server.save();
                cooldowns.add(message.author.id);
                setTimeout(() => {
                    cooldowns.delete(message.author.id);
                }, 1000);
            }
        } else {
            // If server does not exist, create a new server entry and add the user
            const newServer = new Server({
                guildId,
                channelsId: [],
                disabledCommands: [],
                users: [{
                    userId: message.author.id,
                    level: 1,
                    xp: xpToGive,
                    balance: 0,
                    lastDaily: new Date(),
                }],
            });
            await newServer.save();
            cooldowns.add(message.author.id);
            setTimeout(() => {
                cooldowns.delete(message.author.id);
            }, 60000);
        }
    } catch (err) {
        error(`Error giving xp: `, err);
    }
};
