// Shared pieces for game panels: board updates, player checks and two-player challenges.
// Games are started from the /games menu (features/games/menu.js).
const { MessageFlags } = require('discord.js');
const { CHALLENGE_SECONDS } = require('../../config/games');
const { container, row, button, panelPayload, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { endGame, runExclusive, touch, editGame, withEndButtons } = require('./sessions');

const BOT = 'bot'; // stands in for the bot as an opponent

const gamePayload = (parts, color, mentions = []) => ({
    ...panelPayload(container(parts, color)),
    allowedMentions: { users: mentions },
});

/**
 * Shows a new game where it belongs. The /games menu is private, so:
 * - a game for everyone (party games, challenges, trivia races; the menu sets `gameVisibility`
 *   to 'public') is posted in the channel, and the menu closes;
 * - a private game (solo, against the bot) takes the menu's place, still only seen by the player;
 * - otherwise it fills a deferred reply (Play again's new message) or answers a command.
 * Records on the interaction where the game is (`gameMessage`) and, for a posted game, how to
 * edit it later (`gameEdit`), for touch().
 */
async function showGame(interaction, payload) {
    let message;
    if (interaction.gameVisibility === 'public' && interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
        message = await interaction.followUp(payload);
        await interaction.deleteReply().catch(() => {}); // the private menu's job is done
        interaction.gameEdit = (p) => interaction.webhook.editMessage(message.id, p);
    } else if (interaction.deferred || interaction.replied) {
        message = await interaction.editReply(payload);
    } else if (interaction.isMessageComponent?.()) {
        message = (await interaction.update({ ...payload, withResponse: true }))?.resource?.message;
    } else {
        message = (await interaction.reply({ ...payload, withResponse: true }))?.resource?.message;
    }
    interaction.gameMessage = message ?? interaction.message;
    return message;
}

// Edit the game message from a click on it, and remember that interaction for later edits
async function updateBoard(game, interaction, payload) {
    const finalPayload = withEndButtons(game, payload); // a finished game gets Play again
    if (interaction.deferred || interaction.replied) await interaction.editReply(finalPayload);
    else await interaction.update(finalPayload);
    touch(game, interaction);
}

const mention = (userId) => (userId === BOT ? 'me 🤖' : `<@${userId}>`);

// A private notice, whether or not the click was already acknowledged
function notify(interaction, content) {
    return interaction.deferred || interaction.replied
        ? interaction.followUp(ephemeral(content))
        : interaction.reply(ephemeral(content));
}

// Refuses clicks from people who aren't playing; returns true when refused
async function refuseOutsider(game, interaction) {
    if (game.players.includes(interaction.user.id)) return false;
    await interaction.reply(ephemeral('This isn\'t your game. Start your own with **/games**!'));
    return true;
}

// ─── Two-player challenges ────────────────────────────────────
function challengePayload(game, title) {
    const [challenger, opponent] = game.players;
    const expires = Math.floor((game.createdAt + CHALLENGE_SECONDS * 1000) / 1000);
    return gamePayload([
        `## ${title}`,
        `<@${opponent}>, <@${challenger}> challenges you! Accept <t:${expires}:R>.`,
        row(
            button(`game:${game.id}:accept`, 'Accept', ButtonStyle.Success),
            button(`game:${game.id}:decline`, 'Decline', ButtonStyle.Danger),
        ),
    ], 0x5865F2, [opponent]);
}

// The challenge replaces the /games menu by editing it, and edits don't notify anyone, so the
// opponent gets a separate ping
function pingOpponent(interaction, game, title) {
    const [challenger, opponent] = game.players;
    return interaction.followUp({
        content: `<@${opponent}>, <@${challenger}> challenged you to **${title}**! Accept it above.`,
        allowedMentions: { users: [opponent] },
    }).catch(() => {});
}

// Expire unanswered challenges
function armChallengeTimer(game, title) {
    game.timer = setTimeout(() => runExclusive(game, async () => {
        if (game.state !== 'challenge') return;
        endGame(game);
        await editGame(game, gamePayload([`## ${title}`, `<@${game.players[1]}> didn't answer the challenge in time.`]));
    }), CHALLENGE_SECONDS * 1000);
}

/**
 * Handles Accept/Decline while a challenge is open. Returns true if the click was handled.
 * `onAccept` sets up the board; `render` draws it.
 */
async function handleChallenge(game, interaction, action, { title, onAccept, render }) {
    if (game.state !== 'challenge') return false;
    const [challenger, opponent] = game.players;
    const userId = interaction.user.id;

    if (action === 'accept') {
        if (userId !== opponent) {
            await interaction.reply(ephemeral(userId === challenger ? 'Waiting for your opponent to accept.' : 'This challenge isn\'t for you.'));
            return true;
        }
        clearTimeout(game.timer);
        game.state = 'playing';
        onAccept();
        await updateBoard(game, interaction, render(game));
        return true;
    }
    if (action === 'decline') {
        if (userId !== opponent && userId !== challenger) {
            await interaction.reply(ephemeral('This challenge isn\'t for you.'));
            return true;
        }
        endGame(game);
        const text = userId === opponent ? `<@${opponent}> declined the challenge.` : `<@${challenger}> cancelled the challenge.`;
        await updateBoard(game, interaction, gamePayload([`## ${title}`, text]));
        return true;
    }
    await interaction.reply(ephemeral('The game starts once the challenge is accepted.'));
    return true;
}

module.exports = {
    BOT, gamePayload, showGame, updateBoard, editGame, mention, notify, refuseOutsider,
    challengePayload, pingOpponent, armChallengeTimer, handleChallenge,
};
