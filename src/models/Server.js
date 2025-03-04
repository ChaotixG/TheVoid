const { Schema, model } = require('mongoose');
const userSchema = require('./User');

const serverSchema = new Schema({
	guildId: {
		type: String,
		required: true,
	},users: {
		type: [userSchema],
		required: true,
	},settings: {
		type: Object,
		required: true,
	}
})

const Server = model('Server', serverSchema);

module.exports = Server; 