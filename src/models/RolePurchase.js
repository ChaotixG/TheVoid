const { Schema, model } = require('mongoose');

// A timed role bought in the shop; the role is removed once expiresAt passes.
const rolePurchaseSchema = new Schema({
	guildId: { type: String, required: true },
	userId: { type: String, required: true },
	roleId: { type: String, required: true },
	expiresAt: { type: Date, required: true },
}, { timestamps: true });

rolePurchaseSchema.index({ guildId: 1, userId: 1, roleId: 1 }, { unique: true });
rolePurchaseSchema.index({ expiresAt: 1 });

module.exports = model('RolePurchase', rolePurchaseSchema);
