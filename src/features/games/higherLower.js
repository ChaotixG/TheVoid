// Higher or Lower: everyone still in privately guesses whether the next number (1 to 100) will be
// higher or lower than the one showing. A wrong guess (or none) puts you out, unless everyone
// missed, in which case nobody goes out. Last one in wins; anyone left after the last round wins too.
const { randomInt } = require('crypto');
const { PARTY, REWARDS } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, updateBoard, editGame, notify } = require('./common');
const { openLobby, handleLobby, LOBBY_ACTIONS, playerList } = require('./lobby');
const { winnerReward } = require('./scoring');
const { payEach } = require('./rewards');

const TITLE = '🔼 Higher or Lower';
const COLOR = 0x5865F2;
const CHOICES = { higher: '⬆️ **Higher**', lower: '⬇️ **Lower**' };
const REFRESH_MS = 2_000; // "3/6 guessed" is updated at most this often
const settings = () => PARTY.higherLower; // read when used, so tests can shorten the timers

const at = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

/** A number from 1 to 100 that isn't `not` */
function draw(not = null) {
    let n;
    do n = randomInt(1, 101); while (n === not);
    return n;
}

// ─── Flow: guess → (everyone guessed, or time's up) → reveal → next round … → one left ──
async function begin(game) {
    game.alive = [...game.players];
    // Right guesses, which earn coins. A round everyone missed keeps them in but earns nothing, so
    // players who never click (or all pick the same) can't collect coins by sitting through rounds.
    game.right = new Map(game.players.map(id => [id, 0]));
    game.outIn = new Map(); // userId → the round they went out in
    game.number = draw();
    game.round = 0;
    game.last = null; // what the last reveal showed
    game.onExpire = () => gamePayload([`## ${TITLE}`, 'Nobody played for a while, so the game ended.'], COLOR);
    ask(game);
}

function ask(game) {
    const { guessSeconds } = settings();
    game.round++;
    game.guesses = new Map(); // userId → 'higher' | 'lower'
    game.next = draw(game.number); // decided now, shown at the reveal
    game.state = 'guessing';
    game.endsAt = Date.now() + guessSeconds * 1000;
    const round = game.round;
    game.timer = setTimeout(() => runExclusive(game, () => reveal(game, round)), guessSeconds * 1000);
}

async function reveal(game, round) {
    if (!getGame(game.id) || game.state !== 'guessing' || game.round !== round) return;
    clearTimeout(game.timer);
    clearTimeout(game.refresh);
    game.refresh = null;

    const answer = game.next > game.number ? 'higher' : 'lower';
    const missed = game.alive.filter(id => game.guesses.get(id) !== answer);
    const everyoneMissed = missed.length === game.alive.length; // then nobody goes out
    const out = everyoneMissed ? [] : missed;
    game.alive = game.alive.filter(id => !out.includes(id));
    for (const id of out) game.outIn.set(id, round);
    for (const id of game.alive) if (game.guesses.get(id) === answer) game.right.set(id, game.right.get(id) + 1);
    game.last = { from: game.number, to: game.next, answer, out, everyoneMissed };
    game.number = game.next;

    if (game.alive.length === 1 || round >= settings().maxRounds) await finish(game, { winners: game.alive });
    else ask(game);
    return editGame(game, render(game));
}

async function finish(game, { winners = [], note = null } = {}) {
    clearTimeout(game.timer);
    clearTimeout(game.refresh);
    endGame(game);
    game.state = 'over';
    game.winners = winners;
    game.note = note;
    // Winners first, then whoever lasted longest, then most right guesses
    const lasted = (id) => (winners.includes(id) ? Infinity : game.outIn.get(id) ?? Infinity);
    game.ranking = [...game.players].sort((a, b) => lasted(b) - lasted(a) || game.right.get(b) - game.right.get(a));
    // The winner's reward grows with the players they knocked out; with nobody knocked out, there's none
    const { perRound } = REWARDS.higherLower;
    const beaten = game.outIn.size;
    const awards = game.ranking.map(userId => ({
        userId,
        amount: perRound * game.right.get(userId) + (winners.includes(userId) && beaten ? winnerReward('higherLower', beaten + 1) : 0),
    }));
    game.rewards = await payEach(awards, { guildId: game.guildId, game: 'Higher or Lower' });
}

// Shows how many have guessed, without editing the message on every single click
function scheduleRefresh(game) {
    if (game.refresh) return;
    const round = game.round;
    game.refresh = setTimeout(() => runExclusive(game, async () => {
        game.refresh = null;
        if (getGame(game.id) && game.state === 'guessing' && game.round === round) await editGame(game, render(game));
    }), REFRESH_MS);
}

// ─── Clicks ───────────────────────────────────────────────────
async function handle(game, interaction, action, arg) {
    if (await handleLobby(game, interaction, action)) return;
    const userId = interaction.user.id;

    if (action === 'higher' || action === 'lower') {
        if (!game.players.includes(userId)) return notify(interaction, 'You\'re not in this game. Join the next one!');
        if (!game.alive.includes(userId)) return notify(interaction, 'You\'re out of this game. Watch how it ends!');
        // The buttons carry their round, so a click made just before a reveal doesn't count for the next number
        if (Number(arg) !== game.round) return notify(interaction, 'Too late: the number changed. Guess again!');
        const guess = game.guesses.get(userId);
        if (guess) return notify(interaction, `You already picked ${CHOICES[guess]}.`);
        game.guesses.set(userId, action);
        touch(game, interaction);
        await notify(interaction, `Locked in: ${CHOICES[action]} than ${game.number}`);
        if (game.guesses.size === game.alive.length) return reveal(game, game.round);
        return scheduleRefresh(game);
    }
    if (action === 'end') {
        if (userId !== game.host) return notify(interaction, 'Only the host can end the game.');
        await finish(game, { note: `<@${userId}> ended the game early.` });
        return updateBoard(game, interaction, render(game));
    }
}

// ─── Drawing ──────────────────────────────────────────────────
function lastReveal({ from, to, answer, out, everyoneMissed }) {
    const result = everyoneMissed ? 'Everyone missed, so nobody is out!'
        : out.length ? `Out: ${playerList(out)}`
            : 'Everyone got it!';
    return `${answer === 'higher' ? '⬆️' : '⬇️'} **${to}** is ${answer} than ${from} · ${result}`;
}

function render(game) {
    const { maxRounds } = settings();
    if (game.state === 'over') {
        const lines = game.ranking.map(userId =>
            `${game.winners.includes(userId) ? '🏆' : '•'} <@${userId}> · ` +
            `${game.right.get(userId)} right${game.outIn.has(userId) ? ` · out in round ${game.outIn.get(userId)}` : ''}` +
            (game.rewards?.get(userId) ? ` · ${game.rewards.get(userId)}` : ''));
        const verdict = game.winners.length === 1 ? `🏆 <@${game.winners[0]}> is the last one in and wins!`
            : game.winners.length ? `🏆 Still in after ${maxRounds} rounds, so they all win: ${playerList(game.winners)}`
                : null;
        return gamePayload([
            `## ${TITLE} · Game over`,
            game.last ? lastReveal(game.last) : null,
            verdict,
            game.note ? `-# ${game.note}` : null,
            lines.join('\n'),
        ], COLOR);
    }

    return gamePayload([
        `## ${TITLE} · Round ${game.round}/${maxRounds}`,
        game.last ? lastReveal(game.last) : null,
        `# ${game.number}`,
        'Will the next number (1 to 100) be **higher** or **lower**? Pick privately below.',
        `**Still in · ${game.alive.length}/${game.players.length}** · ${playerList(game.alive)}`,
        `-# ${game.guesses.size}/${game.alive.length} guessed · time's up ${at(game.endsAt)} · no guess counts as wrong`,
        row(
            button(`game:${game.id}:higher:${game.round}`, 'Higher', ButtonStyle.Primary, { emoji: '⬆️' }),
            button(`game:${game.id}:lower:${game.round}`, 'Lower', ButtonStyle.Primary, { emoji: '⬇️' }),
        ),
        row(button(`game:${game.id}:end`, 'End game', ButtonStyle.Danger)),
    ], COLOR);
}

/** Opens the lobby (from the /games menu) */
function start(interaction) {
    const { minPlayers, maxPlayers, guessSeconds, maxRounds } = settings();
    return openLobby(interaction, 'higherLower', {
        title: TITLE,
        color: COLOR,
        minPlayers,
        maxPlayers,
        rules: `I show a number from 1 to 100. Everyone privately guesses if the next one is higher or lower (${guessSeconds}s). ` +
            `Guess wrong and you're out, unless everyone missed. Last one in wins; anyone left after ${maxRounds} rounds wins too.`,
    }, { begin, render });
}

// Everyone guesses at once, so guesses are acknowledged before waiting in the queue (see index.js)
const deferActions = new Set([...LOBBY_ACTIONS, 'higher', 'lower', 'end']);

module.exports = { start, handle, render, deferActions, TITLE };
