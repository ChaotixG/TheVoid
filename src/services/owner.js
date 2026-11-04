// The bot's owner: the user IDs in OWNER_IDS (comma-separated) if set, otherwise whoever owns the
// app in the Discord Developer Portal (every member, for an app owned by a team). Server owners and
// admins are not the bot's owner.

async function botOwnerIds(client) {
    const fromEnv = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (fromEnv.length) return fromEnv;
    if (!client.application?.owner) await client.application?.fetch();
    const owner = client.application?.owner;
    if (!owner) return [];
    return owner.members ? [...owner.members.keys()] : [owner.id]; // a team, or one person
}

async function isBotOwner(client, userId) {
    return (await botOwnerIds(client)).includes(userId);
}

module.exports = { isBotOwner, botOwnerIds };
