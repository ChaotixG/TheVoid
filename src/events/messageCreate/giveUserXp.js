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

    if (!message.inGuild() || message.author.bot || cooldowns.has(message.author.id)) return;

    const xpToGive = getRandomXp(10, 35);

    const guildId = message.guild.id;
    const userId = message.author.id;

    try {
        const server = await Server.findOne({ guildId });

        if (server) {
            const user = server.users.find(user => user.userId === userId);

            if (user) {
                user.xp += xpToGive;
                if (user.xp >= calculateLevelXp(user.level)) {
                    user.level += 1;
                    user.xp = 0;
                    message.reply({ embeds: [embed] });
                }
                await server.save();
            } else {
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
                }, 100);
            }
        } else {
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
