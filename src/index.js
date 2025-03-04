require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,] });
const mongoose = require('mongoose');
const eventHandler = require('./handlers/eventHandler');

(async () => {
    try {
        mongoose.set('strictQuery', false);
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB!');

        eventHandler(client);

        client.on('ready', () => console.log('Bot is online!'));
        await client.login(process.env.TOKEN);

    } catch (error) {
        console.error(`Error: ${error}`);
    }
})();
