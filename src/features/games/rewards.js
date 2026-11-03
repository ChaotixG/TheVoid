// Coin rewards for game wins, with a daily cap per person (config/games.js DAILY_CAP).
// The cap is enforced inside one atomic update, so parallel wins can't go over it.
const Wallet = require('../../models/Wallet');
const Transaction = require('../../models/Transaction');
const { DAILY_CAP } = require('../../config/games');

const today = () => new Date().toISOString().slice(0, 10);

/** Pays up to `amount` coins (less if the daily cap is nearly used). Returns { paid, capped }. */
async function payGameReward(userId, amount, { guildId = null, game } = {}) {
    if (amount <= 0) return { paid: 0, capped: false };
    const day = today();

    // Make sure the wallet exists and its game counter is for today
    await Wallet.updateOne({ userId }, { $setOnInsert: { gameDay: day, gameEarned: 0 } }, { upsert: true });
    await Wallet.updateOne({ userId, gameDay: { $ne: day } }, { $set: { gameDay: day, gameEarned: 0 } });

    // Pay min(amount, room left under the cap), all in one update
    const before = await Wallet.collection.findOneAndUpdate(
        { userId, gameDay: day, gameEarned: { $lt: DAILY_CAP } },
        [{ $set: {
            balance: { $add: ['$balance', { $min: [amount, { $subtract: [DAILY_CAP, '$gameEarned'] }] }] },
            earned: { $add: [{ $ifNull: ['$earned', 0] }, { $min: [amount, { $subtract: [DAILY_CAP, '$gameEarned'] }] }] },
            gameEarned: { $add: ['$gameEarned', { $min: [amount, { $subtract: [DAILY_CAP, '$gameEarned'] }] }] },
        } }],
        { returnDocument: 'before' }
    );
    if (!before) return { paid: 0, capped: true };

    const paid = Math.min(amount, DAILY_CAP - before.gameEarned);
    await Transaction.create({ userId, guildId, amount: paid, type: 'game', note: game }).catch(() => {});
    return { paid, capped: paid < amount };
}

// "+25 🪙" (or why nothing was paid), for the result line of a game
function rewardText({ paid, capped }) {
    if (paid > 0) return `+${paid} 🪙${capped ? ' (daily game limit reached)' : ''}`;
    return capped ? 'no coins: daily game limit reached' : '';
}

module.exports = { payGameReward, rewardText };
