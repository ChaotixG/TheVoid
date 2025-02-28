const { Schema, model } = require('mongoose');
//const inventoryModel = new Schema();

const userSchema = new Schema({
	userId: {
		type: String,
		required: true,
	},
	level: {
		type: Number,
		required: true,
	},
	xp: {
		type: Number,
		default: 0,
	},
	balance: {
		type: Number,
		default: 0,
	},
	lastDaily: {
		type: Date,
		default: null,
	}
})

module.exports = userSchema; 