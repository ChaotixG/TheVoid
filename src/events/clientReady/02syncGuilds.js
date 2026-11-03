const { syncGuilds, purgeDepartedGuilds } = require('../../database/guildLifecycle');
const { error } = require('../../services/logger');

// Catch up on servers joined/left while offline, then purge data for servers left 30+ days ago.
// Repeated daily so a wrong "left" flag is corrected long before anything could be purged.
module.exports = async (client) => {
    await syncGuilds(client);
    await purgeDepartedGuilds(client);
    setInterval(async () => {
        try {
            await syncGuilds(client);
            await purgeDepartedGuilds(client);
        } catch (err) {
            error('Error during the daily server cleanup: ', err);
        }
    }, 24 * 60 * 60 * 1000).unref();
};
