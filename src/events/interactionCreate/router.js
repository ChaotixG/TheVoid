// Routes every interaction. Components and modals use namespaced custom IDs ("settings:...",
// "vc:...", "ticket:...", "lb:...", "shop:...", "game:..."), so each feature only ever sees its own interactions and
// everything keeps working after a restart (no in-memory collectors needed).
const commandHandler = require('../../handlers/commandHandler');
const settings = require('../../features/settings/handler');
const voicePanel = require('../../features/voice/panel');
const tickets = require('../../features/tickets/handler');
const leaderboard = require('../../features/leveling/leaderboard');
const shop = require('../../features/economy/shop');
const games = require('../../features/games');
const { replyError } = require('../../utils/interactionReplies');
const { error } = require('../../services/logger');

const ROUTES = {
    settings: settings.handleInteraction,
    vc: voicePanel.handleInteraction,
    ticket: tickets.handleInteraction,
    lb: leaderboard.handleInteraction,
    shop: shop.handleInteraction,
    game: games.handleInteraction,
};

// IDs from before custom IDs were namespaced; they're still on existing ticket messages
const LEGACY_TICKET_IDS = new Set(['archive_ticket', 'delete_ticket', 'ticketType']);

module.exports = async (client, interaction) => {
    if (interaction.isChatInputCommand()) return commandHandler(client, interaction);
    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;

    const id = interaction.customId;
    const handler = ROUTES[id.split(':')[0]]
        ?? (LEGACY_TICKET_IDS.has(id) || id.startsWith('ticket_') ? tickets.handleInteraction : null);
    if (!handler) return;

    try {
        await handler(client, interaction);
    } catch (err) {
        error(`Error handling interaction ${id}: `, err);
        await replyError(interaction, 'Something went wrong. Please try again.');
    }
};
