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
  } catch (error) {
    console.error('Failed to fetch application commands:', error);
    throw error;  // Re-throw or return a fallback if needed
  }
};
