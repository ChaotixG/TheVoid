const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('socials')
        .setDescription('Sends my socials!')
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        await interaction.reply(
            `> # Socials
> ## Welcome to [my Tiktok](https://www.tiktok.com/@chaotixg)!
> 
> ## If you want clips, [this is my Medal!](https://medal.tv/u/ChaotixG)`);
    },
};
