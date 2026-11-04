// Word Chain: players take turns typing a word in chat that starts with the last letter of the word
// before it. Words must be real, a few letters long and not used yet this game. Run out of time and
// you're out; turns get a little shorter every round, so the game always ends. Last one in wins.
const { randomInt } = require('crypto');
const { PARTY, REWARDS } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, updateBoard, editGame, notify } = require('./common');
const { openLobby, handleLobby, LOBBY_ACTIONS, playerList } = require('./lobby');
const { listen, cannotListen } = require('./chat');
const { isWord } = require('./words');
const { winnerReward } = require('./scoring');
const { payEach } = require('./rewards');
const { announceTurn } = require('./turns');
const { recordGame } = require('./stats');

const TITLE = '🔗 Word Chain';
const COLOR = 0x57F287;
const MEDALS = ['🥇', '🥈', '🥉'];
const START_LETTERS = 'abcdefghijklmnoprstuvwy'; // no q, x or z: too hard to start on
const SHOWN_WORDS = 8; // the end of the chain shown on the board
const STEP_SECONDS = 2; // each full round of turns is this much shorter
const settings = () => PARTY.wordChain; // read when used, so tests can shorten the timers

const at = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Seconds per turn in this round of turns (the first round is 1) */
function turnSeconds(lap) {
    const { turnSeconds: first, minTurnSeconds } = settings();
    return Math.max(minTurnSeconds, first - STEP_SECONDS * (lap - 1));
}

// ─── Flow: turn → (word, or time's up) → next player still in … → one left ──
async function begin(game) {
    game.alive = [...game.players];
    game.out = []; // in the order they went out
    game.chain = []; // { word, userId }
    game.used = new Set();
    game.words = new Map(game.players.map(id => [id, 0]));
    game.letter = START_LETTERS[randomInt(START_LETTERS.length)];
    game.lap = 1;
    game.turn = 0;
    game.news = null; // who just went out
    game.onExpire = () => gamePayload([`## ${TITLE}`, 'Nobody played for a while, so the game ended.'], COLOR);
    startTurn(game, game.players[0]);
}

function startTurn(game, userId) {
    clearTimeout(game.timer);
    const seconds = turnSeconds(game.lap);
    game.current = userId;
    game.turn++;
    game.turnEndsAt = Date.now() + seconds * 1000;
    const turn = game.turn;
    game.timer = setTimeout(() => runExclusive(game, () => timeUp(game, turn)), seconds * 1000);
    // Pings them if they haven't played after a few seconds. Set after the turn timer, so a ping due
    // just as time runs out is cancelled by the next turn instead of going out.
    announceTurn(game, userId);
}

// The next player still in, in lobby order; going past the end of the list starts a new round
function passTurn(game) {
    const { players } = game;
    const from = players.indexOf(game.current);
    for (let step = 1; step <= players.length; step++) {
        const next = players[(from + step) % players.length];
        if (!game.alive.includes(next)) continue;
        if (from + step >= players.length) game.lap++;
        return startTurn(game, next);
    }
}

async function timeUp(game, turn) {
    if (!getGame(game.id) || game.state !== 'playing' || game.turn !== turn) return;
    const userId = game.current;
    game.alive = game.alive.filter(id => id !== userId);
    game.out.push(userId);
    game.news = `⏰ <@${userId}> ran out of time and is out!`;
    if (game.alive.length > 1) passTurn(game); // the next player needs the same letter
    else await finish(game, { winner: game.alive[0] });
    await editGame(game, render(game));
}

function isValid(game, word) {
    return /^[a-z]+$/.test(word)
        && word.length >= settings().minLength
        && word[0] === game.letter
        && !game.used.has(word)
        && isWord(word);
}

// Only the current player's messages count; they can keep trying until their time runs out
async function onMessage(game, message) {
    if (message.author.bot) return; // never the bot's own turn pings
    if (game.state !== 'playing' || message.author.id !== game.current) return;
    touch(game);
    const word = message.content.trim().toLowerCase();
    if (!isValid(game, word)) {
        message.react('❌').catch(() => {}); // not awaited: reactions can be slow, and the bot may lack permission
        return;
    }
    message.react('✅').catch(() => {});
    game.chain.push({ word, userId: game.current });
    game.used.add(word);
    game.words.set(game.current, game.words.get(game.current) + 1);
    game.letter = word.at(-1);
    game.news = null;
    passTurn(game);
    await editGame(game, render(game));
}

async function finish(game, { winner = null, note = null } = {}) {
    clearTimeout(game.timer);
    endGame(game);
    game.state = 'over';
    game.winner = winner;
    game.note = note;
    // Still in first, then whoever lasted longest
    game.ranking = [...game.alive, ...[...game.out].reverse()];
    const { perWord, maxWords } = REWARDS.wordChain;
    const awards = game.ranking.map(userId => ({
        userId,
        amount: perWord * Math.min(game.words.get(userId), maxWords) + (userId === winner ? winnerReward('wordChain', game.players.length) : 0),
    }));
    game.rewards = await payEach(awards, { guildId: game.guildId, game: 'Word Chain' });
    await recordGame(game, { winners: winner ? [winner] : [], scores: Object.fromEntries(game.words) });
}

// ─── Clicks ───────────────────────────────────────────────────
async function handle(game, interaction, action) {
    if (await handleLobby(game, interaction, action)) return;
    if (action !== 'end') return;
    if (interaction.user.id !== game.host) return notify(interaction, 'Only the host can end the game.');
    await finish(game, { note: `<@${interaction.user.id}> ended the game early.` });
    return updateBoard(game, interaction, render(game));
}

// ─── Drawing ──────────────────────────────────────────────────
function chainText(game) {
    if (!game.chain.length) return null;
    const shown = game.chain.slice(-SHOWN_WORDS);
    const earlier = game.chain.length - shown.length;
    return (earlier ? `-# …${plural(earlier, 'earlier word')}\n` : '') +
        shown.map(({ word, userId }) => `🔗 **${word}** · <@${userId}>`).join('\n');
}

function render(game) {
    if (game.state === 'over') {
        const lines = game.ranking.map((userId, i) =>
            `${game.winner ? (MEDALS[i] ?? `**${i + 1}.**`) : '•'} <@${userId}> · ${plural(game.words.get(userId), 'word')}` +
            (game.rewards?.get(userId) ? ` · ${game.rewards.get(userId)}` : ''));
        return gamePayload([
            `## ${TITLE} · Game over`,
            game.winner ? `🏆 <@${game.winner}> is the last one in and wins!` : null,
            game.note ? `-# ${game.note}` : null,
            `-# The chain was ${plural(game.chain.length, 'word')} long.`,
            lines.join('\n'),
        ], COLOR);
    }

    const { minLength } = settings();
    return gamePayload([
        `## ${TITLE}`,
        chainText(game),
        game.news,
        `### Next word starts with **${game.letter.toUpperCase()}**`,
        `👉 <@${game.current}>, your turn! Type it in chat · time's up ${at(game.turnEndsAt)}`,
        `**Still in · ${game.alive.length}/${game.players.length}** · ${playerList(game.alive)}`,
        `-# Real words, ${minLength}+ letters, not used yet · ${turnSeconds(game.lap)}s per turn, less each round`,
        row(button(`game:${game.id}:end`, 'End game', ButtonStyle.Danger)),
    ], COLOR);
}

/** Opens the lobby (from the /games menu) */
async function start(interaction) {
    const reason = cannotListen(interaction);
    if (reason) return notify(interaction, reason);
    const { minPlayers, maxPlayers, turnSeconds: seconds, minLength } = settings();
    await openLobby(interaction, 'wordChain', {
        title: TITLE,
        color: COLOR,
        minPlayers,
        maxPlayers,
        rules: 'Take turns typing a word in this channel that starts with the last letter of the word before it. ' +
            `Words must be real, ${minLength}+ letters and not used yet. You get ${seconds}s, a bit less each round; ` +
            'run out of time and you\'re out. Last one in wins!',
    }, { begin, render, created: (game) => listen(game, onMessage) });
}

const deferActions = new Set([...LOBBY_ACTIONS, 'end']);

module.exports = { start, handle, render, deferActions, turnSeconds, TITLE };
