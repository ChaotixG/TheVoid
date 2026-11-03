// Every coin amount in the bot. These are deliberately fixed in code (not per-server settings):
// each member has one wallet across all servers, so the rules have to be the same everywhere.
module.exports = {
    CURRENCY: { name: 'coins', emoji: '🪙' },

    // /daily: base + streak bonus; the streak continues if claimed within 48h of the last claim
    DAILY: { base: 200, streakBonus: 20, maxStreakBonus: 200, cooldownHours: 24, streakWindowHours: 48 },
    WEEKLY: { amount: 1000, cooldownDays: 7 },

    // Chatting: once per cooldown per person, across all servers
    CHAT: { min: 1, max: 3, cooldownSeconds: 60 },
    // Voice: paid every interval to people talking with at least one other person
    VOICE: { amount: 2, intervalMinutes: 5 },

    // /pay: the tax is destroyed, which keeps coins from piling up
    PAY: { taxPercent: 5, min: 10, max: 1_000_000 },

    // Role shop limits (admins choose the roles and prices)
    SHOP: { maxRoles: 25, maxPrice: 10_000_000, durations: [0, 1, 7, 30] }, // days; 0 = permanent

    // Premium perks (granted only by the bot owner; see services/premium.js)
    PREMIUM: { dailyMultiplier: 2, weeklyMultiplier: 2, coinMultiplier: 1.5, xpMultiplier: 1.25 },

    // /rank card themes, bought with coins in /shop by anyone. `accent: null` uses the member's role color.
    // Approved from rendered previews. While off, /shop shows "coming soon" and /rank always uses
    // the default look (identical to the card before themes existed).
    CARD_THEMES_ENABLED: true,
    // Colors: outer = the card around the inner box; background/border = the inner box;
    // track = the empty part of the progress bar. null = the card library default (Default theme).
    THEMES: [
        { id: 'default', name: 'Default', price: 0, outer: null, background: '#23272b', border: '#484b51', track: null, accent: null },
        { id: 'midnight', name: 'Midnight', price: 500, outer: '#0a1020', background: '#0f1729', border: '#1e2a4a', track: '#1a2440', accent: '#6c8cff' },
        { id: 'forest', name: 'Forest', price: 750, outer: '#0d1f14', background: '#132a1c', border: '#24452f', track: '#1c3826', accent: '#4caf50' },
        { id: 'sunset', name: 'Sunset', price: 1000, outer: '#1f0f17', background: '#2b1620', border: '#4a2433', track: '#3a1c29', accent: '#ff7a59' },
        { id: 'ocean', name: 'Ocean', price: 1000, outer: '#081a26', background: '#0d2230', border: '#17394f', track: '#122e40', accent: '#29b6f6' },
        { id: 'neon', name: 'Neon', price: 2500, outer: '#0a0714', background: '#120d1f', border: '#ff00ff', track: '#22183a', accent: '#00ffd5' },
        { id: 'gold', name: 'Gold', price: 5000, outer: '#16120a', background: '#1f1a0d', border: '#d4af37', track: '#2e2714', accent: '#ffd700' },
        { id: 'void', name: 'The Void', price: 5000, outer: '#000000', background: '#050505', border: '#5a4786', track: '#151022', accent: '#9b7bea' },
    ],
};
