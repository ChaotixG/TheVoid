const { EmbedBuilder, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const Server = require('../../models/Server');

module.exports = {
    name: 'settings',
    description: 'Sets up the server settings!',
    options: [
        {
            type: 1,
            name: 'voicechannels',
            description: 'Manage voice channel settings',
        },
        {
            type: 1,
            name: 'other',
            description: 'Handle other settings'
        }
    ],
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        await interaction.deferReply( {flags: 64} );
        const subcommand = interaction.options.getSubcommand();

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply({ content: 'You do not have permission to modify voice channels.' });
        }

        // Fetch server settings
        const server = await Server.findOne({ guildId: interaction.guild.id });
        let channels = server?.settings?.channels || []; // Ensure channels exist

        if (subcommand === 'voicechannels') {
            let index = 0; // Start at the first channel

            // Function to get embed content
            const getEmbed = () => {
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('Voice Channel Settings')
                    .setTimestamp();

                let rows = [];

                if (Array.isArray(channels) && channels.length > 0) {
                    // Create buttons for navigation
                    const row1 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('prev').setLabel('⬆️').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('next').setLabel('⬇️').setStyle(ButtonStyle.Primary),
                    );
                    const row2 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('add').setLabel('+ Add').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('remove').setLabel('🗑 Remove').setStyle(ButtonStyle.Danger)
                    );
                    rows = [row1, row2];
                    embed.setDescription(`Currently selected:\n**${channels[index].name}** (ID: ${channels[index].channelId})`);
                } else {
                    const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('add').setLabel('+ Add').setStyle(ButtonStyle.Success));
                    rows = [row1];
                    embed.setDescription('No voice channels are currently tracked.');
                }

                return { embed, rows };
            };

            // Send initial message
            const { embed, rows } = getEmbed();
            const message = await interaction.editReply({ embeds: [embed], components: rows });

            // Button interaction collector
            const collector = message.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async (buttonInteraction) => {
                // Ensure the user who clicked the button is the same as the command invoker
                if (buttonInteraction.user.id !== interaction.user.id) return;

                // Acknowledge the button interaction
                await buttonInteraction.deferUpdate();

                if (buttonInteraction.customId === 'prev') {
                    index = (index - 1 + channels.length) % channels.length; // Wrap around
                } else if (buttonInteraction.customId === 'next') {
                    index = (index + 1) % channels.length;
                } else if (buttonInteraction.customId === 'remove') {
                    if (channels.length > 0) {
                        const removedChannel = channels.splice(index, 1)[0];

                        // Update the database
                        await Server.updateOne(
                            { guildId: interaction.guild.id },
                            { $set: { 'settings.channels': channels } }
                        );

                        index = Math.min(index, channels.length - 1); // Adjust index if necessary

                        await interaction.editReply({ content: `✅ Removed **${removedChannel.name}** from tracked channels.` });
                    } else {
                        await interaction.editReply({ content: '⚠ No channels to remove.' });
                    }
                } else if (buttonInteraction.customId === 'add') {
                    // Call the add() function when the 'Add' button is clicked
                    await add(buttonInteraction);
                }

                // Update the embed and components
                const { embed, rows } = getEmbed();
                await interaction.editReply({ embeds: [embed], components: rows });
            });

            collector.on('end', async (collected, reason) => {
                console.log(`Select menu collector ended due to: ${reason}`);
                if (reason === 'time') {
                    await buttonInteraction.editReply({
                        content: '⚠ You took too long to select a channel. Please try again.',
                        components: []
                    });
                }
            });
        } else if (subcommand === 'other') {
            await interaction.editReply({ content: 'Other settings logic here!' });
        }
    },
};

// Function to add a channel
async function add(buttonInteraction) {
    const voiceChannels = buttonInteraction.guild.channels.cache.filter(channel => channel.type === ChannelType.GuildVoice);
    const voiceChannelArray = [...voiceChannels.values()].map(channel => ({
        name: channel.name,
        channelId: channel.id
    }));

    console.log(voiceChannelArray); // This will log an array of objects with name and id

    if (voiceChannelArray.length === 0) {
        return buttonInteraction.editReply({ content: '⚠ No voice channels found in the server.' });
    }

    // Retrieve the server settings from the database
    const server = await Server.findOne({ guildId: buttonInteraction.guild.id });
    const channels = server?.settings?.channels || [];

    // Filter out channels that are already saved in the database
    const availableChannels = voiceChannelArray.filter(channel => !channels.some(savedChannel => savedChannel.channelId === channel.channelId));

    if (availableChannels.length === 0) {
        return buttonInteraction.editReply({ content: '⚠ All voice channels are already tracked in the server.' });
    }

    // Create the select menu options with available voice channel names
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_channel') // Set an ID to track the response
        .setPlaceholder('Select a voice channel')
        .addOptions(
            availableChannels.map(channel => ({
                label: channel.name, // Channel name displayed in the select menu
                value: channel.channelId, // Channel ID used internally
            }))
        );

    // Create an action row to send the select menu
    const row = new ActionRowBuilder().addComponents(selectMenu);

    // Send the select menu to the user and clear previous components
    await buttonInteraction.editReply({
        content: 'Please select a voice channel to add:',
        components: [row]
    });

    // Wait for the user's response
    const filter = (interaction) =>
        interaction.isStringSelectMenu() &&
        interaction.customId === 'select_channel' &&
        interaction.user.id === buttonInteraction.user.id;

    console.log('Collector is now active for 25 seconds.');

    const collector = buttonInteraction.channel.createMessageComponentCollector({
        filter,
        time: 25000, // Set to 25 seconds for easier testing
    });

    collector.on('collect', async (selectInteraction) => {
        console.log('Option selected:', selectInteraction.values[0]); // Log selected value
        const selectedChannelId = selectInteraction.values[0]; // Get the selected channel ID
        const selectedChannel = availableChannels.find(channel => channel.channelId === selectedChannelId); // Find the selected channel
        
        // Pass the selected channel, buttonInteraction, and selectInteraction to the update function
        await update(selectedChannel, buttonInteraction, selectInteraction);
    });

    collector.on('end', (collected, reason) => {
        console.log(`Collector ended due to: ${reason}`);
        if (reason === 'time') {
            buttonInteraction.editReply({ content: '⚠ You took too long to select a channel.', components: [] });
        }
    });
}


async function update(selectedChannel, buttonInteraction, selectInteraction) {
    // Retrieve the server settings from the database
    const server = await Server.findOne({ guildId: buttonInteraction.guild.id });

    if (!server) {
        return selectInteraction.update({
            content: '⚠ Server settings not found. Please try again later.',
            components: []
        });
    }

    // Ensure channels array exists
    if (!Array.isArray(server.settings.channels)) {
        server.settings.channels = [];
    }

    // Add the selected channel to the server settings
    server.settings.channels.push({
        name: selectedChannel.name,
        channelId: selectedChannel.channelId,
    });

    // Save the updated settings
    try {
        await Server.updateOne(
            { guildId: buttonInteraction.guild.id },
            { $set: { 'settings.channels': server.settings.channels } }
        );

        // Send a confirmation message
        await selectInteraction.update({
            content: `✅ Channel **${selectedChannel.name}** has been added to the tracked channels.`,
            components: []
        });
    } catch (error) {
        console.error('Error updating server settings:', error);
        await selectInteraction.update({
            content: '⚠ Failed to add the channel. Please try again later.',
            components: []
        });
    }
}
