const { Schema, model } = require('mongoose');

const serverSchema = new Schema({
	guildId: {
		type: String,
		required: true,
	},channelsId: {
		type: Array,
		required: true,
	},disabledCommands: {
		type: Array,
		required: true,
	},users: {
		type: Array,
		required: true,
	}
})

module.exports = model('User', userSchema); 