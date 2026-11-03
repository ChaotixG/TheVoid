const { Schema, model } = require('mongoose');

// A custom theme's background image, already cropped to the card's size (930×280) and
// re-encoded, so the original upload (and its expiring Discord link) isn't needed.
const cardImageSchema = new Schema({
	userId: { type: String, required: true, unique: true },
	data: { type: Buffer, required: true },
	contentType: { type: String, default: 'image/jpeg' },
}, { timestamps: true });

module.exports = model('CardImage', cardImageSchema);
