// The bot process. Run through src/supervisor.js (npm start) so crashes are restarted automatically.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true }); // dotenv 17+ logs on load unless quiet

const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const eventHandler = require('./handlers/eventHandler');
const { runMigrations } = require('./database/migrations');
const { log, info, warn, error } = require("./services/logger");

const CONFIG_ERROR_EXIT_CODE = 78; // tells the supervisor not to retry (see supervisor.js)

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
    rest: {
        // Channel renames are limited to ~2 per 10 minutes. By default discord.js silently waits
        // that out; fail fast instead so the user can be told to try again later.
        rejectOnRateLimit: (data) => data.method === 'PATCH' && data.route.startsWith('/channels') && data.retryAfter > 5_000,
    },
});

// ─── Resilience ────────────────────────────────────────────────
function installProcessHandlers() {
    // A stray rejected promise is logged and the bot keeps running.
    process.on('unhandledRejection', (err) => error('Unhandled promise rejection: ', err));
    // After an uncaught exception the process state is unknown: exit and let the supervisor restart it.
    process.on('uncaughtException', (err) => {
        error('Uncaught exception, restarting: ', err);
        shutdown(1);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
}

// Without an 'error' listener, Node throws on client errors and the bot dies
client.on('error', (err) => error('Discord client error: ', err));
client.on('warn', (message) => warn(`Discord: ${message}`));
client.on('shardError', (err, shardId) => error(`Shard ${shardId} connection error: `, err));
client.on('shardReconnecting', (shardId) => info(`Shard ${shardId} reconnecting...`));
client.on('shardResume', (shardId) => info(`Shard ${shardId} resumed`));

// discord.js only emits this for close codes it won't reconnect from, so the process would sit
// there offline. Exit instead: config problems stop the supervisor, anything else restarts.
const CONFIG_CLOSE_CODES = {
    4004: 'the bot token is invalid (was it reset?)',
    4013: 'the requested gateway intents are invalid',
    4014: 'a privileged intent (Server Members, Presence or Message Content) is not enabled in the Developer Portal',
};
client.on('shardDisconnect', ({ code }, shardId) => {
    if (CONFIG_CLOSE_CODES[code]) {
        error(`Discord closed the connection (${code}): ${CONFIG_CLOSE_CODES[code]}`);
        return shutdown(CONFIG_ERROR_EXIT_CODE);
    }
    error(`Shard ${shardId} disconnected and can't reconnect (code ${code}), restarting...`);
    shutdown(1);
});

mongoose.connection.on('disconnected', () => warn('MongoDB disconnected; mongoose will keep retrying'));
mongoose.connection.on('reconnected', () => info('MongoDB reconnected'));
mongoose.connection.on('error', (err) => error('MongoDB connection error: ', err));

let shuttingDown = false;
async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(code), 10_000).unref(); // hard stop if cleanup hangs
    await client.destroy().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    process.exit(code);
}

class ConfigError extends Error {}

function readMongoUri() {
    if (!process.env.MONGODB_URI) throw new ConfigError('MONGODB_URI is not set in .env');

    // Trim whitespace/newlines that can accidentally break auth
    let uri = process.env.MONGODB_URI.trim();
    if (/\r|\n/.test(uri)) {
        error('MongoDB URI contains newline characters; please check your .env file');
        uri = uri.replace(/\r|\n/g, '');
    }

    // log username (hide password)
    const credMatch = uri.match(/\/\/([^:]+):([^@]+)@/);
    log(credMatch ? `Connecting to MongoDB as user "${credMatch[1]}"` : 'MongoDB URI does not include credentials');
    return uri;
}

// Atlas IP whitelisting is only needed on hosts whose public IP changes.
// It turns on when the Atlas API keys are present in .env; remove them on a static-IP host.
async function prepareAtlasAccess() {
    const { MONGODB_PUBLIC_KEY, MONGODB_PRIVATE_KEY, MONGODB_PROJECT_ID } = process.env;
    if (!MONGODB_PUBLIC_KEY || !MONGODB_PRIVATE_KEY || !MONGODB_PROJECT_ID) return;

    const { getPublicIP, addIPIfNeeded } = require('./utils/ipUtils');
    const { applyMongoIPGuard } = require('./utils/mongoIPGuard');

    const ip = await getPublicIP().catch(() => 'n/a');
    log(`Public IP: ${ip}`);
    await addIPIfNeeded(ip).catch(err => error(`Failed to add IP to whitelist: ${err.message}`));
    applyMongoIPGuard();
}

async function main() {
    if (!process.env.TOKEN) throw new ConfigError('TOKEN is not set in .env');
    const uri = readMongoUri();

    await prepareAtlasAccess();

    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20_000 });
    log('Connected to MongoDB!');

    await runMigrations();

    eventHandler(client);
    client.once('clientReady', () => log(`Bot is online as ${client.user.tag} in ${client.guilds.cache.size} servers`));
    await client.login(process.env.TOKEN);
}

// Only start when run directly (node src/index.js or via the supervisor), never when required by a script or test
if (require.main === module) {
    installProcessHandlers();
    main().catch((err) => {
        const isConfigError = err instanceof ConfigError || err.code === 'TokenInvalid';
        error(isConfigError ? `Configuration error: ${err.message}` : 'Startup failed: ', isConfigError ? undefined : err);
        shutdown(isConfigError ? CONFIG_ERROR_EXIT_CODE : 1);
    });
}
