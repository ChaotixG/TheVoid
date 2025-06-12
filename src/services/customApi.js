const { Message, ModalSubmitInteraction, BaseChannel } = require('discord.js');
const { error } = require("./logger")

async function deleteMessage(interaction, timeout = 0) {
    if (!interaction) return;

    // Check if it's a Message or a ModalSubmitInteraction
    const isMessage = interaction instanceof Message;
    const isModalInteraction = interaction instanceof ModalSubmitInteraction;

    // If it's a Message, handle the message deletion
    if (isMessage && interaction.deletable) {
        const deleteDelay = timeout > 0 ? timeout : 0;
        setTimeout(async () => {
            try {
                await interaction.delete();
            } catch (err) {
                error(`Failed to delete message: `, err);
            }
        }, deleteDelay);
    }

    // If it's a ModalSubmitInteraction, handle modal interaction reply deletion
    else if (isModalInteraction) {
        const deleteDelay = timeout > 0 ? timeout : 0;
        setTimeout(async () => {
            try {
                await interaction.deleteReply();
            } catch (err) {
                error(`Failed to delete interaction: `, err);
            }
        }, deleteDelay);
    }
}



async function deleteEntity(entity, timeout = 0) {
    if (!entity) return;

    const isMessage = entity instanceof Message;
    const isModalInteraction = entity instanceof ModalSubmitInteraction;
    const isChannel = entity instanceof BaseChannel;

    const deleteDelay = timeout > 0 ? timeout : 0;

    setTimeout(async () => {
        try {
            if (isMessage && entity.deletable) {
                await entity.delete();
            } else if (isModalInteraction) {
                await entity.deleteReply();
            } else if (isChannel && entity.deletable) {
                await entity.delete();
            }
        } catch (err) {
            error(`Failed to delete entity: `, err);
        }
    }, deleteDelay);
}



async function delayedReply(interaction, content, delay = 5000, flags = 0) {
    // Wait for the specified delay before sending the message
    await new Promise(resolve => setTimeout(resolve, delay));

    // Check if the interaction was deferred
    if (interaction.deferred) {
        // If the message was deferred, edit the reply
        await interaction.editReply({
            content: content,
            flags: flags, // Use the passed flags
        });
    } else if (interaction.replied) {
        // If the message was replied to, use followUp
        await interaction.followUp({
            content: content,
            flags: flags, // Use the passed flags
        });
    } else {
        // If the message hasn't been replied or deferred, send the initial reply
        await interaction.reply({
            content: content,
            flags: flags, // Use the passed flags
        });
    }
}



async function archiveThread(thread, autoUnarchive = false, hours = 24) {
    if (!thread || !thread.isThread()) return;
    try {
        await thread.setArchived(true);
        if (autoUnarchive) {
            setTimeout(() => thread.setArchived(false), hours * 60 * 60 * 1000); // Unarchive after 24h
        }
    } catch (err) {
        error(`Failed to archive thread: `, err);
    }
}



async function deleteChannel(channel, timeout = 5000) {
    if (!channel) return;

    // If a channel ID is provided instead of the channel object
    if (typeof channel === 'string') {
        try {
            channel = await channel.guild.channels.fetch(channel);  // Fetch the channel by ID
        } catch (err) {
            error(`Failed to fetch channel with ID ${channel}: `, err);
            return;
        }
    }

    setTimeout(async () => {
        try {
            await channel.delete();
        } catch (err) {
            error(`Failed to delete channel: `, err);
        }
    }, timeout);
}



async function showModal(interaction, modal) {
    try {
        await interaction.showModal(modal);
    } catch (err) {
        error(`Error showing modal: `, err);
    }
}


const cooldowns = new Map();

function setCooldown(userId, commandName, timeMs) {
    const key = `${userId}-${commandName}`;
    cooldowns.set(key, Date.now() + timeMs);
    setTimeout(() => cooldowns.delete(key), timeMs);
}

function isOnCooldown(userId, commandName) {
    const key = `${userId}-${commandName}`;
    return cooldowns.has(key) && cooldowns.get(key) > Date.now();
}
module.exports = {deleteMessage, archiveThread, deleteChannel, showModal, delayedReply, deleteEntity, setCooldown, isOnCooldown}