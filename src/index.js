require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const {rehydrateVoiceChannels} = require('./utils/rehydrateVoiceChannels');
const { log, error } = require("./services/logger")
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
const https = require('https');

function getPublicIP() {
  return new Promise((res, rej) =>
    https
      .get('https://api.ipify.org?format=json', r => {
        let d = '';
        r.on('data', c => (d += c));
        r.on('end', () => res(JSON.parse(d).ip));
      })
      .on('error', rej)
  );
}


(async () => {
    try {
        mongoose.set('strictQuery', false);
        await mongoose.connect(process.env.MONGODB_URI);
        log('Connected to MongoDB!');

        eventHandler(client);

        const ip = await getPublicIP().catch(() => 'n/a');
        log(`Public IP: ${ip}`);

        client.on('ready', () => log('Bot is online!'));
        await client.login(process.env.TOKEN);
        await rehydrateVoiceChannels(client); // 👈 Add this call

    } catch (err) {
        error(`Error: `, err);
    }
})();
