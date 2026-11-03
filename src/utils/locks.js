// Runs async work one at a time per key (e.g. one shop purchase per member and role), so two
// quick clicks, or a purchase and the expiry sweeper, can't interleave.
const chains = new Map(); // key → tail promise

async function withLock(key, fn) {
    const previous = chains.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    try {
        return await run;
    } finally {
        if (chains.get(key) === tail) chains.delete(key);
    }
}

module.exports = { withLock };
