const { handleVoiceStateUpdate } = require('../../features/voice/hubs');

module.exports = async (client, oldState, newState) => {
    await handleVoiceStateUpdate(oldState, newState);
};
