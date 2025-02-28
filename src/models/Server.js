const { Schema, model } = require('mongoose');
const userSchema = require('./User');

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
		type: [userSchema],
		required: true,
	}
})

const Server = model('Server', serverSchema);

module.exports = Server; 