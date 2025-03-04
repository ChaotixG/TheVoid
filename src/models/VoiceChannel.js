const { Schema } = require('mongoose');
//const inventoryModel = new Schema();

const vcSchema = new Schema({
	channelId: {
		type: Array,
		required: true,
	}
})

module.exports = vcSchema; 