const { Schema, model } = require('mongoose');

// One document per user per guild (XP is per server; coins live in the global Wallet).
// Updated with atomic operators only ($inc/$set), so concurrent messages never overwrite each other.
const memberSchema = new Schema({
	guildId: { type: String, required: true },
	userId: { type: String, required: true },
	totalXp: { type: Number, default: 0, min: 0 },
	// Name reused for the member's next temporary voice channel
	voiceChannelName: { type: String, default: null },
}, { timestamps: true });

memberSchema.index({ guildId: 1, userId: 1 }, { unique: true });
memberSchema.index({ guildId: 1, totalXp: -1 }); // rank + leaderboard

module.exports = model('Member', memberSchema);
