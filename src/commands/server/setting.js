const {
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const Server = require('../../models/Server');
const { log, info, warn, error } = require('../../services/logger');

// ────────────────────────────────────────────────────────────────
// ONE ACTIVE DASHBOARD PER USER (prevents conflicts)
// ────────────────────────────────────────────────────────────────
const activeSessions = new Map(); // user.id → collector

module.exports = {
  name: 'settings',
  description: 'Configure server settings (voice hubs, tickets, etc.)',
  permissionsRequired: [PermissionFlagsBits.Administrator],

  callback: async (client, interaction) => {
    try {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: 'You need **Administrator** permission to use this command.',
          ephemeral: true,
        });
      }

      // Close any existing session for this user
      if (activeSessions.has(interaction.user.id)) {
        const oldCollector = activeSessions.get(interaction.user.id);
        oldCollector.stop('replaced');
        activeSessions.delete(interaction.user.id);
      }

      await interaction.deferReply({ ephemeral: true });

      await showDashboard(interaction);
    } catch (err) {
      error('Settings command error:', err);
      return interaction.editReply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  }
}

// ────────────────────────────────────────────────────────────────
// DASHBOARD / HOME SCREEN
// ────────────────────────────────────────────────────────────────
async function showDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`${interaction.guild.name} Settings Dashboard`)
    .setDescription('Select a category to configure:')
    .addFields(
      { name: 'Voice Hubs', value: 'Manage private voice chat creation', inline: true },
      { name: 'Tickets', value: 'Configure ticket destination channels', inline: true },
      { name: 'Options', value: 'Additional settings', inline: true }
    )
    .setFooter({ text: 'Session expires in 5 minutes' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('goto_voice').setLabel('Voice Hubs').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('goto_tickets').setLabel('Tickets').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('goto_options').setLabel('Options').setStyle(ButtonStyle.Secondary).setDisabled(true)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });

  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id,
    time: 300_000,
  });

  // Register this as the active session
  activeSessions.set(interaction.user.id, collector);

  collector.on('collect', async (i) => {
    await i.deferUpdate();

    if (i.customId === 'goto_voice') {
      collector.stop('nav');
      await handleVoiceSettings(interaction);
    } else if (i.customId === 'goto_tickets') {
      collector.stop('nav');
      await handleTicketSettings(interaction);
    } else if (i.customId === 'goto_options') {
      await interaction.editReply({
        content: 'Options settings are not implemented yet.', 
        embeds: [],
        components: [],
      });
    }
  });

  collector.on('end', async (_, reason) => {
    activeSessions.delete(interaction.user.id);

    if (reason !== 'nav' && reason !== 'replaced') {
      await interaction.editReply({
        content: 'Dashboard session ended.',
        embeds: [],
        components: [],
      }).catch(() => {});
    }
  });
}

// ────────────────────────────────────────────────────────────────
// VOICE HUBS SECTION
// ────────────────────────────────────────────────────────────────
async function handleVoiceSettings(interaction) {
  await nameUpdate(interaction.guild);

  let server = await Server.findOne({ guildId: interaction.guild.id });
  if (!server) {
    server = new Server({ guildId: interaction.guild.id, settings: { channels: [] } });
    await server.save();
  }

  let channels = server.settings.channels || [];
  let selectedIndex = 0;
  const ITEMS_PER_PAGE = 5;

  const refresh = async (notify = null) => {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Voice Hub Channels')
      .setTimestamp();

    let components = [];

    if (channels.length === 0) {
      embed.setDescription('No voice hubs are currently tracked.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('add').setLabel('+ Add Hub').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('back_to_dashboard').setLabel('← Dashboard').setStyle(ButtonStyle.Secondary)
      );
      components = [row];
    } else {
      const start = Math.floor(selectedIndex / ITEMS_PER_PAGE) * ITEMS_PER_PAGE;
      const slice = channels.slice(start, start + ITEMS_PER_PAGE);

      const desc = slice
        .map((ch, i) => {
          const idx = start + i;
          const prefix = idx === selectedIndex ? '👉 ' : '  ';
          return `${prefix}**${ch.name}** (ID: ${ch.channelId})`;
        })
        .join('\n');

      embed.setDescription(`Tracked hubs (${channels.length} total):\n${desc || '(empty page)'}`);

      const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev').setLabel('⬆ Previous').setStyle(ButtonStyle.Primary).setDisabled(selectedIndex === 0),
        new ButtonBuilder().setCustomId('next').setLabel('Next ⬇').setStyle(ButtonStyle.Primary).setDisabled(selectedIndex >= channels.length - 1)
      );

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('add').setLabel('+ Add').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('remove').setLabel('🗑 Remove').setStyle(ButtonStyle.Danger).setDisabled(false),
        new ButtonBuilder().setCustomId('back_to_dashboard').setLabel('← Dashboard').setStyle(ButtonStyle.Secondary)
      );

      components = [navRow, actionRow];
    }

    const payload = { embeds: [embed], components, content: notify || null };

    return await interaction.editReply(payload);
  };

  let message = await refresh();

  while (true) {
    let buttonInteraction;
    try {
      buttonInteraction = await message.awaitMessageComponent({
        filter: i => i.user.id === interaction.user.id,
        time: 180_000,
      });
    } catch {
      await interaction.editReply({ content: 'Session ended.', components: [] }).catch(() => {});
      return;
    }

    await buttonInteraction.deferUpdate();

    let notify = null;

    if (buttonInteraction.customId === 'prev') {
      if (selectedIndex > 0) selectedIndex--;
    } else if (buttonInteraction.customId === 'next') {
      if (selectedIndex < channels.length - 1) selectedIndex++;
    } else if (buttonInteraction.customId === 'remove') {
      if (channels.length === 0) {
        notify = 'No channels to remove.';
        message = await refresh(notify);
        continue;
      }

      const toRemove = channels[selectedIndex];

      const confirmEmbed = new EmbedBuilder()
        .setColor('#ff4444')
        .setTitle('Confirm Removal')
        .setDescription(`Remove **${toRemove.name}** (ID: ${toRemove.channelId})?\nThis cannot be undone.`);

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_remove_yes').setLabel('Yes, Remove').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('confirm_remove_no').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );

      message = await interaction.editReply({
        embeds: [confirmEmbed],
        components: [confirmRow],
        content: null,
      });

      let confirmInteraction;
      try {
        confirmInteraction = await message.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && ['confirm_remove_yes', 'confirm_remove_no'].includes(i.customId),
          time: 30_000,
        });
      } catch {
        notify = 'Confirmation timed out.';
        message = await refresh(notify);
        continue;
      }

      await confirmInteraction.deferUpdate();

      if (confirmInteraction.customId === 'confirm_remove_yes') {
        const removed = channels.splice(selectedIndex, 1)[0];
        await Server.updateOne(
          { guildId: interaction.guild.id },
          { $set: { 'settings.channels': channels } }
        );
        notify = `🗑 Removed **${removed.name}**`;
        selectedIndex = Math.min(selectedIndex, channels.length - 1);
      } else {
        notify = 'Cancelled.';
      }
    } else if (buttonInteraction.customId === 'add') {
      const voiceChannels = buttonInteraction.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice);
      const voiceArray = [...voiceChannels.values()].map(c => ({ name: c.name, channelId: c.id }));

      const existingIds = new Set(channels.map(c => c.channelId));

      const available = voiceArray.filter(c => !existingIds.has(c.channelId));

      if (available.length === 0) {
        notify = 'No available voice channels left to add.';
        message = await refresh(notify);
        continue;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('add_voice_select')
        .setPlaceholder('Choose voice channel to add as hub')
        .addOptions(
          available.map(c => ({
            label: c.name.slice(0, 100),
            value: c.channelId,
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      message = await interaction.editReply({
        content: 'Select a voice channel to add as hub:',
        components: [row],
        embeds: [],
      });

      let selectInteraction;
      try {
        selectInteraction = await message.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && i.customId === 'add_voice_select' && i.isStringSelectMenu(),
          time: 60_000,
        });
      } catch {
        notify = 'Time ran out — no channel added.';
        message = await refresh(notify);
        continue;
      }

      await selectInteraction.deferUpdate();

      const channelId = selectInteraction.values[0];
      const ch = available.find(c => c.channelId === channelId);

      if (ch) {
        channels.push({ name: ch.name, channelId: ch.channelId });
        await Server.updateOne(
          { guildId: interaction.guild.id },
          { $set: { 'settings.channels': channels } }
        );
        await nameUpdate(interaction.guild);
        notify = `✅ Added **${ch.name}** as voice hub.`;
      } else {
        notify = 'Invalid selection.';
      }
    } else if (buttonInteraction.customId === 'back_to_dashboard') {
      return showDashboard(interaction);
    }

    message = await refresh(notify);
  }
}

// ────────────────────────────────────────────────────────────────
// TICKETS SECTION
// ────────────────────────────────────────────────────────────────
async function handleTicketSettings(interaction) {
  let server = await Server.findOne({ guildId: interaction.guild.id });
  if (!server) {
    server = new Server({ guildId: interaction.guild.id, settings: { tickets: {} } });
    await server.save();
  }

  let tickets = server.settings.tickets || {
    troubleshooting: null,
    suggestions: null,
    complaints: null,
  };

  const categories = [
    { key: 'troubleshooting', label: 'Troubleshooting' },
    { key: 'suggestions', label: 'Suggestions' },
    { key: 'complaints', label: 'Complaints' },
  ];

  let selectedIndex = 0;

  const refresh = async (notify = null) => {
    const embed = new EmbedBuilder()
      .setColor('#00aaff')
      .setTitle('Ticket Categories')
      .setDescription('Choose a category to configure its target channel/forum.');

    const desc = categories
      .map((cat, i) => {
        const prefix = i === selectedIndex ? '👉 ' : '  ';
        const setting = tickets[cat.key];
        let line = `${prefix}**${cat.label}**`;
        if (setting?.channelId) line += ` → <#${setting.channelId}> (${setting.type || 'unknown'})`;
        else line += ' → *not set*';
        return line;
      })
      .join('\n');

    embed.setDescription(desc || 'No categories configured.');

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev').setLabel('⬅ Prev').setStyle(ButtonStyle.Primary).setDisabled(selectedIndex === 0),
      new ButtonBuilder().setCustomId('next').setLabel('Next ➡').setStyle(ButtonStyle.Primary).setDisabled(selectedIndex >= categories.length - 1)
    );

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('set').setLabel('✏ Set').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('clear').setLabel('🗑 Clear').setStyle(ButtonStyle.Danger).setDisabled(!tickets[categories[selectedIndex].key]?.channelId),
      new ButtonBuilder().setCustomId('back_to_dashboard').setLabel('← Dashboard').setStyle(ButtonStyle.Secondary)
    );

    const payload = { embeds: [embed], components: [navRow, actionRow] };
    if (notify) payload.content = notify;

    return await interaction.editReply(payload);
  };

  let message = await refresh();

  while (true) {
    let buttonInteraction;
    try {
      buttonInteraction = await message.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        time: 180_000,
      });
    } catch {
      await interaction.editReply({ content: 'Session ended.', components: [] }).catch(() => {});
      return;
    }

    const currentCategory = categories[selectedIndex];
    const key = currentCategory.key;
    let notify = null;

    if (buttonInteraction.customId === 'set') {
      await buttonInteraction.deferUpdate();

      message = await interaction.editReply({
        content: `Enter the channel ID or #mention for ${currentCategory.label} (or "cancel" to abort):`,
        embeds: [],
        components: [],
      });

      const msgCollector = interaction.channel.createMessageCollector({
        filter: m => m.author.id === interaction.user.id,
        max: 1,
        time: 180_000,
      });

      msgCollector.on('collect', async (m) => {
        const raw = m.content.trim().toLowerCase();
        if (raw === 'cancel') {
          notify = 'Set operation cancelled.';
          await m.delete().catch(() => {});
          return msgCollector.stop();
        }

        let channelId = null;

        const mentionMatch = raw.match(/^<#(\d+)>$/);
        if (mentionMatch) {
          channelId = mentionMatch[1];
        } else if (/^\d{17,19}$/.test(raw)) {
          channelId = raw;
        } else {
          notify = 'Invalid format. Please enter a valid channel ID or #mention.';
          await m.delete().catch(() => {});
          return msgCollector.stop();
        }

        try {
          const channel = await interaction.guild.channels.fetch(channelId);
          if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildForum)) {
            notify = 'Channel not found or invalid type. Must be a text channel or forum channel.';
          } else {
            const type = channel.type === ChannelType.GuildForum ? 'forum' : 'channel';
            tickets[key] = { channelId: channel.id, type };
            await Server.updateOne(
              { guildId: interaction.guild.id },
              { $set: { 'settings.tickets': tickets } }
            );
            notify = `Set **${currentCategory.label}** to <#${channel.id}> (${type}).`;
          }
        } catch (e) {
          console.error(e);
          notify = 'Error fetching or setting the channel.';
        }

        await m.delete().catch(() => {});
        msgCollector.stop();
      });

      msgCollector.on('end', async () => {
        message = await refresh(notify);
      });

      continue;
    } else {
      await buttonInteraction.deferUpdate();

      if (buttonInteraction.customId === 'prev') {
        if (selectedIndex > 0) selectedIndex--;
      } else if (buttonInteraction.customId === 'next') {
        if (selectedIndex < categories.length - 1) selectedIndex++;
      } else if (buttonInteraction.customId === 'clear') {
        tickets[key] = null;
        notify = `Cleared **${currentCategory.label}** target.`;
        await Server.updateOne(
          { guildId: interaction.guild.id },
          { $set: { 'settings.tickets': tickets } }
        );
      } else if (buttonInteraction.customId === 'back_to_dashboard') {
        return showDashboard(interaction);
      }

      message = await refresh(notify);
    }
  }
}
// ────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ────────────────────────────────────────────────────────────────
async function nameUpdate(guild) {
  try {
    const server = await Server.findOne({ guildId: guild.id });
    if (!server?.settings?.channels?.length) return;

    let updated = false;
    for (const saved of server.settings.channels) {
      const live = guild.channels.cache.get(saved.channelId);
      if (live?.type === ChannelType.GuildVoice && live.name !== saved.name) {
        saved.name = live.name;
        updated = true;
      }
    }

    if (updated) {
      await Server.updateOne(
        { guildId: guild.id },
        { $set: { 'settings.channels': server.settings.channels } }
      );
      info(`Updated channel names for guild ${guild.id}`);
    }
  } catch (err) {
    error('nameUpdate error:', err);
  }
}