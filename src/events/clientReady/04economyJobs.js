const { startVoiceActivity } = require('../../features/economy/voiceActivity');
const { startRoleExpiry } = require('../../features/economy/shop');
const { primePremiumMembers } = require('../../services/premium');

// Background jobs: voice activity rewards every few minutes and removing expired shop roles,
// plus loading the premium server's members (premium checks read only that cache)
module.exports = async (client) => {
    startVoiceActivity(client);
    startRoleExpiry(client);
    await primePremiumMembers(client);
};
