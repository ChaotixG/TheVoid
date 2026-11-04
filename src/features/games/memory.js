// Memory: flip cards on a 4×4 grid of buttons to find all 8 matching pairs.
const { randomInt } = require('crypto');
const { memoryReward } = require('./scoring');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { createGame, endGame, touch } = require('./sessions');
const { payGameReward, rewardText } = require('./rewards');
const { recordGame } = require('./stats');
const { gamePayload, updateBoard, refuseOutsider, showGame } = require('./common');

const TITLE = '🃏 Memory';
const FACES = ['🍎', '🍌', '🍇', '🍒', '🍉', '🍋', '🥝', '🍑'];

function shuffledDeck() {
    const deck = [...FACES, ...FACES];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * Flips card i. A non-matching pair stays face up until the next flip, so the player can see it.
 * Returns 'match', 'miss' or 'flip' (first card of a pair), or null if the card can't be flipped.
 */
function flip(game, i) {
    if (game.matched.has(i) || game.open.includes(i)) return null;
    if (game.open.length === 2) game.open = []; // turn the previous mismatch face down
    game.open.push(i);
    if (game.open.length < 2) return 'flip';

    game.moves++;
    const [a, b] = game.open;
    if (game.cards[a] === game.cards[b]) {
        game.matched.add(a).add(b);
        game.open = [];
        return 'match';
    }
    return 'miss';
}

function render(game) {
    const playing = game.state === 'playing' && !game.expired;
    const card = (i) => {
        const id = `game:${game.id}:flip:${i}`;
        if (game.matched.has(i)) return button(id, null, ButtonStyle.Success, { emoji: game.cards[i], disabled: true });
        if (game.open.includes(i) || !playing) return button(id, null, ButtonStyle.Primary, { emoji: game.cards[i], disabled: !playing });
        return button(id, null, ButtonStyle.Secondary, { emoji: '❔' });
    };

    let status = `-# Moves: ${game.moves} · pairs found: ${game.matched.size / 2}/${FACES.length}`;
    if (game.state === 'won') status = `🎉 All pairs found in ${game.moves} moves! ${rewardText(game.reward ?? {})}`.trim();
    else if (game.state === 'lost') status = '🏳️ Gave up.';
    else if (game.expired) status = '⌛ Game ended: no moves for 10 minutes.';

    const rows = [];
    for (let r = 0; r < 4; r++) rows.push(row(...[0, 1, 2, 3].map(c => card(r * 4 + c))));

    return gamePayload([
        `## ${TITLE}\n-# <@${game.players[0]}>, find all the matching pairs`,
        ...rows,
        status,
        playing ? row(button(`game:${game.id}:giveup`, 'Give up', ButtonStyle.Secondary)) : null,
    ], 0x3498DB);
}

async function handle(game, interaction, action, arg) {
    if (await refuseOutsider(game, interaction)) return;

    if (action === 'giveup') {
        game.state = 'lost';
        endGame(game);
        await recordGame(game);
        return updateBoard(game, interaction, render(game));
    }
    if (action !== 'flip') return interaction.deferUpdate();

    const result = flip(game, Number(arg));
    if (!result) return interaction.deferUpdate();
    if (game.matched.size === game.cards.length) {
        game.state = 'won';
        endGame(game);
        await interaction.deferUpdate();
        game.reward = await payGameReward(interaction.user.id, memoryReward(game.moves, FACES.length), { guildId: game.guildId, game: 'Memory' });
        await recordGame(game, { winners: game.players, scores: { [game.players[0]]: game.moves } });
    }
    return updateBoard(game, interaction, render(game));
}

async function start(interaction) {
    const game = createGame('memory', {
        guildId: interaction.guildId,
        players: [interaction.user.id],
        cards: shuffledDeck(),
        matched: new Set(),
        open: [],
        moves: 0,
        state: 'playing',
    });
    game.onExpire = () => { game.expired = true; return render(game); };
    await showGame(interaction, render(game));
    touch(game, interaction);
}

module.exports = { start, handle, render, flip, shuffledDeck };
