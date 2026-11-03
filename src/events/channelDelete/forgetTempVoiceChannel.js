const { forgetChannel } = require('../../features/voice/hubs');

// A temporary voice channel was deleted by hand: stop tracking it
module.exports = async (client, channel) => {
    await forgetChannel(channel.id);
};
