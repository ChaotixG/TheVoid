const { Schema, model } = require('mongoose');

// One wallet per user, shared across every server. Balances only change through atomic
// $inc updates (see services/wallet.js), so concurrent earning and spending can't clash.
const walletSchema = new Schema({
	userId: { type: String, required: true, unique: true },
	balance: { type: Number, default: 0, min: 0 },
	earned: { type: Number, default: 0 }, // lifetime totals, for /balance
	spent: { type: Number, default: 0 },
	lastDaily: { type: Date, default: null },
	dailyStreak: { type: Number, default: 0 },
	lastWeekly: { type: Date, default: null },
	ownedThemes: { type: [String], default: [] },
	equippedTheme: { type: String, default: 'default' },
	// Premium custom card colors (hex); the second color of each pair makes a gradient
	customTheme: {
		background: { type: String, default: null },
		background2: { type: String, default: null },
		accent: { type: String, default: null },
		accent2: { type: String, default: null },
	},
	// Coins won from games today (UTC), for the daily game cap
	gameDay: { type: String, default: null },
	gameEarned: { type: Number, default: 0 },
}, { timestamps: true });

walletSchema.index({ balance: -1 });

module.exports = model('Wallet', walletSchema);
