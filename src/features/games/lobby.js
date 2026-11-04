// Party game lobbies. The host opens one from /games (the menu message becomes the lobby), others
// join, and the host starts it; when time runs out it starts by itself if enough people joined.
// Then the game takes over the same message.
//
// A party game module exports:
//   start(interaction, options)            opens its lobby with openLobby(..., { begin, render })
//   handle(game, interaction, action, arg) passes clicks to handleLobby() first
//   render(game)                           the game message once the game has begun
//   deferActions                           includes LOBBY_ACTIONS (acknowledged before queueing)
// begin(game) sets the game up once the players are final (game.players, host first).
// created(game), if given, runs as soon as the game exists, before anything is sent to Discord
// (chat games claim their channel there, so two can't start in one channel at once).
const { PermissionFlagsBits, UserSelectMenuBuilder } = require('discord.js');
const gameConfig = require('../../config/games'); // read when used, so tests can shorten the wait
const { row, button, ButtonStyle } = require('../../utils/panels');
const { createGame, getGame, endGame, runExclusive, touch } = require('./sessions');
const { gamePayload, showGame, updateBoard, editGame, notify } = require('./common');

const LOBBY_ACTIONS = ['join', 'leave', 'begin', 'cancel', 'invite'];

const playerList = (ids) => ids.map(id => `<@${id}>`).join(', ');

function renderLobby(game) {
    const { id, title, color, rules, minPlayers, maxPlayers, players, host } = game;
    const at = `<t:${Math.floor(game.lobbyEndsAt / 1000)}:R>`;
    return gamePayload([
        `## ${title}`,
        rules,
        `**Players · ${players.length}/${maxPlayers}**\n${playerList(players)}`,
        `-# Host: <@${host}> · ${players.length >= minPlayers ? `starts by itself ${at}` : `needs at least ${minPlayers} players · called off ${at} if not`}`,
        row(
            button(`game:${id}:join`, 'Join', ButtonStyle.Success, { emoji: '➕', disabled: players.length >= maxPlayers }),
            button(`game:${id}:leave`, 'Leave', ButtonStyle.Secondary),
            button(`game:${id}:begin`, 'Start', ButtonStyle.Primary, { emoji: '▶️', disabled: players.length < minPlayers }),
            button(`game:${id}:cancel`, 'Cancel', ButtonStyle.Danger),
        ),
        players.length < maxPlayers ? row(new UserSelectMenuBuilder()
            .setCustomId(`game:${id}:invite`)
            .setPlaceholder('Invite people (they get a ping)…')
            .setMinValues(1)
            .setMaxValues(10)) : null,
    ], color);
}

const closedPayload = (game, text) => gamePayload([`## ${game.title}`, text], game.color);

/**
 * Opens a lobby in place of the /games menu. `data` is copied onto the game (options from the
 * menu, game settings); `hooks` are the game's { begin, render, created? }.
 */
/**
 * Why a party game can't be hosted where this interaction happened, or null if it can. A party
 * game can outlast the 15 minutes an interaction can edit its message; after that the bot edits
 * the game message itself, which only works in a channel it can see.
 */
function cannotHost(interaction) {
    if (interaction.appPermissions && !interaction.appPermissions.has(PermissionFlagsBits.ViewChannel)) {
        return 'I can\'t see this channel, so party games can\'t run here (they can last longer than I\'m able to update them without seeing the channel). Try a channel I can see!';
    }
    return null;
}

async function openLobby(interaction, type, { title, color, rules, minPlayers, maxPlayers, data = {} }, hooks) {
    const problem = cannotHost(interaction);
    if (problem) {
        await notify(interaction, problem);
        return null;
    }
    const game = createGame(type, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        host: interaction.user.id,
        players: [interaction.user.id],
        state: 'lobby',
        title, color, rules, minPlayers, maxPlayers,
        lobbyEndsAt: Date.now() + gameConfig.LOBBY_SECONDS * 1000,
        party: hooks,
        ...data,
    });
    hooks.created?.(game);
    game.onExpire = () => closedPayload(game, 'Nobody played for a while, so the game ended.');
    game.timer = setTimeout(() => runExclusive(game, () => lobbyTimeUp(game)), gameConfig.LOBBY_SECONDS * 1000);
    await showGame(interaction, renderLobby(game));
    touch(game, interaction);
    return game;
}

async function lobbyTimeUp(game) {
    if (game.state !== 'lobby' || !getGame(game.id)) return;
    if (game.players.length < game.minPlayers) {
        endGame(game);
        return editGame(game, closedPayload(game, `Not enough players joined (${game.minPlayers} needed), so the game was called off.`));
    }
    return beginGame(game, null);
}

async function beginGame(game, interaction) {
    clearTimeout(game.timer);
    game.state = 'playing';
    touch(game, interaction);
    await game.party.begin(game);
    const payload = game.party.render(game);
    if (interaction) await updateBoard(game, interaction, payload);
    else await editGame(game, payload);
}

/** Handles clicks while the lobby is open. Returns true if the click was handled (every click, until the game begins). */
async function handleLobby(game, interaction, action) {
    if (game.state !== 'lobby') return false;
    const userId = interaction.user.id;
    const isHost = userId === game.host;

    switch (action) {
        case 'join':
            if (game.players.includes(userId)) return notify(interaction, 'You\'re already in.').then(() => true);
            if (game.players.length >= game.maxPlayers) return notify(interaction, 'This game is full.').then(() => true);
            game.players.push(userId);
            break;
        case 'leave':
            if (!game.players.includes(userId)) return notify(interaction, 'You\'re not in this game.').then(() => true);
            game.players = game.players.filter(id => id !== userId);
            if (!game.players.length) {
                endGame(game);
                await updateBoard(game, interaction, closedPayload(game, 'Everyone left, so the game was called off.'));
                return true;
            }
            if (isHost) game.host = game.players[0];
            break;
        case 'begin':
            if (!isHost) return notify(interaction, 'Only the host can start the game.').then(() => true);
            if (game.players.length < game.minPlayers) return notify(interaction, `At least ${game.minPlayers} players are needed.`).then(() => true);
            await beginGame(game, interaction);
            return true;
        case 'invite': {
            // Editing the lobby doesn't notify anyone, so invitations are a separate message that pings
            if (!game.players.includes(userId)) return notify(interaction, 'Join first, then you can invite people.').then(() => true);
            const invited = [...(interaction.users?.values() ?? [])].filter(u => !u.bot && !game.players.includes(u.id)).map(u => u.id);
            if (!invited.length) return notify(interaction, 'They\'re already in (and bots can\'t play).').then(() => true);
            await interaction.followUp({
                content: `${playerList(invited)}, <@${userId}> invited you to play **${game.title}**! Press **Join** above.`,
                allowedMentions: { users: invited },
            });
            break; // redraw the lobby, which also clears the picker
        }
        case 'cancel':
            if (!isHost) return notify(interaction, 'Only the host can call off the game.').then(() => true);
            endGame(game);
            await updateBoard(game, interaction, closedPayload(game, `<@${game.host}> called off the game.`));
            return true;
        default:
            return notify(interaction, 'The game hasn\'t started yet. Press **Join** to play!').then(() => true);
    }
    await updateBoard(game, interaction, renderLobby(game));
    return true;
}

module.exports = { LOBBY_ACTIONS, openLobby, handleLobby, renderLobby, cannotHost, playerList };
