async function createHelpThread(client, interaction, modalResults, channelId) {
    console.log("Received modalResults:", modalResults); // Debugging

    // Ensure modalResults is an array and has at least two elements (title and description)
    if (!Array.isArray(modalResults) || modalResults.length < 2) {
        console.error('Invalid modalResults format or missing fields:', modalResults);
        return;
    }

    // Extract title and description from the first two inputs
    const title = modalResults[0]?.value || 'Untitled Thread'; // Default title if not provided
    const description = modalResults[1]?.value || 'No description provided.'; // Default description if not provided

    // Log extracted values for debugging purposes
    console.log(`Title: ${title}`);
    console.log(`Description: ${description}`);

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
            invitable: true, // Allow users to be added manually
        });

        // Send the description message in the newly created thread
        await thread.send(`<@${interaction.user.id}>\n${description}`);
        console.log(`Thread created successfully: ${thread.name} (ID: ${thread.id})`);

    } catch (error) {
        console.error('Error creating thread:', error);
    }
}

module.exports = createHelpThread;
