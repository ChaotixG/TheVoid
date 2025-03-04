const activeVoiceChannels = new Map(); // Store dynamically created VCs
const Server = require('../../models/Server');

async function waitForValidState(memberId, client, newState, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const guild = client.guilds.cache.get(newState.guild.id);
        if (!guild) return reject(new Error("Guild not found"));

        let elapsedTime = 0;
        const checkInterval = setInterval(() => {
            const member = guild.members.cache.get(memberId);

            if (member?.voice?.channel) {
                clearInterval(checkInterval);
                resolve(member.voice.channel);
            }

            elapsedTime += 200;
            if (elapsedTime >= timeout) {
                clearInterval(checkInterval);
                reject(new Error("Timeout: No valid voice state found"));
            }
        }, 200);
    });
}

async function createVoiceChannel(guild, parentId, memberTag) {
    try {
        const newVoiceChannel = await guild.channels.create({
            name: `${memberTag}'s VC`,
            type: 2, // Voice channel type
            parent: parentId,
            bitrate: 64000,
            userLimit: 0,
        });

        activeVoiceChannels.set(newVoiceChannel.id, { creatorId: guild.members.me.id, channel: newVoiceChannel });
        return newVoiceChannel;
    } catch (error) {
        console.error("Error creating voice channel:", error.message);
        throw error;
    }
}

async function moveToNewVoiceChannel(newState, newVoiceChannel) {
    if (newState.channel?.id !== newVoiceChannel.id) {
        try {
            await newState.setChannel(newVoiceChannel);
            console.log(`Created and moved to: ${newVoiceChannel.name}`);
        } catch (error) {
            console.error("Error moving user:", error.message);
        }
    }
}

async function handleVoiceStateUpdate(client, oldState, newState) {
    const user = newState.member?.user?.tag;
    const oldChannel = oldState.channel;
    let newChannel = newState.channel;

    // Fetch server settings
    const server = await Server.findOne({ guildId: newState.guild.id });
    if (!server?.settings?.channels?.length) return;

    try {
        if (!oldChannel && newChannel) {
            console.log(`${user} joined ${newChannel.name}`);
            if (server.settings.channels.some(c => c.channelId === newChannel.id)) {
                await createAndMoveVoiceChannel(newState);
            }
        } else if (oldChannel && !newChannel) {
            console.log(`${user} left ${oldChannel.name}`);
            await checkAndDeleteEmptyChannel(oldChannel);
        } else if (oldChannel?.id !== newChannel?.id) {
            console.log(`${user} switched from ${oldChannel.name} to ${newChannel.name}`);
            if (server.settings.channels.some(c => c.channelId === newChannel.id)) {
                await createAndMoveVoiceChannel(newState);
            }
            await checkAndDeleteEmptyChannel(oldChannel);
        }

        if (!newChannel) {
            newChannel = await waitForValidState(newState.member.id, newState.client, newState).catch(err => {
                console.error(`Error waiting for valid state: ${err.message}`);
                return null;
            });
            if (newChannel) console.log(`${user} fully joined ${newChannel.name} after waiting`);
        }
    } catch (error) {
        console.error(`Error handling voice state update: ${error.message}`);
    }
}

async function createAndMoveVoiceChannel(newState) {
    if (!newState.channel) return;

    try {
        const newVoiceChannel = await createVoiceChannel(newState.guild, newState.channel.parentId, newState.member.user.tag);
        await moveToNewVoiceChannel(newState, newVoiceChannel);
    } catch (error) {
        console.error("Error in creating and moving voice channel:", error.message);
    }
}

async function checkAndDeleteEmptyChannel(channel) {
    if (!channel || !activeVoiceChannels.has(channel.id)) return;

    const { creatorId } = activeVoiceChannels.get(channel.id);
    if (creatorId !== channel.guild.members.me.id) return;

    if (!channel.guild.channels.cache.has(channel.id)) {
        console.log(`Channel ${channel.name} was already deleted.`);
        activeVoiceChannels.delete(channel.id);
        return;
    }

    if (channel.members.size === 0) {
        setTimeout(async () => {
            if (channel.guild.channels.cache.has(channel.id) && channel.members.size === 0) {
                try {
                    await channel.delete();
                    activeVoiceChannels.delete(channel.id);
                    console.log(`Deleted empty voice channel: ${channel.name}`);
                } catch (error) {
                    console.error(`Error deleting channel ${channel.name}: ${error.message}`);
                }
            }
        }, 5000);
    }
}

module.exports = handleVoiceStateUpdate;
