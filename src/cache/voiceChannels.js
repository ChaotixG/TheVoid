// src/cache/voiceChannels.js
const { Collection } = require("discord.js");

const activeVoiceChannels = new Collection();

module.exports = activeVoiceChannels;
