// src/utils/rehydrateVoiceChannels.js
const { Collection } = require("discord.js");
const Server = require("../models/Server");
const { warn, error, info } = require("../services/logger");
const api = require("../services/customApi");

const activeVoiceChannels = require("../cache/voiceChannels");

async function rehydrateVoiceChannels(client) {
    const servers = await Server.find({}).lean();
    let restoredCount = 0;
    let deletedCount = 0;

    for (const server of servers) {
        const guild = await client.guilds.fetch(server.guildId).catch(() => null);
        if (!guild) continue;

        for (const ch of server.channels) {
            const channel = await guild.channels.fetch(ch.channelId).catch(() => null);
            if (!channel) {
                warn(`Channel ${ch.channelId} missing. Cleaning up DB.`);
                await Server.updateOne(
                    { guildId: server.guildId },
                    { $pull: { channels: { channelId: ch.channelId } } }
                );
                deletedCount++;
                continue;
            }

            if (channel.members.size === 0) {
                warn(`Deleting empty channel ${channel.name} on startup.`);
                await api.deleteEntity(channel);
                await Server.updateOne(
                    { guildId: server.guildId },
                    { $pull: { channels: { channelId: ch.channelId } } }
                );
                deletedCount++;
            } else {
                activeVoiceChannels.set(channel.id, {
                    creatorId: channel.members.first()?.id || null,
                    timeout: setTimeout(() => checkAndDeleteEmptyChannel(channel), 10000)
                });
                info(`Rehydrated active VC ${channel.name}`);
                restoredCount++;
            }
        }
    }

    info(`Rehydration complete: ${restoredCount} channels restored, ${deletedCount} deleted.`);
}

async function checkAndDeleteEmptyChannel(channel) {
    try {
        if (!channel || !activeVoiceChannels.has(channel.id)) return;
        clearTimeout(activeVoiceChannels.get(channel.id)?.timeout);

        if (channel.members.size === 0) {
            await api.deleteEntity(channel);
            activeVoiceChannels.delete(channel.id);
            await Server.updateOne(
                { guildId: channel.guild.id },
                { $pull: { channels: { channelId: channel.id } } }
            );
            warn(`Deleted empty VC ${channel.name}`);
        }
    } catch (e) {
        error(`checkAndDeleteEmptyChannel error for ${channel.id}`, e);
    }
}

module.exports = { rehydrateVoiceChannels, activeVoiceChannels };
