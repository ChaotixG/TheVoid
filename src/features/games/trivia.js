// Trivia: multiple-choice questions from the Open Trivia Database (opentdb.com, CC BY-SA 4.0).
// Solo: only you answer. Race: anyone in the channel answers; the first correct answer wins and a
// wrong answer locks you out of that question.
const { randomInt } = require('crypto');
const { TRIVIA_SECONDS } = require('../../config/games');
const { triviaReward } = require('./scoring');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { createGame, endGame, runExclusive, touch } = require('./sessions');
const { payGameReward, rewardText } = require('./rewards');
const { gamePayload, updateBoard, notify } = require('./common');
const { warn } = require('../../services/logger');

const TITLE = '🧠 Trivia';
const LETTERS = ['🇦', '🇧', '🇨', '🇩'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const API_GAP_MS = 5_100; // the API allows one request every 5 seconds

// ─── Questions (fetched 50 at a time and kept in a pool per difficulty) ──
const pools = { any: [], easy: [], medium: [], hard: [] };
let apiQueue = Promise.resolve();
let lastRequest = 0;

const shuffle = (items) => {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

function decodeQuestion(q) {
    const d = decodeURIComponent;
    const correct = d(q.correct_answer);
    return {
        category: d(q.category),
        difficulty: q.difficulty,
        question: d(q.question),
        correct,
        answers: shuffle([correct, ...q.incorrect_answers.map(d)]),
    };
}

// Requests are queued and spaced out so the API's rate limit is never hit
function refill(difficulty) {
    apiQueue = apiQueue.then(async () => {
        if (pools[difficulty].length >= 5) return;
        const wait = lastRequest + API_GAP_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastRequest = Date.now();
        const level = difficulty === 'any' ? '' : `&difficulty=${difficulty}`;
        const response = await fetch(`https://opentdb.com/api.php?amount=50&type=multiple&encode=url3986${level}`, { signal: AbortSignal.timeout(8_000) });
        const data = await response.json();
        if (data.response_code !== 0) throw new Error(`Open Trivia DB answered with code ${data.response_code}`);
        pools[difficulty].push(...data.results.map(decodeQuestion));
    }).catch(err => warn(`Could not fetch trivia questions: ${err.message}`));
    return apiQueue;
}

async function nextQuestion(difficulty) {
    if (!pools[difficulty].length) await refill(difficulty);
    const question = pools[difficulty].shift() ?? null;
    if (pools[difficulty].length < 5) refill(difficulty); // top up in the background
    return question;
}

// ─── Panel ────────────────────────────────────────────────────
function render(game) {
    const q = game.question;
    const asking = game.state === 'asking';
    const answerButton = (answer, i) => {
        let style = ButtonStyle.Secondary;
        if (!asking && answer === q.correct) style = ButtonStyle.Success;
        else if (!asking && answer === game.chosen) style = ButtonStyle.Danger;
        return row(button(`game:${game.id}:answer:${i}`, answer.slice(0, 80), style, { emoji: LETTERS[i], disabled: !asking }));
    };

    let status = null;
    if (asking) {
        const who = game.mode === 'race' ? 'First correct answer wins' : 'Answer';
        status = `-# ${who} · time's up <t:${Math.ceil(game.deadline / 1000)}:R>`;
    } else if (game.winnerId) {
        const streak = game.mode === 'solo' && game.streak > 1 ? ` 🔥 ${game.streak} in a row!` : '';
        status = `✅ <@${game.winnerId}> got it!${streak} ${rewardText(game.reward ?? {})}`.trim();
    } else if (game.timedOut) {
        status = `⏰ Time's up! The answer was **${q.correct}**.`;
    } else {
        status = `❌ Not quite. The answer was **${q.correct}**.`;
    }

    const score = game.mode === 'solo' && game.asked > 0 ? ` · score ${game.correct}/${game.asked}` : '';
    const controls = !asking && !game.stopped ? row(
        button(`game:${game.id}:next`, 'Next question', ButtonStyle.Primary),
        button(`game:${game.id}:stop`, 'Stop', ButtonStyle.Secondary),
    ) : null;

    return gamePayload([
        `## ${TITLE} · ${q.category}\n-# ${q.difficulty[0].toUpperCase()}${q.difficulty.slice(1)}${game.mode === 'race' ? ' · race' : ''}${score}`,
        `**${q.question}**`,
        ...q.answers.map(answerButton),
        status,
        game.stopped ? `Thanks for playing!${game.mode === 'solo' ? ` You got ${game.correct} of ${game.asked} right.` : ''}` : null,
        controls,
        '-# Questions from the Open Trivia Database (opentdb.com), CC BY-SA 4.0',
    ], 0x9B59B6, game.winnerId ? [game.winnerId] : []);
}

// ─── Flow ─────────────────────────────────────────────────────
function ask(game, question) {
    Object.assign(game, { question, state: 'asking', chosen: null, winnerId: null, reward: null, timedOut: false, lockedOut: new Set() });
    game.round = (game.round ?? 0) + 1;
    game.deadline = Date.now() + TRIVIA_SECONDS * 1000;
    clearTimeout(game.timer);
    const round = game.round;
    game.timer = setTimeout(() => runExclusive(game, async () => {
        if (game.round !== round || game.state !== 'asking') return;
        game.state = 'revealed';
        game.timedOut = true;
        game.streak = 0;
        if (game.mode === 'solo') game.asked++;
        await game.lastInteraction?.editReply(render(game)).catch(() => {});
    }), TRIVIA_SECONDS * 1000);
}

async function handle(game, interaction, action, arg) {
    const userId = interaction.user.id;
    const isStarter = userId === game.starterId;

    if (action === 'answer') {
        // Answer clicks arrive already acknowledged (see games/index.js), so notices are follow-ups
        if (game.state !== 'asking') return notify(interaction, 'This question is over.');
        if (game.mode === 'solo' && !isStarter) return notify(interaction, 'This is someone else\'s trivia. Start your own with **/trivia**!');
        if (game.lockedOut.has(userId)) return notify(interaction, 'You already answered this one.');

        const answer = game.question.answers[Number(arg)];
        if (answer !== game.question.correct && game.mode === 'race') {
            game.lockedOut.add(userId);
            return notify(interaction, '❌ Not quite! You\'re out for this question.');
        }

        clearTimeout(game.timer);
        if (!interaction.deferred) await interaction.deferUpdate();
        game.state = 'revealed';
        game.chosen = answer;
        if (game.mode === 'solo') game.asked++;
        if (answer === game.question.correct) {
            game.winnerId = userId;
            // Solo: answers in a row earn a streak bonus; a race pays each winner the base amount
            game.streak = game.mode === 'solo' ? (game.streak ?? 0) + 1 : 1;
            if (game.mode === 'solo') game.correct++;
            game.reward = await payGameReward(userId, triviaReward(game.question.difficulty, game.streak), { guildId: game.guildId, game: 'Trivia' });
        } else {
            game.streak = 0;
        }
        return updateBoard(game, interaction, render(game));
    }

    if (action === 'next' || action === 'stop') {
        if (!isStarter) return interaction.reply(ephemeral('Only the person who started this trivia can do that.'));
        if (game.state === 'asking') return interaction.reply(ephemeral('Answer the current question first.'));
        await interaction.deferUpdate();
        if (action === 'stop') {
            game.stopped = true;
            endGame(game);
            return updateBoard(game, interaction, render(game));
        }
        const question = await nextQuestion(game.difficulty);
        if (!question) return interaction.followUp(ephemeral('I couldn\'t get another question right now. Try again in a minute.'));
        ask(game, question);
        return updateBoard(game, interaction, render(game));
    }
    return interaction.deferUpdate();
}

async function start(interaction) {
    const mode = interaction.options.getString('mode') ?? 'solo';
    const difficulty = interaction.options.getString('difficulty') ?? 'any';
    await interaction.deferReply();

    const question = await nextQuestion(difficulty);
    if (!question) return interaction.editReply('Trivia questions are unavailable right now. Try again in a minute.');

    const game = createGame('trivia', {
        guildId: interaction.guildId,
        starterId: interaction.user.id,
        players: [interaction.user.id],
        mode,
        difficulty,
        asked: 0,
        correct: 0,
    });
    game.onExpire = () => {
        if (game.state === 'asking') game.timedOut = true;
        game.stopped = true;
        game.state = 'revealed';
        return render(game);
    };
    ask(game, question);
    await interaction.editReply({ ...render(game), content: null, embeds: [] });
    touch(game, interaction);
}

module.exports = { start, handle, render, decodeQuestion, nextQuestion, pools, DIFFICULTIES };
