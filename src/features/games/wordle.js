// Wordle: guess the 5-letter word in 6 tries. Guesses are typed in a form; the board is emoji rows.
const { WORDLE } = require('../../config/games');
const { wordleReward } = require('./scoring');
const { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { createGame, endGame, touch } = require('./sessions');
const { payGameReward, rewardText } = require('./rewards');
const { gamePayload, updateBoard, refuseOutsider } = require('./common');
const { isValidGuess, randomWordleAnswer } = require('./words');

const TITLE = '🟩 Wordle';
const TILE = { correct: '🟩', present: '🟨', absent: '⬛' };
const BLANK_ROW = '⬜⬜⬜⬜⬜';

/** Colors for each letter of a guess. Handles repeated letters like the real game. */
function score(guess, answer) {
    const result = Array(5).fill('absent');
    const remaining = {};
    for (let i = 0; i < 5; i++) {
        if (guess[i] === answer[i]) result[i] = 'correct';
        else remaining[answer[i]] = (remaining[answer[i]] ?? 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
        if (result[i] !== 'correct' && remaining[guess[i]] > 0) {
            result[i] = 'present';
            remaining[guess[i]]--;
        }
    }
    return result;
}

function render(game) {
    const rows = game.guesses.map(({ word, colors }) => `${colors.map(c => TILE[c]).join('')}  \`${word.toUpperCase().split('').join(' ')}\``);
    while (rows.length < WORDLE.guesses) rows.push(BLANK_ROW);

    // Letters ruled out so far (never green or yellow in any guess)
    const seen = new Set(game.guesses.flatMap(g => g.word.split('').filter((l, i) => g.colors[i] !== 'absent')));
    const out = [...new Set(game.guesses.flatMap(g => g.word.split('')))].filter(l => !seen.has(l)).sort();

    let status = null;
    if (game.state === 'won') status = `🎉 Solved in ${game.guesses.length}/${WORDLE.guesses}! ${rewardText(game.reward ?? {})}`.trim();
    else if (game.state === 'lost') status = `The word was **${game.answer.toUpperCase()}**.${game.gaveUp ? ' (gave up)' : ''}`;
    else if (game.expired) status = `⌛ Game ended: no guesses for 10 minutes. The word was **${game.answer.toUpperCase()}**.`;

    const playing = game.state === 'playing' && !game.expired;
    return gamePayload([
        `## ${TITLE}\n-# <@${game.players[0]}>, guess the 5-letter word in ${WORDLE.guesses} tries`,
        rows.join('\n'),
        out.length ? `-# Not in the word: ${out.map(l => l.toUpperCase()).join(' ')}` : null,
        status,
        playing ? row(
            button(`game:${game.id}:guess`, 'Guess', ButtonStyle.Primary, { emoji: '✏️' }),
            button(`game:${game.id}:giveup`, 'Give up', ButtonStyle.Secondary),
        ) : null,
    ], 0x57F287);
}

const guessForm = (game) => new ModalBuilder()
    .setCustomId(`game:${game.id}:submit`)
    .setTitle(`Wordle · guess ${game.guesses.length + 1} of ${WORDLE.guesses}`)
    .addLabelComponents(new LabelBuilder().setLabel('Your guess').setDescription('Any real 5-letter word').setTextInputComponent(
        new TextInputBuilder().setCustomId('word').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(5).setMaxLength(5)));

async function handle(game, interaction, action) {
    if (await refuseOutsider(game, interaction)) return;

    if (action === 'guess') return interaction.showModal(guessForm(game));

    if (action === 'giveup') {
        game.state = 'lost';
        game.gaveUp = true;
        endGame(game);
        return updateBoard(game, interaction, render(game));
    }

    if (action === 'submit') {
        const word = interaction.fields.getTextInputValue('word').trim().toLowerCase();
        if (!/^[a-z]{5}$/.test(word)) return interaction.reply(ephemeral('Use exactly 5 letters.'));
        if (!isValidGuess(word)) return interaction.reply(ephemeral(`**${word.toUpperCase()}** isn't in my word list.`));
        if (game.guesses.some(g => g.word === word)) return interaction.reply(ephemeral('You already tried that word.'));

        game.guesses.push({ word, colors: score(word, game.answer) });
        if (word === game.answer) {
            game.state = 'won';
            endGame(game);
            await interaction.deferUpdate();
            game.reward = await payGameReward(interaction.user.id, wordleReward(game.guesses.length), { guildId: game.guildId, game: 'Wordle' });
        } else if (game.guesses.length >= WORDLE.guesses) {
            game.state = 'lost';
            endGame(game);
        }
        return updateBoard(game, interaction, render(game));
    }
    return interaction.deferUpdate();
}

async function start(interaction) {
    const game = createGame('wordle', {
        guildId: interaction.guildId,
        players: [interaction.user.id],
        answer: randomWordleAnswer(),
        guesses: [],
        state: 'playing',
    });
    game.onExpire = () => { game.expired = true; return render(game); };
    await interaction.reply(render(game));
    touch(game, interaction);
}

module.exports = { start, handle, render, score };
