const DEBUG_MODE = true;

const COLORS = {
    reset: "\x1b[0m",
    info: "\x1b[34m", // Blue
    warn: "\x1b[33m", // Yellow
    error: "\x1b[31m", // Red
};

const log = (level, message, error = null) => {
    let levelColor = COLORS.reset;
    let messageColor = COLORS.reset;

    // Handle the error case separately to avoid recursion
    if (level === "error" && error) {
        levelColor = COLORS.error;
        messageColor = COLORS.error;
        console.error(`${levelColor}[${level.toUpperCase()}]${COLORS.reset} ${messageColor}- ${message}\n`, error.stack, COLORS.reset);
    } else if (DEBUG_MODE) {
        switch (level.toLowerCase()) {
            case 'info':
                levelColor = COLORS.info;
                messageColor = COLORS.info;
                console.log(`${levelColor}[${level.toUpperCase()}]${COLORS.reset} ${messageColor}- ${message}${COLORS.reset}`);
                break;
            case 'warn':
                levelColor = COLORS.warn;
                messageColor = COLORS.warn;
                console.warn(`${levelColor}[${level.toUpperCase()}]${COLORS.reset} ${messageColor}- ${message}${COLORS.reset}`);
                break;
            case 'error':
                levelColor = COLORS.error;
                messageColor = COLORS.error;
                console.error(`${levelColor}[${level.toUpperCase()}]${COLORS.reset} ${messageColor}- ${message}${COLORS.reset}`);
                break;
            default:
                // Default to console.log for any unknown levels
                console.log(`${levelColor}[${level}]${COLORS.reset} ${messageColor}`/*- ${message}${COLORS.reset}`*/);
                break;
        }
    }
};

const info = (message) => log('info', message);
const warn = (message) => log('warn', message);
const error = (message, error) => log('error', message, error);

module.exports = { log, info, warn, error };
