// Draws the /rank card. Used by /rank and by /shop (to preview custom colors).
// A theme decides the colors; premium custom themes can use hex codes and gradients.
const { ActivityType } = require('discord.js');
const canvacord = require('canvacord');
const sharp = require('sharp');
const Member = require('../../models/Member');
const { levelProgress } = require('../../utils/leveling');
const { getWallet } = require('../../services/wallet');
const { isPremium } = require('../../services/premium');
const { THEMES, CARD_THEMES_ENABLED, CUSTOM_CARD_COLORS_ENABLED } = require('../../config/economy');

canvacord.Font.loadDefault(); // load the font once, not on every card

// ─── Colors ───────────────────────────────────────────────────
/** "#abc", "abc", "#aabbcc" or "aabbcc" → "#aabbcc"; null if it isn't a hex color */
function normalizeHex(value) {
    const raw = String(value ?? '').trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split('').map(c => c + c).join('')}`;
    if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
    return null;
}

// Perceived brightness, 0 (black) to 1 (white)
function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

const gradient = (colors, angle) => `linear-gradient(${angle}deg, ${colors.join(', ')})`;

/**
 * A premium custom theme from the colors saved in /shop. The background (with optional gradient)
 * fills the card; the accent (with optional gradient) colors the bar, the name and the frame.
 * The inner box is a tint over the background so text stays readable on any color.
 */
function customTheme({ background, background2, accent, accent2 }) {
    const light = luminance(background2 ? mixHex(background, background2) : background) > 0.6;
    return {
        id: 'custom',
        outer: background,
        outerGradient: background2 ? [background, background2] : null,
        background: light ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.28)',
        border: accent,
        track: light ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)',
        accent,
        accentGradient: accent2 ? [accent, accent2] : null,
        light,
    };
}

function mixHex(a, b) {
    const parts = [1, 3, 5].map(i => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2));
    return `#${parts.map(p => p.toString(16).padStart(2, '0')).join('')}`;
}

const DEFAULT_THEME = THEMES.find(t => t.id === 'default');

/** The theme the member equipped; the default look when themes are off or premium has lapsed */
async function resolveCardTheme(client, userId) {
    if (!CARD_THEMES_ENABLED) return DEFAULT_THEME;
    const wallet = await getWallet(userId);
    if (wallet.equippedTheme === 'custom') {
        if (!CUSTOM_CARD_COLORS_ENABLED || !wallet.customTheme?.background || !await isPremium(client, userId)) return DEFAULT_THEME;
        return customTheme(wallet.customTheme);
    }
    const theme = THEMES.find(t => t.id === wallet.equippedTheme) ?? DEFAULT_THEME;
    if (theme.premium && !await isPremium(client, userId)) return DEFAULT_THEME;
    return theme;
}

// ─── Drawing ──────────────────────────────────────────────────
function presenceColor(member) {
    const statusColors = { online: '#489c54', idle: '#bf9353', dnd: '#cb3543', invisible: '#181818', offline: '#181818' };
    const activityColors = {
        [ActivityType.Playing]: '#2edb48',
        [ActivityType.Streaming]: '#d4382a',
        [ActivityType.Listening]: '#489c54',
        [ActivityType.Watching]: '#d45a2a',
        [ActivityType.Competing]: '#FFD700',
        [ActivityType.Custom]: '#EB459E',
    };
    const activity = member.presence?.activities[0];
    if (activity && activity.type in activityColors) return activityColors[activity.type];
    return statusColors[member.presence?.status || 'offline'] || '#2C2F33';
}

/** Draws the card and returns a PNG buffer */
async function renderRankCard({ member, level, xpIntoLevel, xpForNext, position, theme }) {
    const roleHex = `#${member.displayColor.toString(16).padStart(6, '0')}`;
    const accent = theme.accent ?? roleHex;
    const darkText = theme.light ? { color: '#1e1e1e' } : null;

    const card = new canvacord.RankCardBuilder()
        .setDisplayName(member.displayName)
        .setUsername(member.user.username)
        .setAvatar(member.user.displayAvatarURL({ size: 256 }))
        .setCurrentXP(xpIntoLevel)
        .setRequiredXP(xpForNext)
        .setLevel(level)
        .setRank(position)
        .setStyles({
            container: {
                style: {
                    backgroundColor: theme.background, // inner box
                    border: `6px solid ${theme.border}`,
                    borderRadius: '16px',
                    padding: '8px',
                },
            },
            // A gradient fills the whole card (the overlay layer is turned off below, so there's no seam)
            background: theme.outerGradient ? { style: { backgroundImage: gradient(theme.outerGradient, 135) } } : undefined,
            avatar: {
                image: {
                    style: {
                        width: '160px',
                        height: '160px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: `7px solid ${presenceColor(member)}`,
                    },
                },
            },
            progressbar: {
                thumb: {
                    style: {
                        backgroundColor: accent,
                        ...(theme.accentGradient ? { backgroundImage: gradient(theme.accentGradient, 90) } : {}),
                    },
                },
                // The empty part of the bar; null keeps the library default
                track: theme.track ? { style: { backgroundColor: theme.track } } : undefined,
            },
            username: {
                handle: { style: { color: theme.light ? '#444444' : '#aaaaaa', fontSize: 14 } },
                name: { style: { color: accent, fontSize: 34 } },
            },
            // Stat labels and numbers switch to dark on light backgrounds
            statistics: darkText ? {
                level: { text: { style: { color: '#444444' } }, value: { style: darkText } },
                xp: { text: { style: { color: '#444444' } }, value: { style: darkText } },
                rank: { text: { style: { color: '#444444' } }, value: { style: darkText } },
            } : undefined,
        });

    if (theme.outer) card.setBackground(theme.outer).setOverlay(theme.outerGradient ? false : theme.outer);

    const raw = await card.build();
    return roundAndBorder(raw, theme.accentGradient ?? [accent]);
}

// Rounds the corners and adds the outer frame (solid, or a gradient when given two colors)
async function roundAndBorder(data, colors, radius = 24, border = 12) {
    const { width, height } = await sharp(data).metadata();

    const roundedInner = await sharp(data)
        .composite([{
            input: Buffer.from(`<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff" /></svg>`),
            blend: 'dest-in',
        }])
        .png()
        .toBuffer();

    const totalWidth = width + border * 2;
    const totalHeight = height + border * 2;
    const fill = colors.length > 1 ? 'url(#frame)' : colors[0];
    const defs = colors.length > 1
        ? `<defs><linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">${colors.map((c, i) => `<stop offset="${i / (colors.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`
        : '';
    const frame = Buffer.from(`<svg width="${totalWidth}" height="${totalHeight}">${defs}<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" rx="${radius + border}" ry="${radius + border}" fill="${fill}" /></svg>`);

    return sharp(frame)
        .composite([{ input: roundedInner, top: border, left: border }])
        .png()
        .toBuffer();
}

/** Looks up the member's level and rank in this server and draws their card */
async function cardForMember(client, guild, member) {
    const record = await Member.findOne({ guildId: guild.id, userId: member.id }, { totalXp: 1 }).lean();
    const totalXp = record?.totalXp ?? 0;
    // Same ordering as /leaderboard: most XP first, ties broken by user ID
    const position = 1 + await Member.countDocuments({
        guildId: guild.id,
        $or: [{ totalXp: { $gt: totalXp } }, { totalXp, userId: { $lt: member.id } }],
    });
    const theme = await resolveCardTheme(client, member.id);
    return renderRankCard({ member, ...levelProgress(totalXp), position, theme });
}

module.exports = { renderRankCard, cardForMember, resolveCardTheme, customTheme, normalizeHex, luminance };
