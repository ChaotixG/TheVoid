const { Schema, model } = require('mongoose');

// Wallet history for /history. Chat and voice earnings aren't logged individually (too many);
// entries expire after 90 days.
const transactionSchema = new Schema({
	userId: { type: String, required: true },
	guildId: { type: String, default: null },
	amount: { type: Number, required: true }, // positive = received, negative = spent
	type: { type: String, required: true, enum: ['daily', 'weekly', 'pay_in', 'pay_out', 'shop_role', 'shop_theme', 'refund', 'migration', 'game'] },
	note: { type: String, default: null },
	createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 60 * 60 },
});

transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = model('Transaction', transactionSchema);
