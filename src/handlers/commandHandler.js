const { MessageFlags } = require('discord.js');
const getLocalCommands = require('../utils/getLocalCommands');
const { replyError } = require('../utils/interactionReplies');
const { error } = require("../services/logger")

// Loaded once at startup instead of re-scanning the commands folder on every interaction
const commands = new Map(getLocalCommands().map(cmd => [cmd.data.name, cmd]));

// Who may run a command is enforced by Discord (default_member_permissions on each command);
// here we only check what the bot itself needs.
module.exports = async (client, interaction) => {
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
        if (command.botPermissions?.length && interaction.inGuild()) {
            const missing = interaction.guild.members.me.permissions.missing(command.botPermissions);
            if (missing.length) {
                await interaction.reply({
                    content: `I need these permissions for this command: ${missing.join(', ')}`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        }

        await command.callback(client, interaction);
    } catch (err) {
        error(`Error running /${interaction.commandName}: `, err);
        await replyError(interaction, 'There was an error running this command.');
    }
};
