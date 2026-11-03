// Routes "game:<id>:<action>:<arg>" clicks and forms to the right game. Each game handles one
// interaction at a time (see sessions.runExclusive).
const { getGame, runExclusive } = require('./sessions');
const { notify } = require('./common');

const GAMES = {
    tictactoe: require('./tictactoe'),
    connect4: require('./connect4'),
    trivia: require('./trivia'),
    wordle: require('./wordle'),
    hangman: require('./hangman'),
    minesweeper: require('./minesweeper'),
    memory: require('./memory'),
};

const ENDED = 'This game has ended. Start a new one with its command!';

async function handleInteraction(client, interaction) {
    const [, id, action, arg] = interaction.customId.split(':');
    const game = getGame(id);
    if (!game) return notify(interaction, ENDED);

    // Trivia races can have many people clicking at once: acknowledge right away so no click
    // runs out Discord's 3-second limit while waiting its turn in the game's queue
    if (game.type === 'trivia' && action === 'answer') await interaction.deferUpdate();

    return runExclusive(game, async () => {
        if (!getGame(id)) return notify(interaction, ENDED); // ended while this click waited
        await GAMES[game.type].handle(game, interaction, action, arg);
    });
}

module.exports = { handleInteraction, GAMES };
