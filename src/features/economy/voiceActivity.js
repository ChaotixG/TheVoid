// Voice activity: every interval, people actively in voice earn coins (global wallet) and XP
// (that server's leveling). "Active" = not muted, deafened or a stage listener, not in the AFK channel, and at least
// one other unmuted person in the channel. Silence (muted, deafened, alone, AFK) earns nothing,
// and anything that counts voice time later (goals, quests) must use isActiveInVoice too.
const Wallet = require('../../models/Wallet');
const { VOICE } = require('../../config/economy');
const { coinMultiplier } = require('../../services/premium');
const { grantVoiceXp } = require('../leveling/xp');
const { error } = require('../../services/logger');

// `suppress`: a stage-channel audience member, who can't speak
const canTalk = (state) => Boolean(state.member) && !state.member.user.bot
    && !state.selfMute && !state.serverMute && !state.selfDeaf && !state.serverDeaf && !state.suppress;

/** @param {import('discord.js').VoiceState} state */
function isActiveInVoice(state) {
    const channel = state.channel;
    if (!channel || channel.id === state.guild.afkChannelId || !canTalk(state)) return false;
    // Someone to talk to: at least one other person who can talk too
    const talkers = channel.members.filter(m => m.voice && canTalk(m.voice));
    return talkers.size >= 2;
}

// Everyone active right now, as { member, channel }. A user can only be in one voice channel
// across all of Discord, so extra servers can't be used to earn twice.
function activeVoiceMembers(client) {
    const active = [];
    for (const guild of client.guilds.cache.values()) {
        for (const state of guild.voiceStates.cache.values()) {
            if (isActiveInVoice(state)) active.push({ member: state.member, channel: state.channel });
        }
    }
    return active;
}

async function payVoiceActivity(client) {
    const active = activeVoiceMembers(client);
    if (!active.length) return 0;

    // Coins: one bulk write for everyone
    const ops = await Promise.all(active.map(async ({ member }) => {
        const amount = Math.round(VOICE.amount * await coinMultiplier(client, member.id));
        return { updateOne: { filter: { userId: member.id }, update: { $inc: { balance: amount, earned: amount } }, upsert: true } };
    }));
    await Wallet.bulkWrite(ops, { ordered: false });

    // XP: per server, with that server's settings (and level-ups/roles)
    for (const { member, channel } of active) {
        await grantVoiceXp(member, channel).catch(err => error(`Voice XP failed for ${member.id} in ${member.guild.id}: `, err));
    }
    return active.length;
}

function startVoiceActivity(client) {
    setInterval(() => {
        payVoiceActivity(client).catch(err => error('Error paying voice activity: ', err));
    }, VOICE.intervalMinutes * 60_000).unref();
}

module.exports = { isActiveInVoice, activeVoiceMembers, payVoiceActivity, startVoiceActivity };
