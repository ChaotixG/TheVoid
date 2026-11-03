// Console logger with levels. Set LOG_LEVEL=debug in .env to see debug output.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

const COLORS = {
    reset: "\x1b[0m",
    debug: "\x1b[90m", // Gray
    info: "\x1b[34m",  // Blue
    warn: "\x1b[33m",  // Yellow
    error: "\x1b[31m", // Red
};

const write = (level, message, details) => {
    if (LEVELS[level] < minLevel) return;
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const line = `${COLORS[level]}${time} [${level.toUpperCase()}]${COLORS.reset} ${message}`;
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    // Details may be an Error or plain data (e.g. an API response body); print whichever it is
    if (details !== undefined && details !== null) out(line, '\n', details?.stack ?? details);
    else out(line);
};

const debug = (message, details) => write('debug', message, details);
const info = (message, details) => write('info', message, details);
const log = info;
const warn = (message, details) => write('warn', message, details);
const error = (message, details) => write('error', message, details);

module.exports = { log, debug, info, warn, error };
