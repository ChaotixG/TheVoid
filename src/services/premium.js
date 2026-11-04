// Premium is given only by the bot's owner: with /botowner premium, or by setting premiumUntil on
// the person's wallet in the database. It's per person, lasts a number of days or for good, and
// works in every server. Server owners and admins can't give it, so economies stay equal.
// (Buying it through Discord comes later.)
const Wallet = require('../models/Wallet');
const { PREMIUM } = require('../config/economy');

const DAY_MS = 24 * 60 * 60 * 1000;
const FOREVER = new Date('9999-12-31T23:59:59Z');
const CACHE_MS = 60_000; // a change made straight in the database applies within a minute
const cache = new Map(); // userId → { until, expires }

/** When this person's premium ends (a Date), or null if they don't have it */
async function premiumUntil(userId) {
    const hit = cache.get(userId);
    if (hit && hit.expires > Date.now()) return hit.until && hit.until > Date.now() ? hit.until : null;
    const wallet = await Wallet.findOne({ userId }, { premiumUntil: 1 }).lean();
    const until = wallet?.premiumUntil && wallet.premiumUntil > Date.now() ? wallet.premiumUntil : null;
    cache.set(userId, { until, expires: Date.now() + CACHE_MS });
    return until;
}

async function isPremium(client, userId) {
    return Boolean(await premiumUntil(userId));
}

const isForever = (until) => until.getUTCFullYear() >= FOREVER.getUTCFullYear();

// After a change, the next check reads the database again
function forgetPremium(userId) {
    cache.delete(userId);
}

/** Gives premium for `days` more (on top of any they still have), or for good without `days`. Returns the new end. */
async function grantPremium(userId, days = null) {
    forgetPremium(userId);
    const current = await premiumUntil(userId);
    const until = days ? new Date((current ?? new Date()).getTime() + days * DAY_MS) : FOREVER;
    await Wallet.updateOne({ userId }, { $set: { premiumUntil: until } }, { upsert: true });
    forgetPremium(userId);
    return until;
}

/** Takes premium away. Returns whether they had it. */
async function removePremium(userId) {
    const had = Boolean(await premiumUntil(userId));
    await Wallet.updateOne({ userId }, { $set: { premiumUntil: null } });
    forgetPremium(userId);
    return had;
}

async function coinMultiplier(client, userId) {
    return (await isPremium(client, userId)) ? PREMIUM.coinMultiplier : 1;
}

module.exports = { isPremium, premiumUntil, isForever, grantPremium, removePremium, forgetPremium, coinMultiplier };
