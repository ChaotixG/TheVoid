const { Schema, model } = require('mongoose');

// Each person's record in one game, across all servers (the Stats tab of /games). Written with
// $inc and $min/$max, so finishing two games at once can't lose either result.
const gameStatsSchema = new Schema({
	userId: { type: String, required: true },
	game: { type: String, required: true }, // game type, e.g. 'wordle'
	played: { type: Number, default: 0 },
	wins: { type: Number, default: 0 },
	// Best score (what counts as best depends on the game, see games/stats.js). No default:
	// $min/$max treat a stored null as a value, so the first score must find the field missing.
	best: { type: Number },
}, { timestamps: true });

gameStatsSchema.index({ userId: 1, game: 1 }, { unique: true });

module.exports = model('GameStats', gameStatsSchema);
