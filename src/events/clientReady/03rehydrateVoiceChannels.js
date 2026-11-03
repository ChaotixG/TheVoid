const { rehydrate } = require('../../features/voice/hubs');

// Runs once the guild and voice-state caches are filled, so occupied channels aren't mistaken for empty ones
module.exports = async (client) => {
    await rehydrate(client);
};
