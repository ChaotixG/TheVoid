// Private views: what only one player may see (their hand, their dice, later a secret role), as an
// ephemeral message. Secrets never go on the game message or in a public reply.
//
// A view refreshes itself when the game moves on, through the token of the click that opened it
// or last used it. Discord lets a token edit for 15 minutes, so a view nobody has touched for that
// long stops updating; the player opens it again from the game message.
//
// Usage in a game: the board's button (e.g. "My hand", in deferActions) → openView(); a click
// inside the view → interaction.update(view) then trackView(); after any change → refreshViews().
const { MessageFlags } = require('discord.js');
const { touch, tokenFresh } = require('./sessions');

const viewsOf = (game) => (game.views ??= new Map()); // userId → { edit, interaction }

/** Answers a click on the game message's "My hand"-style button with that player's private view */
async function openView(game, interaction, payload) {
    // Acknowledged on the game message, so this click also renews the message's 15 minutes
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    touch(game, interaction);
    const message = await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    if (message?.id) viewsOf(game).set(interaction.user.id, { interaction, edit: (p) => interaction.webhook.editMessage(message.id, p) });
}

/** After answering a click inside a private view with interaction.update(), keeps that view live */
function trackView(game, interaction) {
    viewsOf(game).set(interaction.user.id, { interaction, edit: (p) => interaction.editReply(p) });
}

/**
 * Redraws the open private views after the game changed: `render(game, userId)` gives each one.
 * `except` skips someone whose view was just updated by their own click.
 */
async function refreshViews(game, render, { except = null } = {}) {
    const views = viewsOf(game);
    await Promise.all([...views].map(async ([userId, view]) => {
        if (userId === except) return;
        if (!tokenFresh(view.interaction)) return views.delete(userId); // too old to edit
        try {
            await view.edit(render(game, userId));
        } catch {
            views.delete(userId); // dismissed, or no longer editable
        }
    }));
}

/** Stops updating someone's view (they left the game) */
function dropView(game, userId) {
    viewsOf(game).delete(userId);
}

module.exports = { openView, trackView, refreshViews, dropView };
