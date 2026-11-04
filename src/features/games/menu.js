// /games: one menu for every game. It's posted in the channel and only its opener can use it.
// Starting a game turns the menu message into the game (or into a party game's lobby).
// Stateless like other panels: the chosen game and options travel in the custom IDs
// ("games:<action>:<ownerId>:<gameId>:..."), so the menu keeps working after a restart.
const { StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const gameConfig = require('../../config/games');
const { DAILY_CAP, REWARDS, PARTY, HANGMAN, WORDLE } = gameConfig;
const { container, separator, row, section, button, panelPayload, ButtonStyle } = require('../../utils/panels');
const { ephemeral } = require('../../utils/interactionReplies');
const { hangmanReward, minesweeperReward, connect4Reward } = require('./scoring');
const { gameCoinsToday } = require('./rewards');
const { games } = require('./sessions');
const { BOT } = require('./common');
const { GAMES } = require('./index');

const COLOR = 0x5865F2;
const CATEGORIES = { solo: { name: 'Solo', emoji: '🎯' }, versus: { name: 'Versus', emoji: '⚔️' }, party: { name: 'Party', emoji: '🎉' } };

const DIFFICULTY = { key: 'difficulty', choices: [['any', 'Any difficulty'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] };
const players = (type) => `${PARTY[type].minPlayers}–${PARTY[type].maxPlayers} players`;
const winnerCoins = (r) => `${r.winner} for the winner, +${r.perOpponent} per opponent`;

// Every game in the menu, listed under its category's tab. `options` are choices made before
// starting (first choice is the default); `opponent` adds a "who to play" picker (empty = me).
// Games with either get Set up (choices, then Start); the rest start in one click. Coin amounts
// come from config/games.js.
const CATALOG = [
    {
        id: 'wordle', name: 'Wordle', emoji: '🟩', category: 'solo',
        short: 'Guess the five-letter word',
        about: `Guess the five-letter word in ${WORDLE.guesses} tries. Colors show which letters are right.`,
        coins: `up to ${REWARDS.wordle.firstGuess} (fewer guesses pay more)`,
    },
    {
        id: 'hangman', name: 'Hangman', emoji: '🪢', category: 'solo',
        short: 'Guess the word letter by letter',
        about: `Guess the word one letter at a time before your ${HANGMAN.lives} lives run out.`,
        coins: `${hangmanReward(1)}–${hangmanReward(HANGMAN.lives)} (more lives left pays more)`,
    },
    {
        id: 'minesweeper', name: 'Minesweeper', emoji: '💣', category: 'solo',
        short: 'Clear the board without hitting a mine',
        about: 'Reveal every safe square without hitting a mine. Numbers count the mines next to a square.',
        coins: `${minesweeperReward(Infinity)}–${minesweeperReward(0)} (faster pays more)`,
    },
    {
        id: 'memory', name: 'Memory', emoji: '🃏', category: 'solo',
        short: 'Find every matching pair',
        about: 'Flip two cards at a time and find every pair in as few moves as you can.',
        coins: `${REWARDS.memory.minimum}–${REWARDS.memory.perfect} (fewer moves pay more)`,
    },
    {
        id: 'trivia', name: 'Trivia', emoji: '🧠', category: 'solo',
        short: 'Multiple-choice questions, solo or a race',
        about: 'Multiple-choice questions. **Solo**: only you answer. **Race**: anyone in the channel can answer, and the first right answer wins.',
        coins: `${REWARDS.trivia.easy}–${REWARDS.trivia.hard} per right answer, plus a bonus for answers in a row`,
        options: [{ key: 'mode', choices: [['solo', 'Solo'], ['race', 'Race: anyone can answer']] }, DIFFICULTY],
    },
    {
        id: 'tictactoe', name: 'Tic-tac-toe', emoji: '❌', category: 'versus',
        short: 'Three in a row, against me or someone',
        about: 'Get three in a row. Play against me, or challenge someone.',
        coins: `${REWARDS.tictactoe.vsPlayer} for beating a person, ${REWARDS.tictactoe.vsBot} for beating me`,
        opponent: true,
    },
    {
        id: 'connect4', name: 'Connect Four', emoji: '🔴', category: 'versus',
        short: 'Four in a row, against me or someone',
        about: 'Drop pieces into the columns to get four in a row. Play against me, or challenge someone.',
        coins: `${connect4Reward(21, false)}–${connect4Reward(4, false)} against a person (quicker wins pay more), less against me`,
        opponent: true,
    },
    {
        id: 'triviaParty', name: 'Trivia Party', emoji: '🎉', category: 'party',
        short: 'Everyone answers the same questions',
        about: `Everyone answers the same ${PARTY.triviaParty.questions} questions at once, privately. Right and fast answers score the most.`,
        players: players('triviaParty'),
        coins: `${REWARDS.triviaParty.perCorrect}–${REWARDS.triviaParty.perCorrect + REWARDS.triviaParty.speedBonus} per right answer, +${REWARDS.triviaParty.winnerBonus} for the winner`,
        options: [DIFFICULTY],
    },
    {
        id: 'crazyEights', name: 'Crazy Eights', emoji: '🎴', category: 'party',
        short: 'Match color or number; first to empty their hand wins',
        about: 'Play a card that matches the color or number on top of the pile. Skips, reverses, +2s and wilds keep it wild. First to play every card wins.',
        players: players('crazyEights'),
        coins: `${winnerCoins(REWARDS.crazyEights)}, ${REWARDS.crazyEights.runnerUp} for second`,
    },
    {
        id: 'liarsDice', name: 'Liar\'s Dice', emoji: '🎲', category: 'party',
        short: 'Bid on everyone\'s hidden dice, or call liar',
        about: 'Everyone rolls in secret. Bid how many of a face are on the table, raise, or call "liar". Lose a die when you\'re wrong; the last with dice wins.',
        players: players('liarsDice'),
        coins: `${winnerCoins(REWARDS.liarsDice)}, ${REWARDS.liarsDice.runnerUp} for second`,
    },
    {
        id: 'wordChain', name: 'Word Chain', emoji: '🔗', category: 'party',
        short: 'Words starting with the last letter',
        about: 'Take turns typing a real word in chat that starts with the last letter of the previous word. Run out of time and you\'re out.',
        players: players('wordChain'),
        coins: `${REWARDS.wordChain.perWord} per word, ${winnerCoins(REWARDS.wordChain)}`,
    },
    {
        id: 'scramble', name: 'Scramble', emoji: '🔤', category: 'party',
        short: 'Unscramble the word first, in chat',
        about: `I post a scrambled word; the first player to type the answer in chat scores. ${PARTY.scramble.rounds} rounds.`,
        players: players('scramble'),
        coins: `${REWARDS.scramble.perWord} per word, +${REWARDS.scramble.winnerBonus} for the winner`,
    },
    {
        id: 'higherLower', name: 'Higher or Lower', emoji: '🔼', category: 'party',
        short: 'Guess if the next number is higher or lower',
        about: 'Everyone guesses whether the next number is higher or lower. Guess wrong and you\'re out; the last one standing wins.',
        players: players('higherLower'),
        coins: `${REWARDS.higherLower.perRound} per round survived, ${winnerCoins(REWARDS.higherLower)}`,
    },
];

// ─── Choices ↔ custom IDs ────────────────────────────────────
// Option values (and the opponent) in a fixed order, joined with "."
function defaults(entry) {
    const values = Object.fromEntries((entry.options ?? []).map(o => [o.key, o.choices[0][0]]));
    if (entry.opponent) values.opponentId = BOT;
    return values;
}

function encode(entry, values) {
    if (!entry) return '';
    return [...(entry.options ?? []).map(o => values[o.key]), ...(entry.opponent ? [values.opponentId] : [])].join('.');
}

function decode(entry, text = '') {
    const values = defaults(entry);
    const parts = text.split('.');
    (entry.options ?? []).forEach((o, i) => {
        if (o.choices.some(([value]) => value === parts[i])) values[o.key] = parts[i];
    });
    if (entry.opponent && /^(\d{17,20}|bot)$/.test(parts[entry.options?.length ?? 0] ?? '')) values.opponentId = parts[entry.options?.length ?? 0];
    return values;
}

// ─── Drawing ──────────────────────────────────────────────────
const hasChoices = (entry) => Boolean(entry.options || entry.opponent);

// One game in a tab: what it is and what it pays, with Play (or Set up) beside it
function gameSection(ownerId, entry) {
    return section(
        `**${entry.emoji} ${entry.name}**${entry.players ? ` · ${entry.players}` : ''}\n${entry.short}\n-# Coins: ${entry.coins}`,
        hasChoices(entry)
            ? button(`games:setup:${ownerId}:${entry.id}`, 'Set up', ButtonStyle.Primary, { emoji: '⚙️' })
            : button(`games:play:${ownerId}:${entry.id}`, 'Play', ButtonStyle.Success, { emoji: '▶️' }),
    );
}

// A game's choices (options, opponent) and its Start button
function setupView(ownerId, entry, chosen) {
    const state = encode(entry, chosen);
    const parts = [
        `### ${entry.emoji} ${entry.name}\n${entry.about}` +
        (entry.opponent ? `\n**Opponent:** ${chosen.opponentId === BOT ? 'me 🤖' : `<@${chosen.opponentId}>`}` : '') +
        `\n-# ${entry.players ? `${entry.players} · ` : ''}Coins: ${entry.coins}`,
    ];
    (entry.options ?? []).forEach((option, i) => parts.push(row(new StringSelectMenuBuilder()
        .setCustomId(`games:opt:${ownerId}:${entry.id}:${i}:${state}`)
        .addOptions(option.choices.map(([value, label]) => ({ label, value, default: value === chosen[option.key] }))))));
    if (entry.opponent) {
        const picker = new UserSelectMenuBuilder()
            .setCustomId(`games:opp:${ownerId}:${entry.id}:${state}`)
            .setPlaceholder('Play against me, or pick someone to challenge…')
            .setMinValues(0)
            .setMaxValues(1);
        if (chosen.opponentId !== BOT) picker.setDefaultUsers(chosen.opponentId);
        parts.push(row(picker));
    }
    parts.push(row(
        button(`games:start:${ownerId}:${entry.id}:${state}`, entry.category === 'party' ? 'Open lobby' : 'Start', ButtonStyle.Success, { emoji: '▶️' }),
        button(`games:back:${ownerId}:${entry.category}`, 'Back', ButtonStyle.Secondary, { emoji: '◀️' }),
    ));
    return parts;
}

/**
 * The menu: a tab of games, or one game's setup. `coinsToday` (game coins won today) is shown in
 * the header when given.
 */
function renderMenu(ownerId, { tab = 'solo', gameId = null, values = null, notice = null, coinsToday = null } = {}) {
    const entry = CATALOG.find(g => g.id === gameId);
    const current = entry?.category ?? (CATEGORIES[tab] ? tab : 'solo');
    const parts = [
        `## 🎮 Games\n-# <@${ownerId}>'s menu · only they can use it` +
        (coinsToday === null ? '' : ` · game coins today: ${coinsToday}/${DAILY_CAP}`),
        notice ? `-# ${notice}` : null,
        row(
            ...Object.entries(CATEGORIES).map(([id, c]) =>
                button(`games:tab:${ownerId}:${id}`, c.name, id === current ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: c.emoji })),
            button(`games:close:${ownerId}`, 'Close'),
        ),
        separator(),
        ...(entry
            ? setupView(ownerId, entry, values ?? defaults(entry))
            : CATALOG.filter(g => g.category === current).map(g => gameSection(ownerId, g))),
    ];
    return { ...panelPayload(container(parts, COLOR)), allowedMentions: { parse: [] } };
}

// The menu with the owner's game coins for today
async function menuView(ownerId, view) {
    return renderMenu(ownerId, { ...view, coinsToday: await gameCoinsToday(ownerId) });
}

// ─── Menu lifetime ───────────────────────────────────────────
// A menu nobody starts a game from is removed after MENU_MINUTES (counted from its last use)
const menus = new Map(); // message ID → timer
const starting = new Set(); // menus whose game is being started right now

// Whether a live game is on this message (the menu became that game)
const gameOn = (messageId) => [...games.values()].some(g => g.message?.id === messageId);

// `interaction` must be one whose reply is the menu message, so deleteReply() removes the menu
function keepMenu(messageId, interaction) {
    if (!messageId) return;
    clearTimeout(menus.get(messageId));
    const timer = setTimeout(() => {
        menus.delete(messageId);
        if (!starting.has(messageId) && !gameOn(messageId)) interaction.deleteReply().catch(() => {});
    }, gameConfig.MENU_MINUTES * 60_000);
    timer.unref?.();
    menus.set(messageId, timer);
}

function forgetMenu(messageId) {
    clearTimeout(menus.get(messageId));
    menus.delete(messageId);
}

// ─── Interactions ─────────────────────────────────────────────
// `/games game:<id>` opens on that game: its setup if it has choices, otherwise its tab
async function openMenu(interaction) {
    const entry = CATALOG.find(g => g.id === interaction.options.getString('game'));
    const view = entry ? (hasChoices(entry) ? { gameId: entry.id } : { tab: entry.category }) : {};
    const response = await interaction.reply({ ...await menuView(interaction.user.id, view), withResponse: true });
    keepMenu(response?.resource?.message?.id, interaction);
}

async function handleInteraction(client, interaction) {
    const [, action, ownerId, gameId, ...rest] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) return interaction.reply(ephemeral('This menu isn\'t yours. Open your own with **/games**!'));
    const messageId = interaction.message?.id;
    const entry = CATALOG.find(g => g.id === gameId);

    if (action === 'close') {
        forgetMenu(messageId);
        await interaction.deferUpdate();
        return interaction.deleteReply().catch(() => {});
    }
    // Play starts a game with no choices in one click; Start starts one after its setup
    if ((action === 'start' || action === 'play') && entry) {
        // A second click (while the first is still starting, e.g. fetching questions) is ignored
        if (starting.has(messageId) || gameOn(messageId)) return interaction.deferUpdate();
        starting.add(messageId);
        try {
            await GAMES[entry.id].start(interaction, decode(entry, action === 'start' ? rest[0] : ''));
        } finally {
            starting.delete(messageId);
        }
        // Started: the menu is now the game. Not started: it stays a menu. If this click was answered
        // with a private notice (its reply isn't the menu), the earlier cleanup timer still applies.
        if (gameOn(messageId)) forgetMenu(messageId);
        else if (!interaction.replied) keepMenu(messageId, interaction);
        return;
    }

    let view;
    if (action === 'tab' || action === 'back') {
        view = { tab: gameId }; // the tab's name is where a game ID would be
    } else if (action === 'setup' && entry) {
        view = { gameId: entry.id };
    } else if (action === 'opt' && entry?.options?.[rest[0]]) {
        const values = decode(entry, rest[1]);
        values[entry.options[rest[0]].key] = interaction.values[0];
        view = { gameId: entry.id, values };
    } else if (action === 'opp' && entry?.opponent) {
        const values = decode(entry, rest[0]);
        const picked = interaction.users?.first();
        let notice = null;
        if (!picked || picked.id === interaction.client.user.id) values.opponentId = BOT;
        else if (picked.id === ownerId) notice = 'You can\'t challenge yourself. Leave it empty to play against me!';
        else if (picked.bot) notice = 'Other bots can\'t play. Leave it empty to play against me!';
        else values.opponentId = picked.id;
        view = { gameId: entry.id, values, notice };
    } else {
        return interaction.deferUpdate();
    }
    await interaction.update(await menuView(ownerId, view));
    keepMenu(messageId, interaction);
}

module.exports = { CATALOG, openMenu, handleInteraction, renderMenu, encode, decode };
