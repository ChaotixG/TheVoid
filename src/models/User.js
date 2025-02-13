const { Schema, model } = require('mongoose');
const inventoryModel = new Schema();

const userSchema = new Schema({
	userId: {
		type: String,
		required: true,
	},
	guildId: {
		type: String,
		required: true,
	},
	Level: {
		type: Number,
		required: true,
	},
	balance: {
		type: Number,
		default: 0,
	},
	lastDaily: {
		type: Date,
		required: true,
	}
})

module.exports = model('User', userSchema); 