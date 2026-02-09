const { Collection, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const api = require("../../services/customApi");
const { log, info, warn, error } = require("../../services/logger")
const handleModals = require('../../events/interactionCreate/handleModals'); // Adjust path as needed
const Server = require("../../models/Server");
const activeVoiceChannels = require("../../cache/voiceChannels");
const guildSettingsCache = new Map();
const processingUsers = new Set();

const fetchServerSettings = async (guildId) => {
    if (guildSettingsCache.has(guildId)) return guildSettingsCache.get(guildId);
    try {
        const server = await Server.findOne({ guildId }).lean();
        if (server) guildSettingsCache.set(guildId, server);
        return server;
    } catch (err) {
        error("Error fetching server settings: ", err);
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
    } catch (err) {
        error("Error creating VC: ", err);
        return null;
    }
};

const moveToNewVoiceChannel = async (newState, newVoiceChannel) => {
    if (!newState || !newVoiceChannel || newState.channelId === newVoiceChannel.id) return;
    try {
        await newState.setChannel(newVoiceChannel);
        info(`Moved ${newState.member.user.tag} to ${newVoiceChannel.name}`);
    } catch (err) {
        error("Error moving user ", err);
    }
};

const isUserStillInChat = async (channel, userId) => {
    if (channel && userId && channel.members.has(userId)) {
        info('user is here');
        return true;
    } else {
        info('user left');
        return false;
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
            const userState = await isUserStillInChat(newChannel, userId);
            if(!userState){return;}
            const newVC = await createVoiceChannel(newState.guild, newChannel.parentId, newState.member, name || undefined);
            addServer(newVC);
            if (newVC) await moveToNewVoiceChannel(newState, newVC);
        }
        if (oldChannel) await checkAndDeleteEmptyChannel(oldChannel);
    } catch (err) {
        error("Error handling voice state update: ", err);
    } finally {
        processingUsers.delete(userId);
    }
};

async function namePrompting(channel, userId) {
    try {
        const message = await channel.send({ content: 'Preparing button...' });

        const button = new ButtonBuilder()
            .setCustomId('nameVoiceChat')
            .setLabel('Name Voice Chat')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(button);

        await message.edit({
            content: `<@${userId}> click the button to name the voice chat:`,
            components: [row],
        });

        const filter = i => i.customId === 'nameVoiceChat' && i.user.id === userId;

        const collected = await channel.awaitMessageComponent({
            filter,
            time: 18000,
        }).catch(err => {
            error('Error collecting button interaction: ', err);
            api.deleteEntity(message);
            return null;
        });

        if (!collected) {
            const m = await message.edit({
                content: 'You didn\'t click the button in time. Please try again later.',
                components: [],
            });
            api.deleteEntity(m, 5000);
            return null;
        }

        // ── Modal part ────────────────────────────────────────
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

        await collected.showModal(modal);

        try {
            const modalInteraction = await collected.awaitModalSubmit({
                filter: i => i.customId === 'chatNameModal' && i.user.id === collected.user.id,
                time: 90000,
            });

            await modalInteraction.deferReply({ ephemeral: true });

            const chatName = modalInteraction.fields.getTextInputValue('chatName')?.trim() || '';

            api.deleteEntity(message);

            if (!chatName) {
                await modalInteraction.editReply({
                    content: 'You didn\'t provide a valid chat name.',
                });
                return null;
            }

            await modalInteraction.editReply({
                content: `Voice chat named: ${chatName}`,
            });

            return chatName;

        } catch (err) {
            error('Error handling modal submission: ', err);
            api.deleteEntity(message);
            return null;
        }

    } catch (err) {
        error('Error in namePrompting function: ', err);
        const m = await channel.send({
            content: 'There was an error while executing the command.',
        });
        api.deleteEntity(m, 5000);
        return null;
    }
}



const checkAndDeleteEmptyChannel = async (channel) => {
    try {
        if (!channel || !activeVoiceChannels.has(channel.id)) return;
        clearTimeout(activeVoiceChannels.get(channel.id)?.timeout);
        setTimeout(async () => {
            if (channel.members.size > 0) return;
            await api.deleteEntity(channel);
            remServer(channel.id, channel.guild.id);
            activeVoiceChannels.delete(channel.id);
            warn(`Deleted empty voice channel: ${channel.name} (ID: ${channel.id})`);
        }, 5000);
        
    } catch (err) {
        error(`Error checking and deleting empty channel ${channel.name} (ID: ${channel.id}): `, err);
    }
};

async function addServer (newVC){
    const server = await Server.findOne({ guildId: newVC.guild.id });
    server.channels.push({
        channelName: newVC.name,
        channelId: newVC.id,
    });
    try {
        await Server.updateOne(
            { guildId: newVC.guild.id },
            { $set: { 'channels': server.channels } }
        );

        // Send a confirmation message
        info(`Channel ${newVC.name} added to server database.`);
    } catch (err) {
        error('Error updating database: ', err);
    }
}

async function remServer(channelId, guildId) {
    try {
        const server = await Server.findOne({ guildId });

        if (!server) {
            error(`Server not found with guildId: `, guildId);
            return;
        }

        const before = server.channels.length;
        server.channels = server.channels.filter(ch => ch.channelId !== channelId);

        if (server.channels.length === before) {
            warn(`Channel ID ${channelId} not found in DB for guild ${guildId}`);
            return;
        }

        await Server.updateOne(
            { guildId },
            { $set: { channels: server.channels } }
        );

        info(`Channel ${channelId} removed from server database.`);
    } catch (err) {
        error('Error removing channel from database: ', err);
    }
}

module.exports = handleVoiceStateUpdate;