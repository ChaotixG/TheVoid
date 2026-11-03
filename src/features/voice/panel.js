// Buttons and forms on a temporary voice channel's control panel ("vc:*" custom IDs).
const {
    ActionRowBuilder,
    ChannelType,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    RateLimitError,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} = require('discord.js');
const TempVoiceChannel = require('../../models/TempVoiceChannel');
const Member = require('../../models/Member');
const { getGuildSettings } = require('../../services/guildSettings');
const { setOwner, setLocked, isLocked, modRoleIdsFor, trackedOwner } = require('./hubs');
const { voicePanel } = require('./view');
const { ephemeral } = require('../../utils/interactionReplies');

async function handleInteraction(client, interaction) {
    const channel = interaction.channel;
    if (channel?.type !== ChannelType.GuildVoice) return interaction.reply(ephemeral('This only works inside a temporary voice channel.'));

    // Owner from memory so forms open instantly (Discord allows 3 seconds to respond)
    const ownerId = trackedOwner(channel.id);
    if (ownerId === undefined) return interaction.reply(ephemeral('I no longer manage this voice channel.'));
    const record = { ownerId };

    const { modRoleIds } = await getGuildSettings(interaction.guildId); // cached
    const userId = interaction.user.id;
    const isOwner = record.ownerId === userId;
    // Moderators (and anyone who can manage channels) can use every control
    const isModerator = interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)
        || modRoleIdsFor(interaction.guild, modRoleIds).some(id => interaction.member.roles.cache.has(id));
    const action = interaction.customId.split(':')[1];

    // ── Claim: anyone in the channel, once the owner has left ──
    if (action === 'claim') {
        if (isOwner) return interaction.reply(ephemeral('You already own this channel.'));
        if (!channel.members.has(userId)) return interaction.reply(ephemeral('Join the channel first, then claim it.'));
        if (record.ownerId && channel.members.has(record.ownerId) && !isModerator) {
            return interaction.reply(ephemeral(`<@${record.ownerId}> is still here, so the channel can't be claimed.`));
        }
        await interaction.deferUpdate();
        if (!await setOwner(channel, record.ownerId, userId, modRoleIds)) {
            return interaction.followUp(ephemeral('Someone else just took ownership.'));
        }
        return interaction.editReply(voicePanel(channel, userId, isLocked(channel)));
    }

    if (!isOwner && !isModerator) {
        const owner = record.ownerId ? `<@${record.ownerId}>` : 'the owner';
        return interaction.reply({ ...ephemeral(`Only ${owner} can change this channel. If they've left, use **Claim**.`), allowedMentions: { parse: [] } });
    }

    switch (action) {
        case 'rename':
            return interaction.showModal(textForm('vc:renamemodal', 'Rename channel', 'Channel name', 'name', channel.name, 100));

        case 'renamemodal': {
            const name = interaction.fields.getTextInputValue('name').trim();
            if (!name) return interaction.reply(ephemeral('The name can\'t be empty.'));
            await interaction.deferUpdate();
            try {
                await channel.setName(name, `Renamed by ${interaction.user.tag}`);
            } catch (err) {
                if (!(err instanceof RateLimitError)) throw err;
                const minutes = Math.max(1, Math.ceil(err.retryAfter / 60_000));
                return interaction.followUp(ephemeral(`Discord only allows 2 renames every 10 minutes. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`));
            }
            // Remembered for the owner's next channel
            if (isOwner) {
                await Member.updateOne({ guildId: interaction.guildId, userId }, { $set: { voiceChannelName: name } }, { upsert: true });
            }
            return interaction.editReply(voicePanel(channel, record.ownerId, isLocked(channel)));
        }

        case 'limit':
            return interaction.showModal(textForm('vc:limitmodal', 'User limit', 'Maximum members (0 = no limit)', 'limit', String(channel.userLimit), 2));

        case 'limitmodal': {
            const value = interaction.fields.getTextInputValue('limit').trim();
            const limit = /^\d+$/.test(value) ? Number(value) : NaN;
            if (!(limit >= 0 && limit <= 99)) return interaction.reply(ephemeral('The limit must be a whole number from 0 to 99.'));
            await interaction.deferUpdate();
            await channel.setUserLimit(limit, `Set by ${interaction.user.tag}`);
            return interaction.editReply(voicePanel(channel, record.ownerId, isLocked(channel)));
        }

        case 'lock':
        case 'unlock': {
            await interaction.deferUpdate();
            await setLocked(channel, record.ownerId, modRoleIds, action === 'lock');
            return interaction.editReply(voicePanel(channel, record.ownerId, action === 'lock'));
        }

        case 'transfer': {
            const select = new UserSelectMenuBuilder()
                .setCustomId('vc:transferselect')
                .setPlaceholder('Choose the new owner (must be in the channel)')
                .setMinValues(1)
                .setMaxValues(1);
            return interaction.reply({
                content: 'Who should own this channel?',
                components: [new ActionRowBuilder().addComponents(select)],
                flags: MessageFlags.Ephemeral,
            });
        }

        case 'transferselect': {
            const targetId = interaction.values[0];
            const target = interaction.users.get(targetId);
            if (target?.bot) return interaction.update({ content: 'Bots can\'t own channels. Choose someone else.' });
            if (targetId === record.ownerId) return interaction.update({ content: 'They already own this channel.' });
            if (!channel.members.has(targetId)) return interaction.update({ content: `<@${targetId}> needs to be in the channel first.`, allowedMentions: { parse: [] } });

            await interaction.deferUpdate();
            if (!await setOwner(channel, record.ownerId, targetId, modRoleIds)) {
                return interaction.editReply({ content: 'Ownership changed in the meantime; open the panel again.', components: [] });
            }
            await interaction.editReply({ content: `👑 <@${targetId}> now owns this channel.`, components: [], allowedMentions: { parse: [] } });
            const { panelMessageId } = await TempVoiceChannel.findOne({ channelId: channel.id }, { panelMessageId: 1 }).lean() ?? {};
            if (panelMessageId) {
                await channel.messages.edit(panelMessageId, voicePanel(channel, targetId, isLocked(channel))).catch(() => {});
            }
            return;
        }
    }
}

function textForm(customId, title, label, inputId, value, maxLength) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(
            new TextInputBuilder().setCustomId(inputId).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(maxLength).setValue(value)
        ));
}

module.exports = { handleInteraction };
