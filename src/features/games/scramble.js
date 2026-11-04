// Scramble: each round shows a scrambled word, and the first player to type it in chat scores.
// Halfway through a round the first letter is given away. Most words after the last round wins.
const { randomInt } = require('crypto');
const { PARTY, REWARDS } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, updateBoard, editGame, notify } = require('./common');
const { openLobby, handleLobby, LOBBY_ACTIONS } = require('./lobby');
const { listen, cannotListen } = require('./chat');
const { SCRAMBLE_WORDS, isWord } = require('./words');
const { payEach } = require('./rewards');
const { recordGame } = require('./stats');

const TITLE = '🔤 Scramble';
const COLOR = 0xFEE75C;
const MEDALS = ['🥇', '🥈', '🥉'];
const SHOWN_SCORES = 10;
const settings = () => PARTY.scramble; // read when used, so tests can shorten the timers
const pauseMs = () => (settings().pauseSeconds ?? 3) * 1000; // between rounds

const at = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const spaced = (word) => [...word.toUpperCase()].join(' ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sorted = (word) => [...word].sort().join('');

function shuffle(word) {
    const letters = [...word];
    for (let i = letters.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    return letters.join('');
}

/** Mixes up a word so it differs from it and (if possible) isn't another real word to type */
function scramble(word) {
    let mixed = word;
    for (let tries = 0; mixed === word || (tries < 20 && isWord(mixed)); tries++) mixed = shuffle(word);
    return mixed;
}

// The word itself, or another real word made of exactly the same letters ("heart" for "earth")
function isAnswer(word, guess) {
    return guess === word || (guess.length === word.length && sorted(guess) === sorted(word) && isWord(guess));
}

// ─── Flow: ask → (hint halfway) → solved, or time's up → pause → next word … → final scores ──
async function begin(game) {
    game.scores = new Map(game.players.map(id => [id, 0]));
    game.round = 0;
    game.seen = new Set();
    game.onExpire = () => gamePayload([`## ${TITLE}`, 'Nobody played for a while, so the game ended.'], COLOR);
    ask(game);
}

function ask(game) {
    const { roundSeconds } = settings();
    const options = SCRAMBLE_WORDS.filter(w => !game.seen.has(w));
    game.round++;
    game.word = options[randomInt(options.length)];
    game.seen.add(game.word);
    game.scrambled = scramble(game.word);
    game.hint = false;
    game.solvedBy = null;
    game.state = 'asking';
    game.endsAt = Date.now() + roundSeconds * 1000;
    const round = game.round;
    // Halfway, give away the first letter; then wait out the rest
    game.timer = setTimeout(() => runExclusive(game, async () => {
        if (!getGame(game.id) || game.state !== 'asking' || game.round !== round) return;
        game.hint = true;
        await editGame(game, render(game));
        game.timer = setTimeout(() => runExclusive(game, () => reveal(game, round)), Math.max(0, game.endsAt - Date.now()));
    }), roundSeconds * 500);
}

async function reveal(game, round, solvedBy = null, answer = null) {
    if (!getGame(game.id) || game.state !== 'asking' || game.round !== round) return;
    clearTimeout(game.timer);
    game.state = 'revealed';
    game.solvedBy = solvedBy;
    game.answer = answer ?? game.word;
    if (solvedBy) game.scores.set(solvedBy, game.scores.get(solvedBy) + 1);

    if (game.round >= settings().rounds) {
        await finish(game);
        return editGame(game, render(game));
    }
    game.nextAt = Date.now() + pauseMs();
    await editGame(game, render(game));
    game.timer = setTimeout(() => runExclusive(game, async () => {
        if (!getGame(game.id) || game.state !== 'revealed' || game.round !== round) return;
        ask(game);
        await editGame(game, render(game));
    }), pauseMs());
}

// The first right answer takes the round; other chat is left alone
async function onMessage(game, message) {
    if (message.author.bot || game.state !== 'asking') return;
    touch(game);
    const guess = message.content.trim().toLowerCase();
    if (!isAnswer(game.word, guess)) {
        // Only single words of the right length look like guesses worth marking
        if (/^[a-z]+$/.test(guess) && guess.length === game.word.length) message.react('❌').catch(() => {});
        return;
    }
    message.react('✅').catch(() => {}); // not awaited: reactions can be slow, and the bot may lack permission
    await reveal(game, game.round, message.author.id, guess);
}

async function finish(game, note = null) {
    clearTimeout(game.timer);
    endGame(game);
    game.state = 'over';
    game.note = note;
    game.ranking = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
    const best = game.ranking[0]?.[1] ?? 0;
    const { perWord, winnerBonus } = REWARDS.scramble;
    const winners = best > 0 ? game.ranking.filter(([, words]) => words === best).map(([userId]) => userId) : []; // a tie shares the win
    const awards = game.ranking.map(([userId, words]) => ({
        userId,
        amount: perWord * words + (winners.includes(userId) ? winnerBonus : 0),
    }));
    game.rewards = await payEach(awards, { guildId: game.guildId, game: 'Scramble' });
    await recordGame(game, { winners, scores: Object.fromEntries(game.scores) });
}

// ─── Clicks ───────────────────────────────────────────────────
async function handle(game, interaction, action) {
    if (await handleLobby(game, interaction, action)) return;
    if (action !== 'end') return;
    if (interaction.user.id !== game.host) return notify(interaction, 'Only the host can end the game.');
    await finish(game, `<@${interaction.user.id}> ended the game early.`);
    return updateBoard(game, interaction, render(game));
}

// ─── Drawing ──────────────────────────────────────────────────
function standings(game) {
    const scored = [...game.scores.entries()].filter(([, words]) => words > 0).sort((a, b) => b[1] - a[1]);
    if (!scored.length) return 'No words yet';
    return scored.slice(0, SHOWN_SCORES).map(([userId, words], i) => `${i + 1}. <@${userId}> ${words}`).join(' · ');
}

function render(game) {
    const { rounds } = settings();
    if (game.state === 'over') {
        const lines = game.ranking.map(([userId, words], i) =>
            `${MEDALS[i] ?? `**${i + 1}.**`} <@${userId}> · ${plural(words, 'word')}` +
            (game.rewards?.get(userId) ? ` · ${game.rewards.get(userId)}` : ''));
        return gamePayload([
            `## ${TITLE} · Final scores`,
            `-# The last word was **${game.word.toUpperCase()}**.`,
            game.note ? `-# ${game.note}` : null,
            lines.join('\n'),
        ], COLOR);
    }

    const parts = [`## ${TITLE} · Round ${game.round}/${rounds}`];
    if (game.state === 'asking') {
        parts.push(`### ${spaced(game.scrambled)}`);
        if (game.hint) parts.push(`💡 It starts with **${game.word[0].toUpperCase()}**`);
        parts.push(`-# First to type the word in chat scores · time's up ${at(game.endsAt)}`);
    } else {
        parts.push(`### ${spaced(game.answer)}`);
        parts.push(game.solvedBy ? `✅ <@${game.solvedBy}> got it!` : '⏰ Time\'s up! Nobody got it.');
        parts.push(`-# Next word ${at(game.nextAt)}`);
    }
    parts.push(`**Scores** · ${standings(game)}`);
    parts.push(row(button(`game:${game.id}:end`, 'End game', ButtonStyle.Danger)));
    return gamePayload(parts, COLOR);
}

/** Opens the lobby (from the /games menu) */
async function start(interaction) {
    const reason = cannotListen(interaction);
    if (reason) return notify(interaction, reason);
    const { minPlayers, maxPlayers, rounds, roundSeconds } = settings();
    await openLobby(interaction, 'scramble', {
        title: TITLE,
        color: COLOR,
        minPlayers,
        maxPlayers,
        rules: `I show a scrambled word ${rounds} times. The first to type the word in this channel scores ` +
            `(${roundSeconds}s each, with a hint halfway). Most words wins!`,
    }, { begin, render, created: (game) => listen(game, onMessage) });
}

const deferActions = new Set([...LOBBY_ACTIONS, 'end']);

module.exports = { start, handle, render, deferActions, scramble, isAnswer, TITLE };
