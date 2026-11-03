const { markGuildJoined } = require('../../database/guildLifecycle');
const { sendSetupInvites } = require('../../features/setup/invite');
const { info } = require("../../services/logger")

module.exports = async (client, guild) => {
    info(`Joined server: ${guild.name} (${guild.id})`);
    // Also clears a pending deletion if the bot was removed and re-added within 30 days
    await markGuildJoined(guild.id);
    // DM the owner (and whoever added me) an invitation to run /setup
    await sendSetupInvites(guild);
};
