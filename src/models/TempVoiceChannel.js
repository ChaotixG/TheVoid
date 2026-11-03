const { Schema, model } = require('mongoose');

// A voice channel created from a hub. Kept in the database so ownership and cleanup
// survive bot restarts.
const tempVoiceChannelSchema = new Schema({
	guildId: { type: String, required: true },
	channelId: { type: String, required: true, unique: true },
	ownerId: { type: String, default: null },
	// The control panel message posted in the channel's text chat
	panelMessageId: { type: String, default: null },
}, { timestamps: true });

tempVoiceChannelSchema.index({ guildId: 1 });

module.exports = model('TempVoiceChannel', tempVoiceChannelSchema);
