const { Schema } = require('mongoose');
//const inventoryModel = new Schema();

const channelsSchema = new Schema({
	channelId: {
		type: String,
		required: true,
	},
	channelName: {
		type: Number,
		required: true,
	}
})

module.exports = channelsSchema; 