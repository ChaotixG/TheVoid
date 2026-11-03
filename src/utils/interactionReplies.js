const { MessageFlags } = require('discord.js');

// Tell the user something went wrong, whatever state the interaction is in,
// instead of leaving them on "thinking..." or "This interaction failed".
async function replyError(interaction, content) {
    if (!interaction.isRepliable()) return;
    // A deferred button/select/form is editing a panel; don't overwrite the panel with the error
    const updatingMessage = interaction.deferred && (interaction.isMessageComponent() || interaction.isModalSubmit());

    if (interaction.replied || updatingMessage) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (interaction.deferred) {
        await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

// Short ephemeral notice
function ephemeral(content) {
    return { content, flags: MessageFlags.Ephemeral };
}

module.exports = { replyError, ephemeral };
