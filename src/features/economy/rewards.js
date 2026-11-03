// Timed rewards (/daily, /weekly) and chat coins. Voice earning: voiceActivity.js. Amounts: config/economy.js.
const Wallet = require('../../models/Wallet');
const Transaction = require('../../models/Transaction');
const { randomInt } = require('crypto');
const { DAILY, WEEKLY, CHAT, PREMIUM } = require('../../config/economy');
const { credit } = require('../../services/wallet');
const { isPremium, coinMultiplier } = require('../../services/premium');

const HOUR = 60 * 60 * 1000;

// Claims a timed reward atomically: only succeeds if the last claim is old enough, so two clicks
// (or two servers at once) can never claim twice. Returns { claimed, ... } or { nextAt }.
async function claimTimed(userId, { field, cooldownMs, amountFor }) {
    const now = new Date();
    await Wallet.updateOne({ userId }, { $setOnInsert: { [field]: null } }, { upsert: true });

    const before = await Wallet.findOne({ userId }, { [field]: 1, dailyStreak: 1 }).lean();
    const last = before[field];
    if (last && now - last < cooldownMs) return { nextAt: new Date(last.getTime() + cooldownMs) };

    const { amount, set = {} } = amountFor(before, now);
    const wallet = await Wallet.findOneAndUpdate(
        // Matching the value just read makes the claim conditional: a parallel claim changes it first
        { userId, [field]: last ?? null },
        { $inc: { balance: amount, earned: amount }, $set: { [field]: now, ...set } },
        { returnDocument: 'after' }
    ).lean();
    if (!wallet) return { nextAt: new Date(now.getTime() + cooldownMs) }; // lost the race to a parallel claim
    return { claimed: true, amount, wallet };
}

async function claimDaily(client, userId, guildId) {
    const premium = await isPremium(client, userId);
    const result = await claimTimed(userId, {
        field: 'lastDaily',
        cooldownMs: DAILY.cooldownHours * HOUR,
        amountFor: (wallet, now) => {
            // The streak continues if the previous claim was within the streak window
            const continues = wallet.lastDaily && now - wallet.lastDaily <= DAILY.streakWindowHours * HOUR;
            const streak = continues ? (wallet.dailyStreak || 0) + 1 : 1;
            const bonus = Math.min((streak - 1) * DAILY.streakBonus, DAILY.maxStreakBonus);
            const amount = Math.round((DAILY.base + bonus) * (premium ? PREMIUM.dailyMultiplier : 1));
            return { amount, set: { dailyStreak: streak } };
        },
    });
    if (result.claimed) await logReward(userId, guildId, result.amount, 'daily');
    return { ...result, premium };
}

async function claimWeekly(client, userId, guildId) {
    const premium = await isPremium(client, userId);
    const result = await claimTimed(userId, {
        field: 'lastWeekly',
        cooldownMs: WEEKLY.cooldownDays * 24 * HOUR,
        amountFor: () => ({ amount: Math.round(WEEKLY.amount * (premium ? PREMIUM.weeklyMultiplier : 1)) }),
    });
    if (result.claimed) await logReward(userId, guildId, result.amount, 'weekly');
    return { ...result, premium };
}

// The claim itself already added the coins; this only records it for /history
async function logReward(userId, guildId, amount, type) {
    await Transaction.create({ userId, guildId, amount, type }).catch(() => {});
}

// ─── Passive earning ──────────────────────────────────────────
const chatCooldowns = new Map(); // userId → ms when chat coins can be earned again (global, all servers)

setInterval(() => {
    const now = Date.now();
    for (const [userId, until] of chatCooldowns) if (until <= now) chatCooldowns.delete(userId);
}, 10 * 60_000).unref();

async function grantChatCoins(client, userId) {
    const now = Date.now();
    if ((chatCooldowns.get(userId) ?? 0) > now) return 0;
    chatCooldowns.set(userId, now + CHAT.cooldownSeconds * 1000);

    const amount = Math.round(randomInt(CHAT.min, CHAT.max + 1) * await coinMultiplier(client, userId));
    await credit(userId, amount); // not logged individually (see Transaction model)
    return amount;
}

module.exports = { claimDaily, claimWeekly, grantChatCoins };
