module.exports = {
    name: 'socials',
    description: 'Sends my socials!',
    // options: object[]
    callback: async (client, interaction) => {
        await interaction.deferReply();

        interaction.editReply(
            `> # Socials
>> ## Welcome to [my Tiktok](https://www.tiktok.com/@chaotixg)!
>
>> ## If you want clips, [this is my Medal!](https://medal.tv/u/ChaotixG)`)
    },
};