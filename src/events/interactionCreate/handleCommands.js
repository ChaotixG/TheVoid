const { devs, testServer } = require('../../../config.json');
const getLocalCommands = require('../../utils/getLocalCommands');
const { error } = require("../../services/logger")

module.exports = async (client, interaction) => {
    if(!interaction.isChatInputCommand()) return;

    const localCommands = getLocalCommands();
    try {
        const commandObject = localCommands.find((cmd) => cmd.name === interaction.commandName);

        if (!commandObject) return;

        if (commandObject.testOnly){
            if (!(interaction.guild.id === testServer)){
                interaction.reply({
                    content: 'This command cannot be ran here.',
                    flags: 64
                })
                return;
            }
        }

        if(commandObject.permissionsRequired?.length){
            for(const permission of commandObject.permissionsRequired){
                if (!interaction.member.permissions.has(permission)){
                    interaction.reply({
                        content: 'Not enough permissions for this command.',
                        ephemiral: true,
                    });
                    break;
                }
            }
        }
        if(commandObject.botPermissions?.length){
            for(const permission of commandObject.botPermissions){
                const bot = interaction.guild.members.me;

                if (!bot.permissions.has(permission)){
                    interaction.reply({
                        content: 'I dont have enough permissions for this command.',
                        ephemiral: true,
                    });
                    break;
                }
            }
        }

        await commandObject.callback(client, interaction);
    } catch (err) {
        error(`There was an error running this command: `, err)
    }
};