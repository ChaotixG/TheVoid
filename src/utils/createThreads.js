const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { ThreadAutoArchiveDuration } = require('discord.js');

async function createHelpThread(client, interaction, modalResults, channelId) {
    console.log("Received modalResults:", modalResults); // Debugging

    // Ensure modalResults is an array and has at least two elements (title and description)
    if (!Array.isArray(modalResults) || modalResults.length < 2) {
        console.error('Invalid modalResults format or missing fields:', modalResults);
        return;
    }

    const title = modalResults[0]?.value || 'Untitled Thread';
    const description = modalResults[1]?.value || 'No description provided.';

    try {
        // Fetch the channel where the thread will be created
        const channel = await client.channels.fetch(channelId);

        // Ensure channel exists and is text-based
        if (!channel || !channel.isTextBased()) {
            console.error('Invalid channel or channel is not text-based.');
            return;
        }

        // Create a private thread in the channel
        const thread = await channel.threads.create({
            name: title,
            type: 12, // PRIVATE_THREAD type
            invitable: true,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        });

        // Send the description message in the newly created thread
        const threadEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(title)
            .setDescription(description)
            .setFooter({ text: `Created by ${interaction.user.tag}` });

        // Create action row with buttons
        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('archive_ticket')
                    .setLabel('Archive Ticket')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('delete_ticket')
                    .setLabel('Delete Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(interaction.guild.ownerId !== interaction.user.id) // Only enable the delete button for the server owner
            );

        // Send the embed and buttons to the thread
        await thread.send({
            content: `<@${interaction.user.id}>`,
            embeds: [threadEmbed],
            components: [actionRow],
        });

        // Notify the creator
        await interaction.reply({
            content: `Your ticket has been created successfully in the thread: ${thread.name}.`,
            ephemeral: true
        });

        console.log(`Thread created successfully: ${thread.name} (ID: ${thread.id})`);

    } catch (error) {
        console.error('Error creating thread:', error);
    }
}

module.exports = createHelpThread;
