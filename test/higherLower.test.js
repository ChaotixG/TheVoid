const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { startDatabase, stopDatabase, clearDatabase, inspectPanel } = require('./helpers');

// Short timers so lobbies and rounds can be played through quickly
const gameConfig = require('../src/config/games');
gameConfig.LOBBY_SECONDS = 0.4;
Object.assign(gameConfig.PARTY.higherLower, { guessSeconds: 0.4, maxRounds: 3 });

const Wallet = require('../src/models/Wallet');
const GameStats = require('../src/models/GameStats');
const { games } = require('../src/features/games/sessions');
const router = require('../src/events/interactionCreate/router');
const higherLower = require('../src/features/games/higherLower');
const { winnerReward } = require('../src/features/games/scoring');

const stopTimers = () => { for (const g of games.values()) { clearTimeout(g.timer); clearTimeout(g.refresh); } };
before(startDatabase);
after(async () => { stopTimers(); await stopDatabase(); });
beforeEach(async () => {
    await clearDatabase();
    stopTimers();
    games.clear();
});

const balanceOf = async (userId) => (await Wallet.findOne({ userId }).lean())?.balance ?? 0;
// { userId: { played, wins, best } } for this game
const stats = async () => Object.fromEntries((await GameStats.find({ game: 'higherLower' }).lean()).map(r => [r.userId, { played: r.played, wins: r.wins, best: r.best }]));
const text = (payload) => JSON.stringify(payload.components.map(c => c.toJSON()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 3000) {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) throw new Error('Timed out waiting');
        await wait(20);
    }
}

// Every edit of the shared game message, from any interaction, in order
let screens = [];
beforeEach(() => { screens = []; });
const latest = () => text(screens.at(-1));

// A stand-in interaction on the /games message (m1) that records what the bot answered
function fake({ userId = 'p1', customId } = {}) {
    const calls = { replies: [] };
    const i = {
        user: { id: userId }, guildId: 'g1', channelId: 'c1', customId,
        message: { id: 'm1', edit: async (p) => { screens.push(p); } },
        createdTimestamp: Date.now(),
        client: { user: { id: 'me' } },
        deferred: false, replied: false,
        isChatInputCommand: () => false, isMessageComponent: () => true, isModalSubmit: () => false, isRepliable: () => true,
        reply: async (p) => { calls.replies.push(p); i.replied = true; },
        update: async (p) => { screens.push(p); i.replied = true; },
        deferUpdate: async () => { i.deferred = true; },
        editReply: async (p) => { screens.push(p); },
        followUp: async (p) => { calls.replies.push(p); },
    };
    return { i, calls };
}
const press = async (customId, userId = 'p1') => {
    const f = fake({ userId, customId });
    await router(null, f.i);
    return f.calls;
};
const click = (game, userId, action, arg = '') => press(`game:${game.id}:${action}:${arg}`, userId);
const guess = (game, userId, choice) => click(game, userId, choice, game.round);
const onlyGame = () => [...games.values()][0];
const notice = (calls) => calls.replies[0]?.content;

async function startGame(players = ['p1', 'p2']) {
    await press(`games:start:${players[0]}:higherLower:`, players[0]);
    const game = onlyGame();
    for (const id of players.slice(1)) await click(game, id, 'join');
    await click(game, players[0], 'begin');
    return game;
}

// Fixes the number showing and the one about to be revealed
const setNumbers = (game, number, next) => Object.assign(game, { number, next });

test('higher or lower: guesses are private and final; wrong or missing guesses go out', async () => {
    const game = await startGame(['p1', 'p2', 'p3', 'p4']);
    assert.equal(game.state, 'guessing');
    assert.ok(game.number >= 1 && game.number <= 100);
    assert.notEqual(game.next, game.number, 'the next number is never the same');
    assert.match(latest(), /Round 1\/3/);
    assert.ok(latest().includes(`# ${game.number}`));
    setNumbers(game, 50, 80);

    assert.match(notice(await guess(game, 'p9', 'higher')), /not in this game/);
    assert.match(notice(await guess(game, 'p1', 'higher')), /Locked in: ⬆️ \*\*Higher\*\* than 50/);
    assert.match(notice(await guess(game, 'p1', 'lower')), /already picked ⬆️/);
    await guess(game, 'p2', 'lower');
    await guess(game, 'p4', 'higher');
    assert.equal(game.round, 1, 'waits for everyone still in');

    await until(() => game.round === 2); // p3 never guesses
    assert.deepEqual(game.alive, ['p1', 'p4']);
    assert.equal(game.number, 80);
    assert.match(latest(), /⬆️ \*\*80\*\* is higher than 50 · Out: <@p2>, <@p3>/);
    assert.ok(latest().includes('# 80'));
    assert.match(latest(), /Still in · 2\/4/);

    assert.match(notice(await guess(game, 'p2', 'higher')), /You're out/);
    assert.match(notice(await click(game, 'p1', 'higher', 1)), /Too late/, 'a button from the last round');
    assert.equal(game.guesses.size, 0);
});

test('higher or lower: when everyone still in misses, nobody goes out', async () => {
    const game = await startGame();
    setNumbers(game, 50, 20);
    await guess(game, 'p1', 'higher');
    await guess(game, 'p2', 'higher'); // everyone has guessed: revealed right away
    assert.equal(game.round, 2);
    assert.deepEqual(game.alive, ['p1', 'p2']);
    assert.match(latest(), /⬇️ \*\*20\*\* is lower than 50 · Everyone missed, so nobody is out!/);

    setNumbers(game, 20, 90);
    await until(() => game.round === 3); // nobody guesses: nobody goes out either
    assert.deepEqual(game.alive, ['p1', 'p2']);
});

test('higher or lower: the last one in wins; coins per right guess plus the winner\'s reward', async () => {
    const game = await startGame(['p1', 'p2', 'p3']);
    setNumbers(game, 50, 70);
    await guess(game, 'p1', 'higher');
    await guess(game, 'p2', 'higher');
    await guess(game, 'p3', 'lower');
    assert.deepEqual(game.alive, ['p1', 'p2']);

    setNumbers(game, 70, 10);
    await guess(game, 'p1', 'lower');
    await guess(game, 'p2', 'higher');
    assert.equal(game.state, 'over');
    assert.equal(games.size, 0);

    const { perRound } = gameConfig.REWARDS.higherLower;
    const p1Coins = 2 * perRound + winnerReward('higherLower', 3);
    assert.match(latest(), /Game over/);
    assert.match(latest(), /<@p1> is the last one in and wins!/);
    assert.match(latest(), new RegExp(`🏆 <@p1> · 2 right · \\+${p1Coins} 🪙`));
    assert.match(latest(), /<@p2> · 1 right · out in round 2 · \+2 🪙/);
    assert.match(latest(), /<@p3> · 0 right · out in round 1/);
    assert.equal(await balanceOf('p1'), p1Coins);
    assert.equal(await balanceOf('p2'), perRound);
    assert.equal(await balanceOf('p3'), 0);
    assert.match(notice(await guess(game, 'p1', 'higher')), /This game has ended/);
    assert.deepEqual(await stats(), {
        p1: { played: 1, wins: 1, best: 2 },
        p2: { played: 1, wins: 0, best: 1 },
        p3: { played: 1, wins: 0, best: 0 },
    }, 'recorded once, with right guesses as the score');
});

test('higher or lower: everyone still in after the last round wins', async () => {
    const game = await startGame();
    for (let round = 1; round <= 3; round++) {
        setNumbers(game, 50, 60);
        await guess(game, 'p1', 'higher');
        await guess(game, 'p2', 'higher');
    }
    assert.equal(game.state, 'over');
    assert.match(latest(), /Still in after 3 rounds, so they all win: <@p1>, <@p2>/);
    const coins = 3 * gameConfig.REWARDS.higherLower.perRound; // nobody was knocked out: no winner's reward
    assert.equal(await balanceOf('p1'), coins);
    assert.equal(await balanceOf('p2'), coins);
    assert.deepEqual(await stats(), { p1: { played: 1, wins: 1, best: 3 }, p2: { played: 1, wins: 1, best: 3 } });
});

test('higher or lower: players who never guess can\'t collect coins by sitting through every round', async () => {
    const game = await startGame();
    await until(() => game.state === 'over'); // three rounds pass with no guesses
    assert.match(latest(), /they all win/);
    assert.equal(await balanceOf('p1'), 0);
    assert.equal(await balanceOf('p2'), 0);
});

test('higher or lower: the host can end it early, and right guesses so far are paid', async () => {
    const game = await startGame();
    setNumbers(game, 50, 60);
    await guess(game, 'p1', 'higher');
    await guess(game, 'p2', 'higher');
    assert.match(notice(await click(game, 'p2', 'end')), /Only the host/);
    await click(game, 'p1', 'end');
    assert.equal(games.size, 0);
    assert.match(latest(), /ended the game early/);
    assert.doesNotMatch(latest(), /wins/);
    assert.equal(await balanceOf('p1'), gameConfig.REWARDS.higherLower.perRound, 'no winner yet, so no winner\'s reward');
    assert.equal(await balanceOf('p2'), gameConfig.REWARDS.higherLower.perRound);
    assert.deepEqual(await stats(), { p1: { played: 1, wins: 0, best: 1 }, p2: { played: 1, wins: 0, best: 1 } }, 'no winners when ended early');
});

test('higher or lower: nobody can tell who picked what before the reveal', async () => {
    const saved = gameConfig.PARTY.higherLower.guessSeconds;
    gameConfig.PARTY.higherLower.guessSeconds = 3; // long enough for the "2/3 guessed" refresh to go out
    try {
        const game = await startGame(['p1', 'p2', 'p3']);
        setNumbers(game, 50, 87);
        const shown = screens.length;
        const replies = [...(await guess(game, 'p1', 'higher')).replies, ...(await guess(game, 'p2', 'lower')).replies];
        assert.equal(replies.length, 2);
        assert.ok(replies.every(r => r.flags & MessageFlags.Ephemeral), 'confirmations are private');

        await until(() => /2\/3 guessed/.test(latest()), 4000);
        const publicText = screens.slice(shown).map(text).join('\n').replace(/<t:\d+:R>/g, '');
        assert.doesNotMatch(publicText, /Locked in|picked/);
        assert.doesNotMatch(publicText, /\b87\b/, 'the next number stays hidden');
        // The board is the same whoever picked what: only how many have guessed shows
        const swapped = () => ({ ...game, guesses: new Map([['p1', 'lower'], ['p2', 'higher']]) });
        assert.equal(text(higherLower.render(swapped())), text(higherLower.render(game)));

        // Ending mid-round doesn't give this round's picks away either
        await click(game, 'p1', 'end');
        assert.equal(game.state, 'over');
        assert.equal(text(higherLower.render(swapped())), text(higherLower.render(game)));
        assert.doesNotMatch(latest().replace(/<t:\d+:R>/g, ''), /\b87\b/);
    } finally {
        gameConfig.PARTY.higherLower.guessSeconds = saved;
    }
});

test('higher or lower: boards fit Discord\'s limits with the most players', async () => {
    const { maxPlayers } = gameConfig.PARTY.higherLower;
    const ids = Array.from({ length: maxPlayers }, (_, n) => `2000000000000000${String(n).padStart(2, '0')}`);
    const game = await startGame(ids);
    assert.equal(game.players.length, maxPlayers);
    const check = (payload, label) => {
        const { count, textLength, ids: customIds } = inspectPanel(payload);
        assert.ok(count <= 40 && textLength <= 4000, `${label}: ${count} components, ${textLength} characters`);
        assert.equal(new Set(customIds).size, customIds.length, `${label}: duplicate custom_id`);
    };
    check(screens.at(-1), 'first round');

    // Half go out at once, so the reveal lists ten names
    setNumbers(game, 50, 60);
    for (const [n, id] of ids.entries()) await guess(game, id, n % 2 ? 'lower' : 'higher');
    assert.equal(game.alive.length, maxPlayers / 2);
    check(screens.at(-1), 'after a reveal');
    await click(game, ids[0], 'end');
    check(screens.at(-1), 'final');
});
