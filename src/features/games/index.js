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
    // Party games (lobby.js)
    triviaParty: require('./triviaParty'),
    crazyEights: require('./crazyEights'),
    liarsDice: require('./liarsDice'),
    wordChain: require('./wordChain'),
    scramble: require('./scramble'),
    higherLower: require('./higherLower'),
    wordTiles: require('./wordTiles'),
};

const ENDED = 'This game has ended. Start a new one with **/games**!';

async function handleInteraction(client, interaction) {
    const [, id, action, arg] = interaction.customId.split(':');
    const game = getGame(id);
    if (!game) return notify(interaction, ENDED);

    // Clicks many people make at once (answering together, joining a lobby) are acknowledged right
    // away, so none runs out Discord's 3-second limit while waiting its turn in the game's queue
    if (GAMES[game.type].deferActions?.has(action)) await interaction.deferUpdate();

    return runExclusive(game, async () => {
        if (!getGame(id)) return notify(interaction, ENDED); // ended while this click waited
        await GAMES[game.type].handle(game, interaction, action, arg);
    });
}

module.exports = { handleInteraction, GAMES };
