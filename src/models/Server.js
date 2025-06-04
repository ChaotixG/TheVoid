const { Schema, model } = require('mongoose');
const userSchema = require('./User');
const channelsSchema = require('./Channels');

const serverSchema = new Schema({
	guildId: {
		type: String,
		required: true,
		unique: true,
	},users: {
		type: [userSchema],
		required: true,
		default: [],
	},channels: {
		type: [channelsSchema],
		required: true,
		default: [],
	},settings: {
		type: Object,
		required: true,
		default: {},
	}
})

const Server = model('Server', serverSchema);

module.exports = Server; 