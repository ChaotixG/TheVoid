module.exports = {
    name: 'profile',
    description: 'Sends the profile of the user',
    // options: object[]
    callback: async (client, interaction) => {
        await interaction.deferReply();

    },
};