const { startVoiceActivity } = require('../../features/economy/voiceActivity');
const { startRoleExpiry } = require('../../features/economy/shop');

// Background jobs: voice activity rewards every few minutes and removing expired shop roles
module.exports = async (client) => {
    startVoiceActivity(client);
    startRoleExpiry(client);
};
