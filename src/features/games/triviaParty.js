// Trivia Party: everyone in the lobby gets the same questions at the same time and answers
// privately. A right answer scores 100 points plus up to 50 for speed; the best score wins.
// Questions come from the trivia question pool (trivia.js).
const { PARTY, REWARDS } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, editGame, notify } = require('./common');
const { openLobby, handleLobby, LOBBY_ACTIONS } = require('./lobby');
const { nextQuestion } = require('./trivia');
const { payEach } = require('./rewards');
const { recordGame } = require('./stats');

const TITLE = '🎉 Trivia Party';
const COLOR = 0xEB459E;
const LETTERS = ['🇦', '🇧', '🇨', '🇩'];
const MEDALS = ['🥇', '🥈', '🥉'];
const REFRESH_MS = 2_000; // "3/6 answered" is updated at most this often
const settings = () => PARTY.triviaParty; // read when used, so tests can shorten the timers

const at = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

// ─── Flow: ask → (everyone answered, or time's up) → reveal → next question … → final scores ──
async function begin(game) {
    game.scores = new Map(game.players.map(id => [id, { points: 0, correct: 0, coins: 0 }]));
    game.round = 0;
    await ask(game);
}

async function ask(game) {
    const question = await nextQuestion(game.difficulty);
    if (!question) return finish(game, 'I couldn\'t get more questions right now, so the game ended early.');
    const { answerSeconds } = settings();
    game.round++;
    game.question = question;
    game.answers = new Map(); // userId → { index, at }
    game.state = 'asking';
    game.askedAt = Date.now();
    game.endsAt = game.askedAt + answerSeconds * 1000;
    const round = game.round;
    game.timer = setTimeout(() => runExclusive(game, () => reveal(game, round)), answerSeconds * 1000);
}

async function reveal(game, round) {
    if (!getGame(game.id) || game.state !== 'asking' || game.round !== round) return;
    clearTimeout(game.timer);
    const { answerSeconds, questions, revealSeconds } = settings();
    const r = REWARDS.triviaParty;
    const correctIndex = game.question.answers.indexOf(game.question.correct);

    // Right answers: 100 points plus up to 50 (and a coin bonus) for speed
    game.results = [];
    for (const userId of game.players) {
        const answer = game.answers.get(userId);
        if (answer?.index !== correctIndex) continue;
        const speed = Math.max(0, 1 - (answer.at - game.askedAt) / (answerSeconds * 1000));
        const points = 100 + Math.round(50 * speed);
        const score = game.scores.get(userId);
        score.points += points;
        score.correct++;
        score.coins += r.perCorrect + Math.round(r.speedBonus * speed);
        game.results.push({ userId, points });
    }
    game.state = 'revealed';

    if (game.round >= questions) {
        await finish(game);
        return editGame(game, render(game));
    }
    game.nextAt = Date.now() + revealSeconds * 1000;
    await editGame(game, render(game));
    game.timer = setTimeout(() => runExclusive(game, async () => {
        if (!getGame(game.id) || game.state !== 'revealed' || game.round !== round) return;
        await ask(game);
        await editGame(game, render(game));
    }), revealSeconds * 1000);
}

async function finish(game, note = null) {
    clearTimeout(game.timer);
    clearTimeout(game.refresh);
    endGame(game);
    game.state = 'over';
    game.note = note;
    game.ranking = [...game.scores.entries()].sort((a, b) => b[1].points - a[1].points);
    const best = game.ranking[0]?.[1].points ?? 0;
    const awards = game.ranking.map(([userId, s]) => ({
        userId,
        amount: s.coins + (best > 0 && s.points === best ? REWARDS.triviaParty.winnerBonus : 0), // a tie shares the win
    }));
    game.rewards = await payEach(awards, { guildId: game.guildId, game: 'Trivia Party' });
    await recordGame(game, {
        winners: best > 0 ? game.ranking.filter(([, s]) => s.points === best).map(([userId]) => userId) : [],
        scores: Object.fromEntries(game.ranking.map(([userId, s]) => [userId, s.points])),
    });
}

// Shows how many have answered, without editing the message on every single click
function scheduleRefresh(game) {
    if (game.refresh) return;
    const round = game.round;
    game.refresh = setTimeout(() => runExclusive(game, async () => {
        game.refresh = null;
        if (getGame(game.id) && game.state === 'asking' && game.round === round) await editGame(game, render(game));
    }), REFRESH_MS);
}

// ─── Clicks ───────────────────────────────────────────────────
async function handle(game, interaction, action, arg) {
    if (await handleLobby(game, interaction, action)) return;
    const userId = interaction.user.id;

    if (action === 'answer') {
        if (!game.players.includes(userId)) return notify(interaction, 'You\'re not in this game. Join the next one!');
        if (game.state !== 'asking') return notify(interaction, 'Too late for this question!');
        if (game.answers.has(userId)) return notify(interaction, 'You already answered this one.');
        const index = Number(arg);
        if (!game.question.answers[index]) return;
        game.answers.set(userId, { index, at: Date.now() });
        touch(game, interaction);
        await notify(interaction, `Locked in: ${LETTERS[index]} **${game.question.answers[index]}**`);
        if (game.answers.size === game.players.length) return reveal(game, game.round);
        return scheduleRefresh(game);
    }
    if (action === 'end') {
        if (userId !== game.host) return notify(interaction, 'Only the host can end the game.');
        touch(game, interaction);
        await finish(game, `<@${userId}> ended the game early.`);
        return editGame(game, render(game));
    }
}

// ─── Drawing ──────────────────────────────────────────────────
function standings(game, limit = 5) {
    return [...game.scores.entries()]
        .sort((a, b) => b[1].points - a[1].points)
        .slice(0, limit)
        .map(([userId, s], i) => `${i + 1}. <@${userId}> ${s.points.toLocaleString()}`)
        .join(' · ');
}

function render(game) {
    const { questions } = settings();
    if (game.state === 'over') {
        const lines = game.ranking.map(([userId, s], i) =>
            `${MEDALS[i] ?? `**${i + 1}.**`} <@${userId}> · ${s.points.toLocaleString()} pts · ${s.correct}/${game.round} right` +
            (game.rewards?.get(userId) ? ` · ${game.rewards.get(userId)}` : ''));
        return gamePayload([
            `## ${TITLE} · Final scores`,
            game.question ? `-# The last answer was **${game.question.correct}**.` : null,
            game.note ? `-# ${game.note}` : null,
            lines.join('\n'),
        ], COLOR);
    }

    const q = game.question;
    const parts = [
        `## ${TITLE} · Question ${game.round}/${questions}`,
        `-# ${q.category} · ${q.difficulty}`,
        `**${q.question}**\n${q.answers.map((a, i) => `${LETTERS[i]} ${a}`).join('\n')}`,
    ];
    if (game.state === 'asking') {
        parts.push(`-# ${game.answers.size}/${game.players.length} answered · time's up ${at(game.endsAt)}`);
        parts.push(row(...q.answers.map((_, i) => button(`game:${game.id}:answer:${i}`, null, ButtonStyle.Secondary, { emoji: LETTERS[i] }))));
    } else {
        const right = game.results.map(r => `<@${r.userId}> +${r.points}`).join(', ');
        parts.push(`✅ **${q.correct}**\n${right ? `Got it: ${right}` : 'Nobody got it.'}`);
        parts.push(`**Standings** · ${standings(game)}`);
        parts.push(`-# Next question ${at(game.nextAt)}`);
    }
    parts.push(row(button(`game:${game.id}:end`, 'End game', ButtonStyle.Danger)));
    return gamePayload(parts, COLOR);
}

/** Opens the lobby (from the /games menu) */
function start(interaction, { difficulty = 'any' } = {}) {
    const { minPlayers, maxPlayers, questions, answerSeconds } = settings();
    return openLobby(interaction, 'triviaParty', {
        title: TITLE,
        color: COLOR,
        minPlayers,
        maxPlayers,
        rules: `Everyone gets the same ${questions} questions at once and answers privately (${answerSeconds}s each). ` +
            'A right answer scores 100 points, plus up to 50 for answering fast. Highest score wins.' +
            (difficulty !== 'any' ? `\n-# Difficulty: ${difficulty}` : ''),
        data: { difficulty },
    }, { begin, render });
}

// Everyone answers at once, so answers are acknowledged before waiting in the queue (see index.js)
const deferActions = new Set([...LOBBY_ACTIONS, 'answer', 'end']);

module.exports = { start, handle, render, deferActions, TITLE };
