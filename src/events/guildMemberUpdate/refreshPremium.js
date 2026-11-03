const { forgetPremium, premiumConfig } = require('../../services/premium');

// Someone's roles changed in the premium server: re-check their premium status next time
module.exports = async (client, oldMember, newMember) => {
    if (newMember.guild.id === premiumConfig().guildId) forgetPremium(newMember.id);
};
