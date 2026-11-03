const { CURRENCY } = require('../config/economy');

// "🪙 **1,234**" so coin amounts look the same everywhere
const coins = (amount) => `${CURRENCY.emoji} **${Math.round(amount).toLocaleString()}**`;

module.exports = { coins };
