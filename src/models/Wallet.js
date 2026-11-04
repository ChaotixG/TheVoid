const { Schema, model } = require('mongoose');

// One part of a custom card theme (background, inner card or outline)
const themePart = (modes) => ({
	mode: { type: String, enum: modes, default: 'solid' },
	color: { type: String, default: null },
	color2: { type: String, default: null },
	direction: { type: String, default: 'lr' },
});

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
	// Premium custom theme (bought in /shop). Each part is a solid color or a gradient in one of the
	// unlocked directions; the background can be an uploaded picture instead (stored in CardImage).
	customTheme: {
		owned: { type: Boolean, default: false },
		directions: { type: [String], default: [] }, // unlocked gradient directions (config CUSTOM_THEME.directions)
		background: themePart(['solid', 'gradient', 'image']),
		inner: themePart(['solid', 'gradient']),
		outline: themePart(['solid', 'gradient']),
		hasImage: { type: Boolean, default: false },
	},
	// Premium, given by the bot owner (services/premium.js): when it ends (year 9999 = for good)
	premiumUntil: { type: Date, default: null },
	// Coins won from games today (UTC), for the daily game cap
	gameDay: { type: String, default: null },
	gameEarned: { type: Number, default: 0 },
}, { timestamps: true });

walletSchema.index({ balance: -1 });

module.exports = model('Wallet', walletSchema);
