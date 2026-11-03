// Keeps the bot running: starts src/index.js as a child process and restarts it whenever it
// exits, waiting longer after repeated quick crashes (1s, 2s, 4s ... up to 60s).
// Start with `npm start`. Ctrl+C / SIGTERM stops both processes cleanly.
const { fork } = require('child_process');
const path = require('path');
const { info, warn, error } = require('./services/logger');

const BOT_ENTRY = path.join(__dirname, 'index.js');
const CONFIG_ERROR_EXIT_CODE = 78; // bot exits with this when restarting can't help (bad token, missing .env values)
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const STABLE_AFTER_MS = 60_000; // a run this long counts as healthy and resets the delay

let child = null;
let stopping = false;
let delay = MIN_DELAY_MS;

function start() {
    const startedAt = Date.now();
    child = fork(BOT_ENTRY, process.argv.slice(2), { stdio: 'inherit' });

    child.on('exit', (code, signal) => {
        child = null;
        if (stopping) return process.exit(0);

        if (code === CONFIG_ERROR_EXIT_CODE) {
            error('Bot stopped because of a configuration problem (see the error above). Fix it, then run npm start again.');
            return process.exit(1);
        }

        if (Date.now() - startedAt > STABLE_AFTER_MS) delay = MIN_DELAY_MS;
        warn(`Bot exited (code ${code}${signal ? `, signal ${signal}` : ''}). Restarting in ${delay / 1000}s...`);
        setTimeout(start, delay);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
    });
}

// Only run when started directly (npm start), never when required by a script or test
if (require.main === module) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            stopping = true;
            info(`Received ${signal}, stopping bot...`);
            if (child) child.kill(signal);
            else process.exit(0);
        });
    }

    start();
}
