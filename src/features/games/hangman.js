// Hangman: pick letters from two menus (A–M, N–Z) or guess the whole word in a form.
const { HANGMAN } = require('../../config/games');
const { hangmanReward } = require('./scoring');
const { LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { createGame, endGame, touch } = require('./sessions');
const { payGameReward, rewardText } = require('./rewards');
const { gamePayload, updateBoard, refuseOutsider } = require('./common');
const { randomHangmanWord } = require('./words');

const TITLE = '🪢 Hangman';
const HALVES = { am: 'abcdefghijklm', nz: 'nopqrstuvwxyz' };

const pattern = (word, guessed) => word.split('').map(l => (guessed.has(l) ? l.toUpperCase() : '_')).join(' ');
const solved = (word, guessed) => word.split('').every(l => guessed.has(l));
const wrongLetters = (game) => [...game.guessed].filter(l => !game.word.includes(l)).sort();

function render(game) {
    const lives = HANGMAN.lives - game.misses;
    const playing = game.state === 'playing' && !game.expired;
    const wrong = wrongLetters(game);

    let status = null;
    if (game.state === 'won') status = `🎉 You got it with ${lives} ${lives === 1 ? 'life' : 'lives'} left! ${rewardText(game.reward ?? {})}`.trim();
    else if (game.state === 'lost') status = `💀 The word was **${game.word.toUpperCase()}**.${game.gaveUp ? ' (gave up)' : ''}`;
    else if (game.expired) status = `⌛ Game ended: no guesses for 10 minutes. The word was **${game.word.toUpperCase()}**.`;

    const letterMenu = (half) => {
        const letters = HALVES[half].split('').filter(l => !game.guessed.has(l));
        if (!letters.length) return null;
        return row(new StringSelectMenuBuilder()
            .setCustomId(`game:${game.id}:letter:${half}`)
            .setPlaceholder(`Guess a letter (${half === 'am' ? 'A–M' : 'N–Z'})`)
            .addOptions(letters.map(l => ({ label: l.toUpperCase(), value: l }))));
    };

    return gamePayload([
        `## ${TITLE}\n-# <@${game.players[0]}> · ${game.word.length} letters`,
        `\`\`\`\n${game.state === 'lost' ? game.word.toUpperCase().split('').join(' ') : pattern(game.word, game.guessed)}\n\`\`\``,
        `Lives: ${'❤️'.repeat(Math.max(0, lives))}${'🖤'.repeat(HANGMAN.lives - Math.max(0, lives))}${wrong.length ? ` · Wrong: ${wrong.map(l => l.toUpperCase()).join(' ')}` : ''}`,
        status,
        playing ? letterMenu('am') : null,
        playing ? letterMenu('nz') : null,
        playing ? row(
            button(`game:${game.id}:word`, 'Guess the word', ButtonStyle.Primary, { emoji: '✏️' }),
            button(`game:${game.id}:giveup`, 'Give up', ButtonStyle.Secondary),
        ) : null,
    ], 0xE67E22);
}

async function finishIfOver(game, interaction) {
    if (solved(game.word, game.guessed)) {
        game.state = 'won';
        endGame(game);
        await interaction.deferUpdate();
        game.reward = await payGameReward(interaction.user.id, hangmanReward(HANGMAN.lives - game.misses), { guildId: game.guildId, game: 'Hangman' });
    } else if (game.misses >= HANGMAN.lives) {
        game.state = 'lost';
        endGame(game);
    }
}

async function handle(game, interaction, action) {
    if (await refuseOutsider(game, interaction)) return;

    if (action === 'letter') {
        const letter = interaction.values[0];
        if (game.guessed.has(letter)) return interaction.reply(ephemeral('You already tried that letter.'));
        game.guessed.add(letter);
        if (!game.word.includes(letter)) game.misses++;
        await finishIfOver(game, interaction);
        return updateBoard(game, interaction, render(game));
    }

    if (action === 'word') {
        return interaction.showModal(new ModalBuilder()
            .setCustomId(`game:${game.id}:wordsubmit`)
            .setTitle('Hangman · guess the word')
            .addLabelComponents(new LabelBuilder().setLabel('The word').setDescription('A wrong guess costs a life').setTextInputComponent(
                new TextInputBuilder().setCustomId('word').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20))));
    }

    if (action === 'wordsubmit') {
        const guess = interaction.fields.getTextInputValue('word').trim().toLowerCase();
        if (guess === game.word) for (const l of game.word) game.guessed.add(l);
        else game.misses++;
        await finishIfOver(game, interaction);
        return updateBoard(game, interaction, render(game));
    }

    if (action === 'giveup') {
        game.state = 'lost';
        game.gaveUp = true;
        endGame(game);
        return updateBoard(game, interaction, render(game));
    }
    return interaction.deferUpdate();
}

async function start(interaction) {
    const game = createGame('hangman', {
        guildId: interaction.guildId,
        players: [interaction.user.id],
        word: randomHangmanWord(),
        guessed: new Set(),
        misses: 0,
        state: 'playing',
    });
    game.onExpire = () => { game.expired = true; return render(game); };
    await interaction.reply(render(game));
    touch(game, interaction);
}

module.exports = { start, handle, render, pattern, solved };
