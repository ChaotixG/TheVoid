// Level curve. Members store only their total XP; the level is always derived from it,
// so the curve can be changed later without corrupting anyone's progress.

// XP needed to go from `level` to `level + 1` (100 × level, the bot's original curve)
const xpForNextLevel = (level) => 100 * level;

// Total XP needed to reach `level`, starting from level 1
const totalXpForLevel = (level) => 50 * (level - 1) * level;

function levelFromTotalXp(totalXp) {
    // Inverse of totalXpForLevel, then corrected for floating point at exact boundaries
    let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, totalXp)) / 100)) / 2));
    while (totalXpForLevel(level + 1) <= totalXp) level++;
    while (level > 1 && totalXpForLevel(level) > totalXp) level--;
    return level;
}

// Progress within the current level, for rank cards and leaderboards
function levelProgress(totalXp) {
    const level = levelFromTotalXp(totalXp);
    return {
        level,
        xpIntoLevel: totalXp - totalXpForLevel(level),
        xpForNext: xpForNextLevel(level),
    };
}

module.exports = { xpForNextLevel, totalXpForLevel, levelFromTotalXp, levelProgress };
