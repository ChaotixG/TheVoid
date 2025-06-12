const { error } = require("../services/logger")
module.exports = async (client, guildId) => {
  try {
    let applicationCommands;

    if (guildId) {
      const guild = await client.guilds.fetch(guildId);
      applicationCommands = guild.commands;
    } else {
      applicationCommands = await client.application.commands;
    }

    await applicationCommands.fetch();
    return applicationCommands;
  } catch (err) {
    error('Failed to fetch application commands: ', err);
    throw error;  // Re-throw or return a fallback if needed
  }
};
