const { Collection, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const api = require("../../services/customApi");
const { log, info, warn, error } = require("../../services/logger")
const handleModals = require('../../events/interactionCreate/handleModals'); // Adjust path as needed
const Server = require("../../models/Server");
const activeVoiceChannels = new Collection();
const guildSettingsCache = new Map();
const processingUsers = new Set();

const fetchServerSettings = async (guildId) => {
    if (guildSettingsCache.has(guildId)) return guildSettingsCache.get(guildId);
    try {
        const server = await Server.findOne({ guildId }).lean();
        if (server) guildSettingsCache.set(guildId, server);
        return server;
    } catch (e) {
        error("Error fetching server settings: ", e);
        return null;
    }
};

const createVoiceChannel = async (guild, parentId, member, name = `${member.user.tag}'s Chat`) => {
    if (!guild) return null;
    try {
        const newVoiceChannel = await guild.channels.create({
            name: name,
            type: 2,
            parent: parentId,
            bitrate: 64000,
        }); 

        const permissions = [
            {
                id: guild.id, // Default role (everyone)
                allow: [ 
                    PermissionsBitField.Flags.UseEmbeddedActivities,
                    PermissionsBitField.Flags.UseExternalStickers,
                    PermissionsBitField.Flags.UseSoundboard,
                    PermissionsBitField.Flags.UseExternalApps,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.EmbedLinks,
                    PermissionsBitField.Flags.Stream,
                    PermissionsBitField.Flags.AddReactions,
                    PermissionsBitField.Flags.UseApplicationCommands,
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.Speak,
                    PermissionsBitField.Flags.UseVAD,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.AttachFiles,
                    PermissionsBitField.Flags.UseApplicationCommands,
                    PermissionsBitField.Flags.SendMessagesInThreads,
                    PermissionsBitField.Flags.UseExternalEmojis,
                ],
                deny: [
                    PermissionsBitField.Flags.SendPolls,
                    PermissionsBitField.Flags.ManageRoles,
                    PermissionsBitField.Flags.ManageEvents,
                    PermissionsBitField.Flags.ManageWebhooks,
                    PermissionsBitField.Flags.CreateEvents,
                    PermissionsBitField.Flags.UseExternalSounds,
                    PermissionsBitField.Flags.SendTTSMessages,
                    PermissionsBitField.Flags.SendVoiceMessages,
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.CreateInstantInvite,
                    PermissionsBitField.Flags.MuteMembers,
                    PermissionsBitField.Flags.DeafenMembers,
                    PermissionsBitField.Flags.MoveMembers,
                    PermissionsBitField.Flags.PrioritySpeaker,
                    PermissionsBitField.Flags.ManageMessages,
                    PermissionsBitField.Flags.MentionEveryone,
                ],
            },
            {
                id: guild.roles.cache.find(role => role.name === 'mod')?.id, // Moderators
                allow: [
                    PermissionsBitField.Flags.SendPolls,
                    PermissionsBitField.Flags.UseEmbeddedActivities,
                    PermissionsBitField.Flags.UseExternalStickers,
                    PermissionsBitField.Flags.UseSoundboard,
                    PermissionsBitField.Flags.UseExternalApps,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.EmbedLinks,
                    PermissionsBitField.Flags.Stream,
                    PermissionsBitField.Flags.AddReactions,
                    PermissionsBitField.Flags.UseApplicationCommands,
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.Speak,
                    PermissionsBitField.Flags.UseVAD,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.AttachFiles,
                    PermissionsBitField.Flags.UseApplicationCommands,
                    PermissionsBitField.Flags.SendMessagesInThreads,
                    PermissionsBitField.Flags.UseExternalEmojis,
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.MuteMembers,
                    PermissionsBitField.Flags.DeafenMembers,
                    PermissionsBitField.Flags.MoveMembers,
                    PermissionsBitField.Flags.ManageMessages,
                ],
                deny: [
                    PermissionsBitField.Flags.ManageRoles,
                    PermissionsBitField.Flags.ManageEvents,
                    PermissionsBitField.Flags.ManageWebhooks,
                    PermissionsBitField.Flags.CreateEvents,
                    PermissionsBitField.Flags.UseExternalSounds,
                    PermissionsBitField.Flags.SendTTSMessages,
                    PermissionsBitField.Flags.SendVoiceMessages,
                    PermissionsBitField.Flags.CreateInstantInvite,
                    PermissionsBitField.Flags.PrioritySpeaker,
                    PermissionsBitField.Flags.MentionEveryone,
                ],
            },
            {
                id: member.id, // Member who created the channel
                allow: [
                    PermissionsBitField.Flags.SendPolls,
                    PermissionsBitField.Flags.UseEmbeddedActivities,
                    PermissionsBitField.Flags.UseSoundboard,
                    PermissionsBitField.Flags.UseExternalApps,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.EmbedLinks,
                    PermissionsBitField.Flags.Stream,
                    PermissionsBitField.Flags.AddReactions,
                    PermissionsBitField.Flags.UseApplicationCommands,
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.Speak,
                    PermissionsBitField.Flags.UseVAD,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.AttachFiles,
                    PermissionsBitField.Flags.UseApplicationCommands,
                    PermissionsBitField.Flags.SendMessagesInThreads,
                    PermissionsBitField.Flags.UseExternalEmojis,
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.MuteMembers,
                    PermissionsBitField.Flags.DeafenMembers,
                    PermissionsBitField.Flags.MoveMembers,
                    PermissionsBitField.Flags.ManageMessages,
                ],
                deny: [
                    PermissionsBitField.Flags.ManageRoles,
                    PermissionsBitField.Flags.ManageEvents,
                    PermissionsBitField.Flags.ManageWebhooks,
                    PermissionsBitField.Flags.CreateEvents,
                    PermissionsBitField.Flags.UseExternalSounds,
                    PermissionsBitField.Flags.SendTTSMessages,
                    PermissionsBitField.Flags.SendVoiceMessages,
                    PermissionsBitField.Flags.CreateInstantInvite,
                    PermissionsBitField.Flags.PrioritySpeaker,
                    PermissionsBitField.Flags.MentionEveryone,
                    PermissionsBitField.Flags.UseExternalStickers,
                ],
            },
        ];

        await newVoiceChannel.permissionOverwrites.set(permissions);

        activeVoiceChannels.set(newVoiceChannel.id, {
            creatorId: member.id,
            timeout: setTimeout(() => checkAndDeleteEmptyChannel(newVoiceChannel), 10000),
        });
        info(`Created VC: ${newVoiceChannel.name} (ID: ${newVoiceChannel.id})`);
        return newVoiceChannel;
    } catch (e) {
        error("Error creating VC: ", e);
        return null;
    }
};

const moveToNewVoiceChannel = async (newState, newVoiceChannel) => {
    if (!newState || !newVoiceChannel || newState.channelId === newVoiceChannel.id) return;
    try {
        await newState.setChannel(newVoiceChannel);
        info(`Moved ${newState.member.user.tag} to ${newVoiceChannel.name}`);
    } catch (e) {
        error("error: Error moving user ", e);
    }
};

const handleVoiceStateUpdate = async (client, oldState, newState) => {
    if (!newState?.guild) return;
    const userId = newState.member?.id;
    if (processingUsers.has(userId)) return;
    processingUsers.add(userId);
    const channel = await newState.guild.channels.fetch(newState.channelId)


    try {
        const server = await fetchServerSettings(newState.guild.id);
        if (!server?.settings?.channels?.length) return;

        const oldChannel = oldState?.channel;
        const newChannel = newState?.channel;
        const isHubChannel = newChannel && server.settings.channels.some(c => c.channelId === newChannel.id);

        if (isHubChannel) {
            log(`${newState.member.user.tag} joined hub ${newChannel.name}`);
            const name = await namePrompting(newState.channel, userId);
            const newVC = await createVoiceChannel(newState.guild, newChannel.parentId, newState.member, name || undefined);
            if (newVC) await moveToNewVoiceChannel(newState, newVC);
        }
        if (oldChannel) await checkAndDeleteEmptyChannel(oldChannel);
    } catch (e) {
        error("Error handling voice state update", e);
    } finally {
        processingUsers.delete(userId);
    }
};

async function namePrompting(channel, userId) {
    try {
        // Send an initial message to the channel with the ephemeral flag
        const message = await channel.send({
            content: 'Preparing button...',
        });

        // Create the button with the 'SUCCESS' style (green)
        const button = new ButtonBuilder()
            .setCustomId('nameVoiceChat')
            .setLabel('Name Voice Chat')
            .setStyle(ButtonStyle.Success);

        // Create an action row to hold the button
        const row = new ActionRowBuilder().addComponents(button);

        // Send the message with the button
        await message.edit({
            content: `<@${userId}> click the button to name the voice chat:`,
            components: [row],
        });

        // Set up a filter to collect button interactions (only from the user who clicked the button)
        const filter = i => i.customId === 'nameVoiceChat' && i.user.id === userId;

        // Wait for a button interaction (timeout in 10 seconds)
        const collected = await channel.awaitMessageComponent({
            filter,
            time: 18000, // 10 seconds timeout
        }).catch(e => {
            error('Error collecting button interaction:', e);
            api.deleteEntity(message);
            return null;
        });

        // Handle interaction or timeout
        if (collected) {
            // Create the modal for input
            const modal = new ModalBuilder()
                .setCustomId('chatNameModal')
                .setTitle('Name Your Voice Chat')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('chatName')
                            .setLabel('Enter the name of the voice chat:')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );

            // Show the modal to the user
            await collected.showModal(modal);

            // Await modal submission
            try {
                const modalInteraction = await collected.awaitModalSubmit({
                    filter: (modalInteraction) => modalInteraction.customId === 'chatNameModal' && modalInteraction.user.id === collected.user.id,
                    time: 90000,  // Adjust time as needed
                });

                // Handle modal submission using the handleModals function
                const formData = await handleModals(modalInteraction);
                api.deleteEntity(message);

                // Check if formData is valid and chatName exists
                if (formData && formData.chatName) {
                    const chatName = formData.chatName;

                    // Respond to the user or continue with your logic
                    await modalInteraction.reply({
                        content: `Voice chat named: ${chatName}`,
                        flags: 64,
                    });

                    return chatName;  // Return the value to the function
                } else {
                    // Handle the case where chatName is missing or invalid
                    const m = await modalInteraction.reply({
                        content: 'You didn\'t provide a valid chat name.',
                    });
                    api.deleteEntity(m, 5000);
                    return null;
                }
            } catch (e) {
                error('Error handling modal submission:', e);
                api.deleteEntity(message);
                return null;  // Return null or handle errors as needed
            }
        } else {
            const m = await message.edit({
                content: 'You didn\'t click the button in time. Please try again later.',
                components: [], // Remove the button after timeout
            });
            api.deleteEntity(m, 5000);
            return null;
        }
    } catch (e) {
        error('Error in namePrompting function:', e);
        const m = await channel.send({
            content: 'There was an error while executing the command.',
        });
        api.deleteEntity(m, 5000);
        return null;
    }
}



const checkAndDeleteEmptyChannel = async (channel) => {
    if (!channel || !activeVoiceChannels.has(channel.id)) return;
    clearTimeout(activeVoiceChannels.get(channel.id)?.timeout);
    setTimeout(async () => {
        if (channel.members.size > 0) return;
        await api.deleteEntity(channel);
        activeVoiceChannels.delete(channel.id);
        warn(`Deleted empty voice channel: ${channel.name} (ID: ${channel.id})`);
    }, 5000);
};

module.exports = handleVoiceStateUpdate;
// When creating and moving member, check that they are still in the channel 
// Currently if you leave a tracked VC when the timer is up you will still be moved to a new created server