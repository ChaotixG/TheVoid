const { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const Member = require('../../models/Member');
const { getGuildSettings } = require('../../services/guildSettings');

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily coins (once every 24 hours)')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        await interaction.deferReply(); // the database work below may take a moment
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const { economy } = await getGuildSettings(guildId);
        const now = new Date();

        await Member.updateOne({ guildId, userId }, { $setOnInsert: { lastDaily: null } }, { upsert: true });
        // Only succeeds if the last claim was 24+ hours ago, so double-clicks can't claim twice
        const claimed = await Member.findOneAndUpdate(
            { guildId, userId, $or: [{ lastDaily: null }, { lastDaily: { $lte: new Date(now.getTime() - DAY_MS) } }] },
            { $inc: { balance: economy.dailyAmount }, $set: { lastDaily: now } },
            { returnDocument: 'after', projection: { balance: 1 } }
        ).lean();

        if (!claimed) {
            const member = await Member.findOne({ guildId, userId }, { lastDaily: 1 }).lean();
            const next = Math.ceil((member.lastDaily.getTime() + DAY_MS) / 1000);
            // Keep "come back later" private: drop the public placeholder and answer privately
            await interaction.deleteReply().catch(() => {});
            return interaction.followUp({ content: `⏳ You already claimed today's reward. Come back <t:${next}:R>.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.editReply(`💰 You claimed **${economy.dailyAmount.toLocaleString()}** coins! You now have **${claimed.balance.toLocaleString()}**.`);
    },
};
