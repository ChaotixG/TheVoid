const { Schema, model } = require('mongoose');

// Per-guild configuration. Member data lives in Member, temp voice channels in TempVoiceChannel.
// Settings use plain nested paths (not sub-schemas) so every leaf gets its own default and
// partial updates like { $set: { 'settings.leveling.cooldownSeconds': 30 } } are safe with upserts.

const ticketTarget = {
	channelId: { type: String, default: null },
	type: { type: String, enum: ['channel', 'forum', null], default: null },
};

const serverSchema = new Schema({
	guildId: {
		type: String,
		required: true,
		unique: true,
	},
	settings: {
		voiceHubs: {
			type: [new Schema({ channelId: { type: String, required: true }, name: String }, { _id: false })],
			default: [],
		},
		// Staff handle tickets; moderators get moderator powers in voice hub channels
		staffRoleIds: { type: [String], default: [] },
		modRoleIds: { type: [String], default: [] },
		tickets: {
			troubleshooting: ticketTarget,
			suggestions: ticketTarget,
			complaints: ticketTarget,
			transcriptChannelId: { type: String, default: null },
		},
		leveling: {
			enabled: { type: Boolean, default: true },
			announce: { type: String, enum: ['same', 'channel', 'off'], default: 'same' },
			announceChannelId: { type: String, default: null },
			noXpChannelIds: { type: [String], default: [] },
			cooldownSeconds: { type: Number, default: 60, min: 0, max: 3600 },
			xpMin: { type: Number, default: 10, min: 1, max: 1000 },
			xpMax: { type: Number, default: 35, min: 1, max: 1000 },
			levelRoles: {
				type: [new Schema({ level: { type: Number, required: true, min: 1 }, roleId: { type: String, required: true } }, { _id: false })],
				default: [],
			},
			keepLowerRoles: { type: Boolean, default: true },
		},
		moderation: {
			logChannelId: { type: String, default: null },
		},
		economy: {
			dailyAmount: { type: Number, default: 100, min: 1, max: 1_000_000 },
		},
	},
	// Set when the bot leaves the guild; data is deleted 30 days later unless the bot is re-added
	leftAt: { type: Date, default: null },
}, { minimize: false });

serverSchema.index({ leftAt: 1 });

const Server = model('Server', serverSchema);

module.exports = Server;
