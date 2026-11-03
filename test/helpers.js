// Shared test setup: an in-memory MongoDB (a one-node replica set, like Atlas, so transactions
// work) plus small fakes for discord.js objects.
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { Collection, PermissionsBitField } = require('discord.js');

let mongo;

async function startDatabase() {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri());
    await Promise.all(Object.values(mongoose.models).map(m => m.init()));
}

async function stopDatabase() {
    await mongoose.disconnect();
    await mongo?.stop();
}

async function clearDatabase() {
    await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})));
    require('../src/services/guildSettings').invalidateGuildSettings('g1');
}

// A guild with a few channels/roles and a bot member that has every permission
function fakeGuild({ id = 'g1', channels = [], roles = [], botPermissions = PermissionsBitField.All } = {}) {
    const channelCache = new Collection(channels.map(c => [c.id, c]));
    const roleCache = new Collection([[id, { id, name: '@everyone', editable: false }], ...roles.map(r => [r.id, r])]);
    return {
        id,
        name: 'Test Guild',
        available: true,
        ownerId: 'owner',
        channels: { cache: channelCache },
        roles: { cache: roleCache },
        members: { me: { permissions: new PermissionsBitField(botPermissions) } },
    };
}

/**
 * Checks a Components V2 payload against Discord's limits by serializing it with discord.js's
 * own builders (which validate) and counting components.
 */
function inspectPanel(payload) {
    const json = payload.components.map(c => c.toJSON());
    let count = 0;
    let textLength = 0;
    const ids = [];
    const walk = (component) => {
        count++;
        if (component.type === 10) textLength += component.content.length; // text display
        if (component.custom_id) ids.push(component.custom_id);
        for (const child of component.components ?? []) walk(child);
        if (component.accessory) walk(component.accessory);
    };
    json.forEach(walk);
    return { count, textLength, ids, json };
}

module.exports = { startDatabase, stopDatabase, clearDatabase, fakeGuild, inspectPanel };
