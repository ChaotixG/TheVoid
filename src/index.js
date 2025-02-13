require('dotenv').config({ path: require('path').resolve(__dirname, '../.env')});

const { Client, ButtonBuilder, ActionRowBuilder } = require('discord.js');
const client = new Client({ intents: 131071 });
const mongoose = require('mongoose');
const { dirname } = require('path');
const eventHandler = require('./handlers/eventHandler');

(async () => {
    try {
        
        mongoose.set('strictQuery', false);
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to server!!')
    
        eventHandler(client);

        client.on('ready', () => console.log('I am online!') );
        await client.login(process.env.TOKEN);

    } catch (error) { 
        console.log(`Error connecting to server: ${error}`);
    }
})();
 