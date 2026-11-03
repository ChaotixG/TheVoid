// The only place coins move. Every change is a single atomic update on the user's global wallet:
// credits use $inc (creating the wallet if needed), debits only succeed if the balance covers them,
// so concurrent commands can never overspend or lose coins. Transfers run in one transaction.
const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { PAY } = require('../config/economy');
const { warn } = require('./logger');

async function getWallet(userId) {
    return (await Wallet.findOne({ userId }).lean()) ?? new Wallet({ userId }).toObject();
}

async function log(userId, amount, { type, guildId = null, note = null }, session) {
    if (!type) return;
    const write = Transaction.create([{ userId, guildId, amount, type, note }], { session });
    // Inside a transaction the log must succeed with everything else; outside, it's best effort
    if (session) return write;
    await write.catch(err => warn(`Could not log a ${type} transaction for ${userId}: ${err.message}`));
}

/** Adds coins. `meta.type` (optional) records it in /history. Returns the updated wallet. */
async function credit(userId, amount, meta = {}, session = null) {
    const wallet = await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: amount, earned: amount } },
        { upsert: true, returnDocument: 'after', session }
    ).lean();
    await log(userId, amount, meta, session);
    return wallet;
}

/** Removes coins if the balance covers it. Returns the updated wallet, or null if it doesn't. */
async function debit(userId, amount, meta = {}, session = null) {
    const wallet = await Wallet.findOneAndUpdate(
        { userId, balance: { $gte: amount } },
        { $inc: { balance: -amount, spent: amount } },
        { returnDocument: 'after', session }
    ).lean();
    if (wallet) await log(userId, -amount, meta, session);
    return wallet;
}

const payTax = (amount) => Math.ceil((amount * PAY.taxPercent) / 100);

/**
 * Moves coins between users; the receiver gets the amount minus the tax. Both sides (and their
 * history entries) commit together or not at all, so a crash can't lose or create coins.
 * Returns { sent, received, tax, balance } or null if the sender can't afford it.
 */
async function transfer(fromId, toId, amount, guildId) {
    const tax = payTax(amount);
    const session = await mongoose.startSession();
    try {
        let result = null;
        await session.withTransaction(async () => {
            result = null; // the callback may be retried on transient errors
            const sender = await debit(fromId, amount, { type: 'pay_out', guildId, note: `to ${toId}` }, session);
            if (!sender) return; // nothing was written, so committing is a no-op
            await credit(toId, amount - tax, { type: 'pay_in', guildId, note: `from ${fromId}` }, session);
            result = { sent: amount, received: amount - tax, tax, balance: sender.balance };
        });
        return result;
    } finally {
        await session.endSession();
    }
}

module.exports = { getWallet, credit, debit, transfer, payTax };
