require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getPublicIP, addIPIfNeeded } = require('./utils/ipUtils'); // ✅ proper import
const { rehydrateVoiceChannels } = require('./utils/rehydrateVoiceChannels');
const { log, error } = require("./services/logger");
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const mongoose = require('mongoose');
const eventHandler = require('./handlers/eventHandler');
const { applyMongoIPGuard } = require("./utils/mongoIPGuard");
const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,] });



(async () => {
    try {
        const ip = await getPublicIP().catch(() => 'n/a');
        log(`Public IP: ${ip}`);

        await addIPIfNeeded(ip).catch(err => {
            error(`Failed to add IP to whitelist: ${err.message}`);
        });

        mongoose.set('strictQuery', false);

        // --- Validate MongoDB URI ------------------------------------------------
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI environment variable is not defined');
        }

        // Trim whitespace/newlines that can accidentally break auth
        let uri = process.env.MONGODB_URI.trim();
        if (/\r|\n/.test(uri)) {
            error('MongoDB URI contains newline characters; please check your .env file');
            uri = uri.replace(/\r|\n/g, '');
        }

        // log username (hide password)
        const credMatch = uri.match(/\/\/([^:]+):([^@]+)@/);
        if (credMatch) {
            log(`Connecting to MongoDB as user "${credMatch[1]}"`);
        } else {
            log('MongoDB URI does not include credentials');
        }

        connection = await mongoose.connect(uri);
        applyMongoIPGuard(connection);
        log('Connected to MongoDB!');

        eventHandler(client);


        client.on('clientReady', () => log('Bot is online!'));
        await client.login(process.env.TOKEN);
        await rehydrateVoiceChannels(client); // 👈 Add this call

    } catch (err) {
        error(`Error: `, err);
    }
})();
