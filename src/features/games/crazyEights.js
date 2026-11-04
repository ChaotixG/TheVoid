// Crazy Eights: match the top card's color or number, or play a wild and choose the color.
// ⏭️ Skip, 🔁 Reverse, +2 and 🌈+4 hit the next player. Cards are private: "My hand" opens a view
// only you can see (it keeps itself up to date), and you play from there. First to empty their
// hand wins. Public text never names a card in anyone's hand, only cards as they're played.
//
// Cards are short codes so they fit in custom IDs: a color letter and a value ("r7", "bs" blue
// Skip, "gr" green Reverse, "yd" yellow +2), or "w" / "w4" for the wilds.
const { randomInt } = require('crypto');
const { StringSelectMenuBuilder } = require('discord.js');
const { PARTY, REWARDS } = require('../../config/games');
const { row, button, ButtonStyle } = require('../../utils/panels');
const { getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, editGame, notify } = require('./common');
const { openLobby, handleLobby, LOBBY_ACTIONS } = require('./lobby');
const { winnerReward } = require('./scoring');
const { payEach } = require('./rewards');
const { openView, trackView, refreshViews, dropView } = require('./privateViews');
const { announceTurn } = require('./turns');
const { recordGame } = require('./stats');

const TITLE = '🎴 Crazy Eights';
const COLOR = 0xE67E22;
const MISSED_TURNS_OUT = 3;  // running out of time this many turns in a row takes a player out
const MAX_CARD_BUTTONS = 20; // four rows of five, leaving a row for Draw/Pass
const LOG_LINES = 3;
const settings = () => PARTY.crazyEights; // read when used, so tests can shorten the timers

const COLORS = {
    r: { emoji: '🟥', name: 'Red', style: ButtonStyle.Danger },
    b: { emoji: '🟦', name: 'Blue', style: ButtonStyle.Primary },
    g: { emoji: '🟩', name: 'Green', style: ButtonStyle.Success },
    y: { emoji: '🟨', name: 'Yellow', style: ButtonStyle.Secondary },
};
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 's', 'r', 'd', 'w', 'w4']; // also the order of a sorted hand
const SYMBOLS = { s: '⏭️', r: '🔁', d: '+2', w: '🌈', w4: '🌈+4' };
const NAMES = { s: 'Skip', r: 'Reverse', d: '+2', w: 'Wild', w4: 'Wild +4' };

const at = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const cardCount = (n) => (n === 1 ? '1 card' : `${n} cards`);

// ─── Cards ────────────────────────────────────────────────────
const colorOf = (card) => (COLORS[card[0]] ? card[0] : null); // null for wilds
const valueOf = (card) => (colorOf(card) ? card.slice(1) : card);
const isWild = (card) => !colorOf(card);
const isNumber = (card) => /^\d$/.test(valueOf(card));
const symbol = (card) => SYMBOLS[valueOf(card)] ?? valueOf(card);
const show = (card) => (isWild(card) ? symbol(card) : COLORS[colorOf(card)].emoji + symbol(card));
const rank = (card) => 'rbgyw'.indexOf(colorOf(card) ?? 'w') * VALUES.length + VALUES.indexOf(valueOf(card));
const sorted = (hand) => [...hand].sort((a, b) => rank(a) - rank(b));

/** The 108 cards: per color one 0 and two each of 1–9, Skip, Reverse and +2; plus 4 Wild and 4 Wild +4 */
function newDeck() {
    const deck = [];
    for (const c of Object.keys(COLORS)) {
        deck.push(`${c}0`);
        for (const v of [...'123456789', 's', 'r', 'd']) deck.push(`${c}${v}`, `${c}${v}`);
    }
    for (let i = 0; i < 4; i++) deck.push('w', 'w4');
    return deck;
}

/** A shuffled copy (Fisher–Yates). `random(n)` picks 0…n-1; crypto by default, tests can pass their own. */
function shuffle(cards, random = randomInt) {
    const out = [...cards];
    for (let i = out.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** Whether `card` can go on the pile now: same color, same number or symbol, or a wild */
const canPlay = (game, card) => isWild(card) || colorOf(card) === game.color || valueOf(card) === valueOf(game.pile.at(-1));

// Draws up to n cards (the deck is drawn from its end). When it runs out, the pile except its top
// card is shuffled into a new deck; with every other card in someone's hand, fewer are drawn.
function give(game, userId, n) {
    const drawn = [];
    while (drawn.length < n) {
        if (!game.deck.length) {
            if (game.pile.length < 2) break;
            const top = game.pile.pop();
            game.deck = shuffle(game.pile);
            game.pile = [top];
            addLog(game, '♻️ The pile was shuffled into a new deck');
        }
        drawn.push(game.deck.pop());
    }
    game.hands.get(userId).push(...drawn);
    return drawn;
}

function addLog(game, line) {
    game.log.push(line);
    if (game.log.length > LOG_LINES) game.log.shift();
}

// ─── Turns ────────────────────────────────────────────────────
const current = (game) => game.players[game.turn];

function seatAfter(game, steps = 1) {
    const n = game.players.length;
    return (((game.turn + game.direction * steps) % n) + n) % n;
}

// Starts the turn of whoever sits at `seat`, with a fresh timer
function startTurn(game, seat) {
    clearTimeout(game.timer);
    game.turn = seat;
    game.drawn = null; // the card drawn this turn, while it may still be played
    const turnId = ++game.turnId;
    const { turnSeconds } = settings();
    game.turnEndsAt = Date.now() + turnSeconds * 1000;
    game.timer = setTimeout(() => runExclusive(game, () => timeUp(game, turnId)), turnSeconds * 1000);
    announceTurn(game, game.players[seat]);
}

const advance = (game, steps = 1) => startTurn(game, seatAfter(game, steps));

// Plays a card from the current player's hand (a wild as `color`) and does what it says
function playCard(game, card, color) {
    const userId = current(game);
    const hand = game.hands.get(userId);
    hand.splice(hand.indexOf(card), 1);
    game.pile.push(card);
    game.color = isWild(card) ? color : colorOf(card);
    let line = `<@${userId}> played ${show(card)}${isWild(card) ? ` · color ${COLORS[color].emoji}` : ''}`;
    if (!hand.length) {
        addLog(game, line);
        return declareWinner(game, userId);
    }

    const value = valueOf(card);
    const next = game.players[seatAfter(game)];
    let steps = 1;
    if (value === 's') {
        line += ` · <@${next}> is skipped`;
        steps = 2;
    } else if (value === 'r') {
        game.direction = -game.direction;
        // With two players a reverse comes straight back, so it works like a skip
        if (game.players.length === 2) {
            line += ` · <@${next}> is skipped`;
            steps = 2;
        } else {
            line += ' · order reversed';
        }
    } else if (value === 'd' || value === 'w4') {
        const drawn = give(game, next, value === 'd' ? 2 : 4);
        line += ` · <@${next}> draws ${drawn.length} and is skipped`;
        steps = 2;
    }
    addLog(game, line);
    advance(game, steps);
}

// Takes a player out (they left, or kept running out of time). Their cards go to the bottom of the deck.
function removePlayer(game, userId, reason) {
    const seat = game.players.indexOf(userId);
    const wasTheirTurn = seat === game.turn;
    game.players.splice(seat, 1);
    game.deck.unshift(...game.hands.get(userId));
    game.hands.delete(userId);
    game.out.set(userId, reason);
    if (game.players.length === 1) return declareWinner(game, game.players[0]);

    if (seat < game.turn) game.turn--; // same player's turn, one seat down
    else if (wasTheirTurn) {
        // The next player in the current direction takes over
        const n = game.players.length;
        startTurn(game, game.direction === 1 ? seat % n : (seat - 1 + n) % n);
    }
}

// A turn ran out: draw a card and pass (or just pass, if they already drew). Missing too many turns
// in a row takes the player out, so one person who walked away can't hold everyone up.
async function timeUp(game, turnId) {
    if (!getGame(game.id) || game.state !== 'playing' || game.turnId !== turnId) return;
    const userId = current(game);
    const missed = (game.timeouts.get(userId) ?? 0) + 1;
    game.timeouts.set(userId, missed);
    if (missed >= MISSED_TURNS_OUT) {
        addLog(game, `⌛ <@${userId}> ran out of time ${MISSED_TURNS_OUT} turns in a row and is out`);
        removePlayer(game, userId, 'timed out');
        await afterMove(game); // their open hand says they're out…
        return dropView(game, userId); // …and then stops updating
    }
    if (game.drawn) {
        addLog(game, `⌛ <@${userId}> ran out of time and passed`);
        advance(game);
    } else {
        give(game, userId, 1);
        addLog(game, `⌛ <@${userId}> ran out of time and drew a card`);
        advance(game);
    }
    await afterMove(game);
}

function declareWinner(game, userId) {
    endGame(game);
    game.state = 'over';
    game.winner = userId;
}

// The winner's coins grow with the number of players they beat: those still in at the end. Players
// who left or were removed don't count, so nobody earns a win from opponents who just left (e.g. a
// second account joining and leaving). With 3 or more starters, whoever is left holding the fewest
// cards gets the runner-up prize (everyone tied for it, on a tie).
async function payOut(game) {
    const others = game.players.filter(id => id !== game.winner);
    const awards = others.length ? [{ userId: game.winner, amount: winnerReward('crazyEights', others.length + 1) }] : [];
    if (game.started.length >= 3 && others.length) {
        const fewest = Math.min(...others.map(id => game.hands.get(id).length));
        for (const id of others) {
            if (game.hands.get(id).length === fewest) awards.push({ userId: id, amount: REWARDS.crazyEights.runnerUp });
        }
    }
    game.rewards = await payEach(awards, { guildId: game.guildId, game: 'Crazy Eights' });
}

// After a move: settle up if it ended the game, then show it on the game message and in everyone's
// open hand. `except` is the player whose view their own click just updated; at the end every open
// view is redrawn, so the winner's shows their coins too.
async function afterMove(game, { except = null } = {}) {
    if (game.state === 'over') {
        await payOut(game);
        // Everyone who started counts as having played, so leaving a lost game doesn't hide the loss
        await recordGame({ id: game.id, type: game.type, players: game.started }, { winners: [game.winner] });
    }
    await editGame(game, render(game));
    await refreshViews(game, handView, { except: game.state === 'over' ? null : except });
}

function begin(game) {
    const { handSize } = settings();
    game.started = [...game.players];
    game.deck = shuffle(newDeck());
    game.hands = new Map(game.players.map(id => [id, []]));
    for (let i = 0; i < handSize; i++) {
        for (const id of game.players) game.hands.get(id).push(game.deck.pop());
    }
    // The pile starts with a number, so nobody is hit by an action card before the first turn
    game.pile = game.deck.splice(game.deck.findLastIndex(isNumber), 1);
    game.color = colorOf(game.pile[0]);
    game.direction = 1;
    game.turnId = 0;
    game.timeouts = new Map(); // userId → turns run out of in a row
    game.out = new Map();      // userId → 'left' or 'timed out'
    game.log = [];
    game.onExpire = () => {
        game.state = 'over';
        game.expired = true;
        refreshViews(game, handView); // open hands say so too (not awaited: this returns the board)
        return render(game);
    };
    startTurn(game, 0); // the host goes first
}

// ─── Clicks ───────────────────────────────────────────────────
async function handle(game, interaction, action, arg) {
    if (await handleLobby(game, interaction, action)) return;
    const userId = interaction.user.id;

    // Lobby buttons clicked after the game began (already acknowledged)
    if (LOBBY_ACTIONS.includes(action)) {
        if (action === 'join') return notify(interaction, 'This game has already started. Catch the next one!');
        if (action === 'leave') return notify(interaction, 'To leave, open **🎴 My hand** and press **Leave**.');
        return;
    }

    if (action === 'hand') {
        if (!game.players.includes(userId)) return notify(interaction, outLine(game, userId));
        return openView(game, interaction, handView(game, userId));
    }

    // Everything else comes from someone's private view of their hand. Views update themselves,
    // but a click can still race a move, so each one is checked against the game as it is now.
    if (!game.players.includes(userId)) return interaction.update(closedView(outLine(game, userId)));
    touch(game, interaction);
    if (action !== 'quit') pendingOf(game).delete(userId); // any other click moves on from a question
    // Answers in the private view, and keeps that view updating as the game moves on
    const answer = async (payload) => {
        await interaction.update(payload);
        trackView(game, interaction);
    };
    const refresh = (note) => answer(handView(game, userId, { note }));

    if (action === 'view') return refresh();
    if (action === 'quit') {
        pendingOf(game).set(userId, { quit: true });
        return answer(quitView(game));
    }
    if (action === 'quitYes') {
        addLog(game, `🚪 <@${userId}> left the game`);
        removePlayer(game, userId, 'left');
        await interaction.update(closedView('You left the game. Your cards went back into the deck.'));
        dropView(game, userId);
        return afterMove(game, { except: userId });
    }
    if (!['play', 'color', 'draw', 'pass'].includes(action)) return interaction.deferUpdate();
    if (current(game) !== userId) return refresh(`It's <@${current(game)}>'s turn, not yours.`);

    let note;
    if (action === 'draw') {
        if (game.drawn) return refresh(`You already drew ${show(game.drawn)}. Play it or pass.`);
        const [card] = give(game, userId, 1);
        if (card && canPlay(game, card)) {
            game.drawn = card;
            addLog(game, `<@${userId}> drew a card`);
            note = `You drew ${show(card)}. Play it or pass.`;
        } else {
            addLog(game, card ? `<@${userId}> drew a card and passed` : `<@${userId}> passed (no cards left to draw)`);
            note = card ? `You drew ${show(card)}. It doesn't match, so your turn passes.` : 'There are no cards left to draw, so your turn passes.';
            advance(game);
        }
    } else if (action === 'pass') {
        if (!game.drawn) return refresh('Draw a card first. You can pass after drawing.');
        addLog(game, `<@${userId}> passed`);
        note = 'You passed.';
        advance(game);
    } else {
        const card = arg;
        const problem = playProblem(game, userId, card);
        if (problem) return refresh(problem);
        const color = action === 'color' ? interaction.values?.[0] : null;
        // A wild is played once its color is chosen
        if (isWild(card) && !COLORS[color]) {
            pendingOf(game).set(userId, { choosing: card });
            return answer(handView(game, userId, { choosing: card }));
        }
        playCard(game, card, color);
        note = game.state === 'over' ? '🏆 You played your last card and won!' : `You played ${show(card)}.`;
    }
    game.timeouts.set(userId, 0); // they're here, so missed turns count from zero again
    await refresh(note);
    return afterMove(game, { except: userId });
}

// Why the current player can't play `card` right now, or null if they can
function playProblem(game, userId, card) {
    if (!game.hands.get(userId).includes(card)) return 'You don\'t have that card anymore.';
    if (game.drawn && card !== game.drawn) return `After drawing, only the card you drew (${show(game.drawn)}) can be played. Play it or pass.`;
    if (!canPlay(game, card)) {
        const top = game.pile.at(-1);
        return `${show(card)} doesn't match. Play a ${COLORS[game.color].emoji} card${isWild(top) ? '' : ` or a ${symbol(top)}`}, or a wild.`;
    }
    return null;
}

// ─── Private views ────────────────────────────────────────────
function cardButton(game, card) {
    const color = COLORS[colorOf(card)];
    return button(`game:${game.id}:play:${card}`, NAMES[valueOf(card)] ?? valueOf(card), color?.style ?? ButtonStyle.Secondary, { emoji: color?.emoji ?? '🌈' });
}

// Why someone can't open or use a hand in this game
function outLine(game, userId) {
    const reason = game.out.get(userId);
    if (reason === 'timed out') return `You ran out of time ${MISSED_TURNS_OUT} turns in a row, so you're out of this game.`;
    return reason ? 'You\'re out of this game.' : 'You\'re not in this game. Join the next one!';
}

// What someone's view is in the middle of (the Leave question, or a wild waiting for its color),
// so the refresh after another player's move shows that instead of throwing it away
const pendingOf = (game) => (game.pending ??= new Map()); // userId → { quit } or { choosing: card }

/** Someone's private view of their hand. `choosing` is a wild waiting for its color. */
function handView(game, userId, { note = null, choosing = null } = {}) {
    if (!game.players.includes(userId)) return closedView(outLine(game, userId));
    const pending = game.pending?.get(userId);
    if (game.state !== 'over' && pending?.quit) return quitView(game);
    // A wild still waiting for its color, while it's still their turn and their card
    if (!choosing && pending?.choosing && current(game) === userId && game.hands.get(userId).includes(pending.choosing)) {
        choosing = pending.choosing;
    }
    const hand = sorted(game.hands.get(userId));
    const parts = [`### 🎴 Your hand · ${cardCount(hand.length)}`, note];
    if (game.state === 'over') {
        const coins = game.rewards?.get(userId);
        let result;
        if (game.expired) result = '⌛ The game ended: no moves for 10 minutes.';
        else if (game.winner === userId) result = '🏆 **You won!**';
        else result = `The game is over · <@${game.winner}> won.`;
        parts.push(`${result}${coins ? ` · ${coins}` : ''}`);
        return gamePayload(parts, COLOR);
    }

    const myTurn = current(game) === userId;
    const color = COLORS[game.color];
    parts.push(`${myTurn ? `**Your turn!** · auto-draw ${at(game.turnEndsAt)}` : `<@${current(game)}>'s turn`}\n` +
        `-# Top card ${show(game.pile.at(-1))} · color ${color.emoji} ${color.name}`);
    parts.push(hand.map(show).join(' ') || '-# No cards');

    if (choosing) {
        parts.push(
            `Choose a color for ${show(choosing)}:`,
            row(new StringSelectMenuBuilder()
                .setCustomId(`game:${game.id}:color:${choosing}`)
                .setPlaceholder('Choose a color…')
                .addOptions(Object.entries(COLORS).map(([value, c]) => ({ label: c.name, value, emoji: c.emoji })))),
            row(button(`game:${game.id}:view`, 'Back', ButtonStyle.Secondary)),
        );
        return gamePayload(parts, COLOR);
    }

    // One button per kind of card that can be played now (after drawing, only the drawn card)
    const playable = myTurn ? [...new Set(hand)].filter(c => (!game.drawn || c === game.drawn) && canPlay(game, c)) : [];
    if (myTurn && !playable.length) parts.push('-# Nothing matches · press **Draw**.');
    const shown = playable.slice(0, MAX_CARD_BUTTONS);
    for (let i = 0; i < shown.length; i += 5) parts.push(row(...shown.slice(i, i + 5).map(c => cardButton(game, c))));
    parts.push(row(
        button(`game:${game.id}:draw`, 'Draw', ButtonStyle.Secondary, { emoji: '🃏', disabled: !myTurn || Boolean(game.drawn) }),
        button(`game:${game.id}:pass`, 'Pass', ButtonStyle.Secondary, { emoji: '⏩', disabled: !myTurn || !game.drawn }),
        button(`game:${game.id}:view`, 'Refresh', ButtonStyle.Secondary, { emoji: '🔄' }),
        button(`game:${game.id}:quit`, 'Leave', ButtonStyle.Danger),
    ));
    return gamePayload(parts, COLOR);
}

const closedView = (line) => gamePayload([`### ${TITLE}`, line], COLOR);

const quitView = (game) => gamePayload([
    '### 🚪 Leave the game?',
    'Your cards go back into the deck, and you can\'t rejoin this game.',
    row(
        button(`game:${game.id}:quitYes`, 'Leave game', ButtonStyle.Danger),
        button(`game:${game.id}:view`, 'Stay', ButtonStyle.Secondary),
    ),
], COLOR);

// ─── Game message ─────────────────────────────────────────────
const logText = (game) => (game.log.length ? game.log.map(line => `-# ${line}`).join('\n') : null);

function render(game) {
    if (game.state === 'over') return renderOver(game);
    const color = COLORS[game.color];
    const seats = game.players.map((id, seat) => {
        const n = game.hands.get(id).length;
        return `${seat === game.turn ? '▶️' : '▫️'} <@${id}> · ${n === 1 ? '**1 card!**' : cardCount(n)}`;
    });
    const out = [...game.out].map(([id, reason]) => `<@${id}> ${reason}`).join(' · ');
    return gamePayload([
        `## ${TITLE}`,
        `**Top card** ${show(game.pile.at(-1))} · **Color** ${color.emoji} ${color.name}\n` +
            `<@${current(game)}>'s turn · auto-draw ${at(game.turnEndsAt)}`,
        `**Players** · play goes ${game.direction === 1 ? '⬇️' : '⬆️'}\n${seats.join('\n')}${out ? `\n-# Out: ${out}` : ''}`,
        logText(game),
        row(button(`game:${game.id}:hand`, 'My hand', ButtonStyle.Primary, { emoji: '🎴' })),
    ], COLOR);
}

function renderOver(game) {
    const left = (id) => game.hands.get(id).length;
    const ranked = [...game.players].sort((a, b) => (b === game.winner) - (a === game.winner) || left(a) - left(b));
    const coins = (id) => (game.rewards?.get(id) ? ` · ${game.rewards.get(id)}` : '');
    const lines = [
        ...ranked.map(id => `${id === game.winner ? '🏆' : '▫️'} <@${id}> · ${cardCount(left(id))}${coins(id)}`),
        ...[...game.out].map(([id, reason]) => `🚪 <@${id}> · ${reason}`),
    ];
    let headline;
    if (game.expired) headline = '⌛ Game ended: no moves for 10 minutes.';
    else if (!left(game.winner)) headline = `🏆 <@${game.winner}> played their last card and wins!`;
    else headline = `🏆 <@${game.winner}> is the last player left and wins!`;
    return gamePayload([
        `## ${TITLE} · Game over`,
        headline,
        `**Cards left**\n${lines.join('\n')}`,
        logText(game),
    ], COLOR);
}

/** Opens the lobby (from the /games menu) */
function start(interaction) {
    const { minPlayers, maxPlayers, handSize, turnSeconds } = settings();
    return openLobby(interaction, 'crazyEights', {
        title: TITLE,
        color: COLOR,
        minPlayers,
        maxPlayers,
        rules: 'Play a card that matches the top card\'s color or number, or a 🌈 wild and choose the color. ' +
            '⏭️ Skip, 🔁 Reverse and +2 hit the next player, and 🌈+4 makes them draw 4. Can\'t play? Draw a card. ' +
            'First to play every card wins!\n' +
            `-# ${handSize} cards each · ${turnSeconds}s per turn · your cards are private: press **🎴 My hand** to play`,
    }, { begin, render });
}

// Lobby clicks and My hand (answered with a private follow-up) are acknowledged before waiting in
// line; clicks inside a private view are answered right away by updating that view
const deferActions = new Set([...LOBBY_ACTIONS, 'hand']);

module.exports = { start, handle, render, deferActions, TITLE, newDeck, shuffle, canPlay, show };
