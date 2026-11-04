// Liar's Dice: everyone rolls their dice in secret, then players take turns bidding how many of a
// face are on the whole table (ones are wild), each bid higher than the last, until someone calls
// "Liar!". Whoever was wrong loses a die; the last player with dice wins.
// Your dice are in a private view; bids are made in a form.
const { randomInt } = require('crypto');
const { LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder } = require('discord.js');
const { PARTY, REWARDS } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, updateBoard, editGame, notify } = require('./common');
const { openLobby, handleLobby, LOBBY_ACTIONS } = require('./lobby');
const { winnerReward } = require('./scoring');
const { payEach } = require('./rewards');

const TITLE = '🎲 Liar\'s Dice';
const COLOR = 0xE67E22;
const FACES = [null, '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
const FACE_NAMES = [null, 'Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes'];
const REVEAL_SECONDS = 5; // how long a reveal stays up before everyone rolls again
const MAX_CHOICES = 25;   // a select menu holds at most 25 options
const settings = () => PARTY.liarsDice; // read when used, so tests can shorten the timers

// Dice rolls; tests replace `roll` to choose the dice
const roller = { roll: (count) => Array.from({ length: count }, () => randomInt(1, 7)) };

const at = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const showDice = (rolls) => [...rolls].sort((a, b) => a - b).map(d => FACES[d]).join(' ');
const bidText = ({ quantity, face }) => `**${quantity} × ${FACES[face]}**`;
const alive = (game) => game.players.filter(id => game.dice.get(id) > 0);
const diceInPlay = (game) => alive(game).reduce((sum, id) => sum + game.dice.get(id), 0);

// ─── Rules ────────────────────────────────────────────────────
// Dice showing `face`, counting ones (they're wild)
const matches = (dice, face) => dice.filter(d => d === face || d === 1).length;
/** Matches across everyone's rolls (a Map of userId → dice) */
const countMatches = (rolls, face) => matches([...rolls.values()].flat(), face);

// The smallest quantity a new bid can have: the same quantity only works with a higher face
const minQuantity = (bid) => (!bid ? 1 : bid.face < 6 ? bid.quantity : bid.quantity + 1);
const canRaise = (game) => minQuantity(game.bid) <= diceInPlay(game);

/** Why a bid isn't allowed, or null if it is. A raise needs more dice, or as many of a higher face. */
function bidProblem(bid, quantity, face, total) {
    if (!Number.isInteger(face) || face < 2 || face > 6) return 'Bid on a face from 2️⃣ to 6️⃣ (ones are wild, so they can\'t be bid on).';
    if (!Number.isInteger(quantity) || quantity < 1) return 'Bid at least one die.';
    if (quantity > total) return `There are only ${total} dice in play.`;
    if (bid && (quantity < bid.quantity || (quantity === bid.quantity && face <= bid.face))) {
        return `Your bid has to beat ${bidText(bid)}: more dice, or ${bid.quantity} of a higher face.`;
    }
    return null;
}

// The next player still in after `userId` (or `userId` itself, when `inclusive` and they're still in)
function nextIn(game, userId, inclusive = false) {
    const start = game.players.indexOf(userId);
    for (let step = inclusive ? 0 : 1; step <= game.players.length; step++) {
        const id = game.players[(start + step) % game.players.length];
        if (game.dice.get(id) > 0) return id;
    }
    return null;
}

// ─── Flow: roll → bids → Liar! (or time's up) → reveal → roll again … → one player left ──
async function begin(game) {
    game.dice = new Map(game.players.map(id => [id, settings().dice]));
    game.startingPlayers = game.players.length;
    game.out = []; // { userId, round, left } in the order players went out
    game.round = 0;
    game.turnNo = 0; // counts every turn, so late timers and old bid forms can be told apart
    game.starter = game.players[0];
    game.onExpire = () => {
        game.state = 'expired';
        return gamePayload([`## ${TITLE} · Round ${game.round}`, playerLines(game), '-# Nobody played for a while, so the game ended.'], COLOR);
    };
    newRound(game);
}

// Everyone still in rolls again; the starter (or the next player still in) opens the bidding
function newRound(game) {
    game.round++;
    game.rolls = new Map(alive(game).map(id => [id, roller.roll(game.dice.get(id), id)]));
    game.bid = null;
    game.bids = [];
    game.reveal = null;
    game.note = null;
    game.state = 'bidding';
    startTurn(game, nextIn(game, game.starter, true));
}

function startTurn(game, userId) {
    clearTimeout(game.timer);
    const ms = settings().turnSeconds * 1000;
    game.turn = userId;
    game.turnNo++;
    game.turnEndsAt = Date.now() + ms;
    const turnNo = game.turnNo;
    game.timer = setTimeout(() => runExclusive(game, () => timeUp(game, turnNo)), ms);
}

async function timeUp(game, turnNo) {
    if (!getGame(game.id) || game.state !== 'bidding' || game.turnNo !== turnNo) return;
    await endRound(game, { reason: 'timeout', loser: game.turn });
    await editGame(game, render(game));
}

// Someone loses a die: show everyone's dice, then roll again (or end the game when one player is left)
async function endRound(game, { reason, loser, caller = null, count = null }) {
    clearTimeout(game.timer);
    game.reveal = { reason, loser, caller, count, bid: game.bid, rolls: game.rolls };
    game.dice.set(loser, game.dice.get(loser) - 1);
    if (!game.dice.get(loser)) game.out.push({ userId: loser, round: game.round, left: false });
    if (alive(game).length < 2) return finish(game);

    game.state = 'reveal';
    game.starter = loser; // the loser opens the next round (the next player still in, if they're out)
    const ms = (settings().revealSeconds ?? REVEAL_SECONDS) * 1000;
    game.nextAt = Date.now() + ms;
    const round = game.round;
    game.timer = setTimeout(() => runExclusive(game, async () => {
        if (!getGame(game.id) || game.state !== 'reveal' || game.round !== round) return;
        newRound(game);
        await editGame(game, render(game));
    }), ms);
}

async function callLiar(game, userId) {
    const { quantity, face, by } = game.bid;
    const count = countMatches(game.rolls, face);
    await endRound(game, { reason: 'call', caller: userId, count, loser: count >= quantity ? userId : by });
}

// Leaving knocks you out. Mid-round, the dice on the table changed, so everyone rolls again.
async function leave(game, userId) {
    game.dice.set(userId, 0);
    game.out.push({ userId, round: game.round, left: true });
    if (alive(game).length < 2) {
        game.note = `<@${userId}> left the game.`;
        return finish(game);
    }
    if (game.state === 'bidding') {
        game.starter = game.turn === userId ? nextIn(game, userId) : game.turn;
        newRound(game);
        game.note = `<@${userId}> left the game, so everyone rolled again.`;
    } else {
        game.note = `<@${userId}> left the game.`;
    }
}

async function finish(game) {
    clearTimeout(game.timer);
    endGame(game);
    game.state = 'over';
    game.winner = alive(game)[0];
    // Leaving forfeits: only players knocked out by losing their dice count as beaten, so nobody
    // earns a win from opponents who just left (e.g. a second account joining and leaving)
    const beaten = game.out.filter(o => !o.left);
    const runnerUp = beaten.at(-1);
    const awards = beaten.length ? [{ userId: game.winner, amount: winnerReward('liarsDice', beaten.length + 1) }] : [];
    if (game.startingPlayers >= 3 && runnerUp) awards.push({ userId: runnerUp.userId, amount: REWARDS.liarsDice.runnerUp });
    game.rewards = await payEach(awards, { guildId: game.guildId, game: 'Liar\'s Dice' });
}

// ─── Clicks ───────────────────────────────────────────────────
// Why `userId` can't bid or call right now, or null if it's their move
function turnProblem(game, userId) {
    if (!(game.dice.get(userId) > 0)) return 'You\'re out of dice, so you can only watch now.';
    if (game.state !== 'bidding') return 'This round is over. The next one starts in a moment!';
    if (game.turn !== userId) return `It's <@${game.turn}>'s turn.`;
    return null;
}

async function handle(game, interaction, action, arg) {
    if (await handleLobby(game, interaction, action)) return;
    const userId = interaction.user.id;
    if (!game.players.includes(userId)) return notify(interaction, 'You\'re not in this game. Join the next one!');

    switch (action) {
        case 'dice': {
            if (!(game.dice.get(userId) > 0)) return notify(interaction, 'You\'re out of dice, so you can only watch now.');
            touch(game); // the reply is private, so the board keeps its last token
            return interaction.reply({ ...privateView(game, userId), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        }
        case 'bid': {
            const problem = turnProblem(game, userId) ?? (canRaise(game) ? null : `Nobody can bid higher than ${bidText(game.bid)}, so call **Liar!**`);
            if (problem) return notify(interaction, problem);
            touch(game); // a form isn't a board edit, so the board keeps its last token
            return interaction.showModal(bidForm(game));
        }
        case 'submit': {
            // A form opened on an earlier turn (time ran out, or someone left and everyone rerolled) is too late
            const problem = turnProblem(game, userId) ?? (Number(arg) !== game.turnNo ? 'Too late: the table changed since you opened the form.' : null);
            if (problem) return notify(interaction, problem);
            const quantity = Number(interaction.fields.getStringSelectValues('quantity')[0]);
            const face = Number(interaction.fields.getStringSelectValues('face')[0]);
            const invalid = bidProblem(game.bid, quantity, face, diceInPlay(game));
            if (invalid) return notify(interaction, invalid);

            await interaction.deferUpdate();
            touch(game, interaction);
            game.bid = { quantity, face, by: userId };
            game.bids.push(game.bid);
            game.note = null;
            startTurn(game, nextIn(game, userId));
            return editGame(game, render(game));
        }
        case 'liar': {
            const problem = turnProblem(game, userId) ?? (game.bid ? null : 'There\'s no bid to call yet. Open the bidding with **Bid…**');
            if (problem) return notify(interaction, problem);
            await callLiar(game, userId);
            return updateBoard(game, interaction, render(game));
        }
        case 'quit': { // from the private view
            if (!(game.dice.get(userId) > 0)) return notify(interaction, 'You\'re already out of this game.');
            touch(game, interaction);
            await leave(game, userId);
            await interaction.editReply(gamePayload([`### ${TITLE}`, 'You left the game.'], COLOR));
            return editGame(game, render(game));
        }
    }
}

// ─── Drawing ──────────────────────────────────────────────────
function bidForm(game) {
    const total = diceInPlay(game);
    const min = minQuantity(game.bid);
    const quantities = [];
    for (let q = min; q <= Math.min(total, min + MAX_CHOICES - 1); q++) quantities.push({ label: `${q} ${q === 1 ? 'die' : 'dice'}`, value: String(q) });
    const bid = game.bid;
    return new ModalBuilder()
        .setCustomId(`game:${game.id}:submit:${game.turnNo}`)
        .setTitle(bid ? `Round ${game.round} · raise the bid` : `Round ${game.round} · opening bid`)
        .addLabelComponents(
            new LabelBuilder().setLabel('How many dice')
                .setDescription(bid ? `To beat ${bid.quantity} × ${bid.face}s: more dice, or ${bid.quantity} of a higher face` : `Across everyone's dice · ${total} in play`)
                .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('quantity').setMinValues(1).setMaxValues(1).addOptions(quantities)),
            new LabelBuilder().setLabel('Showing')
                .setDescription('Ones are wild: they count as every face')
                .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('face').setMinValues(1).setMaxValues(1).addOptions(
                    [2, 3, 4, 5, 6].map(f => ({ label: FACE_NAMES[f], value: String(f), emoji: FACES[f] })))),
        );
}

function privateView(game, userId) {
    const status = game.state === 'bidding'
        ? `${game.bid ? `Current bid: ${bidText(game.bid)} by <@${game.bid.by}>` : 'No bids yet'} · <@${game.turn}>'s turn`
        : 'This round is over. New dice next round!';
    return gamePayload([
        `### 🎲 Your dice · round ${game.round}`,
        `## ${showDice(game.rolls.get(userId))}`,
        `${status}\n-# Ones are wild · ${diceInPlay(game)} dice in play · this view doesn't update, so press **My dice** again next round`,
        row(button(`game:${game.id}:quit`, 'Leave game', ButtonStyle.Danger)),
    ], COLOR);
}

function playerLines(game) {
    return game.players.map(id => {
        const dice = game.dice.get(id);
        if (!dice) return `💀 ~~<@${id}>~~ · ${game.out.find(o => o.userId === id)?.left ? 'left' : 'out'}`;
        return `${game.state === 'bidding' && id === game.turn ? '▶️' : '◽'} <@${id}> · ${'🎲'.repeat(dice)}`;
    }).join('\n');
}

function revealText(game) {
    const r = game.reveal;
    const call = r.reason === 'call';
    const lines = [call
        ? `📣 <@${r.caller}> called **Liar!** on <@${r.bid.by}>'s ${bidText(r.bid)}`
        : `⌛ <@${r.loser}> ran out of time.`];
    for (const [id, rolls] of r.rolls) {
        lines.push(`<@${id}> · ${showDice(rolls)}${call ? ` · **${matches(rolls, r.bid.face)}**` : ''}`);
    }
    if (call) {
        lines.push(`**${r.count}** counted (${FACES[r.bid.face]} and ${FACES[1]}): ${r.count >= r.bid.quantity ? 'the bid was good!' : 'it was a bluff!'} <@${r.loser}> loses a die.`);
    } else {
        lines.push(`<@${r.loser}> loses a die.`);
    }
    if (!game.dice.get(r.loser)) lines.push(`💀 <@${r.loser}> is out!`);
    return lines.join('\n');
}

function renderFinal(game) {
    const coins = (id) => (game.rewards?.get(id) ? ` · ${game.rewards.get(id)}` : '');
    // Knocked out last places highest; leaving forfeits, so leavers place below everyone knocked out
    const order = [...game.out.filter(o => !o.left).reverse(), ...game.out.filter(o => o.left).reverse()];
    const lines = [
        `🏆 <@${game.winner}> · ${'🎲'.repeat(game.dice.get(game.winner))} left${coins(game.winner)}`,
        ...order.map((o, i) => `${['🥈', '🥉'][i] ?? `**${i + 2}.**`} <@${o.userId}> · ${o.left ? 'left' : 'out'} in round ${o.round}${coins(o.userId)}`),
    ];
    return gamePayload([
        `## ${TITLE} · <@${game.winner}> wins!`,
        game.reveal ? revealText(game) : null,
        game.note ? `-# ${game.note}` : null,
        lines.join('\n'),
    ], COLOR);
}

function render(game) {
    if (game.state === 'over') return renderFinal(game);
    const bidding = game.state === 'bidding';
    const parts = [
        `## ${TITLE} · Round ${game.round}`,
        playerLines(game),
        `-# ${diceInPlay(game)} dice in play · ones are wild · bids are on 2️⃣ to 6️⃣`,
    ];
    if (bidding) {
        const bid = game.bid;
        const earlier = game.bids.slice(-4, -1).map(b => `<@${b.by}> ${b.quantity} × ${FACES[b.face]}`);
        parts.push(`${bid ? `Current bid: ${bidText(bid)} by <@${bid.by}>` : 'No bids yet.'}${earlier.length ? `\n-# Before that: ${earlier.join(' · ')}` : ''}`);
        const ask = !bid ? 'make the opening bid' : canRaise(game) ? 'raise the bid or call **Liar!**' : 'nobody can bid higher, so call **Liar!**';
        parts.push(`<@${game.turn}>, ${ask} · time's up ${at(game.turnEndsAt)}`);
    } else {
        parts.push(revealText(game));
        parts.push(`-# Next round ${at(game.nextAt)}`);
    }
    if (game.note) parts.push(`-# ${game.note}`);
    parts.push(row(
        button(`game:${game.id}:dice`, 'My dice', ButtonStyle.Secondary, { emoji: '🎲' }),
        button(`game:${game.id}:bid`, 'Bid…', ButtonStyle.Primary, { disabled: !bidding || !canRaise(game) }),
        button(`game:${game.id}:liar`, 'Liar!', ButtonStyle.Danger, { disabled: !bidding || !game.bid }),
    ));
    return gamePayload(parts, COLOR);
}

/** Opens the lobby (from the /games menu) */
function start(interaction) {
    const { minPlayers, maxPlayers, dice, turnSeconds } = settings();
    return openLobby(interaction, 'liarsDice', {
        title: TITLE,
        color: COLOR,
        minPlayers,
        maxPlayers,
        rules: `Everyone rolls ${dice} dice in secret. Take turns bidding how many of a face are on the whole table ` +
            '(**ones are wild**), each bid higher than the last, or call **Liar!** on the last bid. ' +
            'Whoever was wrong loses a die. The last one with dice wins.' +
            `\n-# ${turnSeconds}s per turn · running out of time costs a die`,
    }, { begin, render });
}

// `bid` opens a form and `dice` replies privately, so those two must answer first instead of being deferred
const deferActions = new Set([...LOBBY_ACTIONS, 'liar', 'quit']);

module.exports = { start, handle, render, deferActions, TITLE, roller, bidProblem, countMatches };
