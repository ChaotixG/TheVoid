// Shared pieces for game panels: board updates, player checks and two-player challenges.
const { CHALLENGE_SECONDS } = require('../../config/games');
const { container, row, button, panelPayload, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { endGame, runExclusive, touch } = require('./sessions');

const BOT = 'bot'; // stands in for the bot as an opponent

const gamePayload = (parts, color, mentions = []) => ({
    ...panelPayload(container(parts, color)),
    allowedMentions: { users: mentions },
});

// Edit the game message from a click on it, and remember that interaction for later edits
async function updateBoard(game, interaction, payload) {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
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
    await interaction.reply(ephemeral('This isn\'t your game. Start your own with its command!'));
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

// Expire unanswered challenges
function armChallengeTimer(game, title) {
    game.timer = setTimeout(() => runExclusive(game, async () => {
        if (game.state !== 'challenge') return;
        endGame(game);
        await game.lastInteraction?.editReply(gamePayload([`## ${title}`, `<@${game.players[1]}> didn't answer the challenge in time.`])).catch(() => {});
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

/**
 * Who to play against, from a command's `opponent` option: null (or me) = the bot.
 * Returns { opponentId } or { error }.
 */
function resolveOpponent(interaction) {
    const opponent = interaction.options.getUser('opponent');
    if (!opponent || opponent.id === interaction.client.user.id) return { opponentId: BOT };
    if (opponent.id === interaction.user.id) return { error: 'You can\'t challenge yourself. Leave the opponent empty to play against me!' };
    if (opponent.bot) return { error: 'Other bots can\'t play. Leave the opponent empty to play against me!' };
    return { opponentId: opponent.id };
}

module.exports = {
    BOT, gamePayload, updateBoard, mention, notify, refuseOutsider,
    challengePayload, armChallengeTimer, handleChallenge, resolveOpponent,
};
