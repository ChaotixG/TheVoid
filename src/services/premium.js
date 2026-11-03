// Premium is controlled only by the bot owner: someone is premium while they have one of the
// PREMIUM_ROLE_IDS in the PREMIUM_GUILD_ID server (e.g. a Server Subscription, Patreon or Ko-fi
// role there). It applies in every server. Server admins can't grant it, so economies stay equal.
const { PREMIUM } = require('../config/economy');
const { warn } = require('./logger');

const CACHE_MS = 5 * 60_000;
const cache = new Map(); // userId → { value, expires }

const premiumConfig = () => ({
    guildId: process.env.PREMIUM_GUILD_ID || null,
    roleIds: (process.env.PREMIUM_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    url: process.env.PREMIUM_URL || null,
});

const premiumEnabled = () => {
    const { guildId, roleIds } = premiumConfig();
    return Boolean(guildId && roleIds.length);
};

async function isPremium(client, userId) {
    if (!premiumEnabled()) return false;
    const hit = cache.get(userId);
    if (hit && hit.expires > Date.now()) return hit.value;

    // Cache only: the premium server's members are loaded at startup (primePremiumMembers) and kept
    // current by Discord, so someone missing from it isn't a member there, and no API call is needed
    const { guildId, roleIds } = premiumConfig();
    const member = client.guilds.cache.get(guildId)?.members.cache.get(userId);
    const value = Boolean(member && roleIds.some(id => member.roles.cache.has(id)));
    cache.set(userId, { value, expires: Date.now() + CACHE_MS });
    return value;
}

// Called when roles change in the premium server, so new subscribers get perks right away
function forgetPremium(userId) {
    cache.delete(userId);
}

// Loads every member of the premium server once at startup (needs the Server Members intent)
async function primePremiumMembers(client) {
    if (!premiumEnabled()) return;
    const guild = client.guilds.cache.get(premiumConfig().guildId);
    if (!guild) return warn('PREMIUM_GUILD_ID is set, but I\'m not in that server, so nobody can be premium.');
    await guild.members.fetch().catch(err => warn(`Could not load premium server members: ${err.message}`));
}

async function coinMultiplier(client, userId) {
    return (await isPremium(client, userId)) ? PREMIUM.coinMultiplier : 1;
}

module.exports = { isPremium, forgetPremium, premiumEnabled, premiumConfig, coinMultiplier, primePremiumMembers };
