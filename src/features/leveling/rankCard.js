// Draws the /rank card. Used by /rank and by /shop (to preview the custom theme).
// A theme decides the colors; the premium custom theme adds gradients and a background picture.
const { ActivityType } = require('discord.js');
const canvacord = require('canvacord');
const sharp = require('sharp');
const Member = require('../../models/Member');
const CardImage = require('../../models/CardImage');
const { levelProgress } = require('../../utils/leveling');
const { getWallet } = require('../../services/wallet');
const { getGuildSettings } = require('../../services/guildSettings');
const { isPremium } = require('../../services/premium');
const { THEMES, CARD_THEMES_ENABLED, CUSTOM_CARD_COLORS_ENABLED, CUSTOM_THEME } = require('../../config/economy');

canvacord.Font.loadDefault(); // load the font once, not on every card

// The card as the library draws it, before the outer frame is added
const CARD_WIDTH = 930;
const CARD_HEIGHT = 280;

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

function mixHex(a, b) {
    const parts = [1, 3, 5].map(i => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2));
    return `#${parts.map(p => p.toString(16).padStart(2, '0')).join('')}`;
}

// Gradient directions (one of each mirrored pair): CSS for the card itself, SVG for the frame,
// and the 0→1 position of a point (u, v = 0→1 across and down a box) for blending pixels
const DIRECTIONS = {
    lr: { css: '90deg', svg: [0, 0, 1, 0], at: (u) => u },
    bt: { css: 'to top', svg: [0, 1, 0, 0], at: (u, v) => 1 - v },
    bltr: { css: 'to top right', svg: [0, 1, 1, 0], at: (u, v) => (u + 1 - v) / 2 },
    tlbr: { css: 'to bottom right', svg: [0, 0, 1, 1], at: (u, v) => (u + v) / 2 },
};

const cssGradient = ({ colors, direction }) => `linear-gradient(${DIRECTIONS[direction].css}, ${colors.join(', ')})`;

/** One part of a saved custom theme as { colors, direction }: one color, or two for a gradient */
function paint(part, fallback) {
    const color = normalizeHex(part?.color) ?? fallback;
    const color2 = part?.mode === 'gradient' ? normalizeHex(part.color2) : null;
    if (!color2) return { colors: [color], direction: 'lr' };
    return { colors: [color, color2], direction: DIRECTIONS[part.direction] ? part.direction : 'lr' };
}

/**
 * The premium custom theme saved in /shop. The background (or picture) fills the card, the inner
 * card sits on top of it, and the outline colors both frames, the progress bar and the name.
 * `image` is the background picture, when the member chose one and the server allows it.
 */
function customTheme(saved, { image = null } = {}) {
    const { defaults } = CUSTOM_THEME;
    const background = paint(saved.background, defaults.background);
    const inner = paint(saved.inner, defaults.inner);
    const outline = paint(saved.outline, defaults.outline);
    const light = luminance(inner.colors.length > 1 ? mixHex(...inner.colors) : inner.colors[0]) > 0.6;
    return {
        id: 'custom',
        outer: background.colors[0],
        outerGradient: background.colors.length > 1 ? background : null,
        outerImage: image,
        background: inner.colors[0],
        innerGradient: inner.colors.length > 1 ? inner : null,
        border: outline.colors[0],
        borderGradient: outline.colors.length > 1 ? outline : null,
        track: light ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)',
        accent: outline.colors[0],
        light,
    };
}

const DEFAULT_THEME = THEMES.find(t => t.id === 'default');

// The member's saved custom theme with its picture (without one, the background falls back to its color)
async function savedCustomTheme(userId, saved, { allowImage }) {
    const image = allowImage && saved.hasImage && saved.background?.mode === 'image'
        ? (await CardImage.findOne({ userId }))?.data ?? null
        : null;
    return customTheme(saved, { image });
}

/**
 * The theme the member equipped; the default look when themes are off or premium has lapsed.
 * `allowImage` is false in servers that turned off custom background pictures.
 */
async function resolveCardTheme(client, userId, { allowImage = true } = {}) {
    if (!CARD_THEMES_ENABLED) return DEFAULT_THEME;
    const wallet = await getWallet(userId);
    if (wallet.equippedTheme === 'custom') {
        const saved = wallet.customTheme;
        if (!CUSTOM_CARD_COLORS_ENABLED || !saved?.owned || !await isPremium(client, userId)) return DEFAULT_THEME;
        return savedCustomTheme(userId, saved, { allowImage });
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
    const outline = theme.borderGradient;

    // Draws the card with the inner card's outline in one color
    const draw = (borderColor, avatar) => {
        const card = new canvacord.RankCardBuilder()
            .setDisplayName(member.displayName)
            .setUsername(member.user.username)
            .setAvatar(avatar)
            .setCurrentXP(xpIntoLevel)
            .setRequiredXP(xpForNext)
            .setLevel(level)
            .setRank(position)
            .setStyles({
                container: {
                    style: {
                        backgroundColor: theme.background, // inner card
                        ...(theme.innerGradient ? { backgroundImage: cssGradient(theme.innerGradient) } : {}),
                        border: `6px solid ${borderColor}`,
                        borderRadius: '16px',
                        padding: '8px',
                    },
                },
                // A gradient fills the whole card (the overlay layer is turned off below, so there's no seam)
                background: theme.outerGradient && !theme.outerImage ? { style: { backgroundImage: cssGradient(theme.outerGradient) } } : undefined,
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
                    // The bar follows the outline colors but always fills left to right
                    thumb: {
                        style: {
                            backgroundColor: accent,
                            ...(outline ? { backgroundImage: cssGradient({ colors: outline.colors, direction: 'lr' }) } : {}),
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

        if (theme.outerImage) card.setBackground(theme.outerImage).setOverlay(false);
        else if (theme.outer) card.setBackground(theme.outer).setOverlay(theme.outerGradient ? false : theme.outer);
        return card.build();
    };

    const avatarUrl = member.user.displayAvatarURL({ size: 256 });
    let raw;
    if (outline) {
        const avatar = await canvacord.loadImage(avatarUrl); // fetched once for both drawings
        const [first, second] = await Promise.all(outline.colors.map(color => draw(color, avatar)));
        raw = await blendOutline(first, second, outline.direction);
    } else {
        raw = await draw(theme.border, avatarUrl);
    }
    return roundAndBorder(raw, outline ?? { colors: [accent], direction: 'lr' });
}

// The card library can't draw a gradient outline, so the card is drawn once in each outline color
// and the two are mixed pixel by pixel across the outline's box (the only pixels that differ)
async function blendOutline(first, second, direction) {
    const [a, b] = await Promise.all([first, second].map(png => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    const { width, height, channels } = a.info;

    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            if (a.data.readUInt32BE(i) !== b.data.readUInt32BE(i)) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    if (right < 0) return first; // both colors were the same

    const out = Buffer.from(a.data);
    const at = DIRECTIONS[direction].at;
    const spanX = Math.max(1, right - left);
    const spanY = Math.max(1, bottom - top);
    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            const t = at((x - left) / spanX, (y - top) / spanY);
            const i = (y * width + x) * channels;
            for (let c = 0; c < channels; c++) out[i + c] = Math.round(a.data[i + c] + (b.data[i + c] - a.data[i + c]) * t);
        }
    }
    return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

// Rounds the corners and adds the outer frame (solid, or a gradient in the given direction)
async function roundAndBorder(data, { colors, direction }, radius = 24, border = 12) {
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
    const [x1, y1, x2, y2] = DIRECTIONS[direction].svg;
    const defs = colors.length > 1
        ? `<defs><linearGradient id="frame" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${colors.map((c, i) => `<stop offset="${i / (colors.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`
        : '';
    const frame = Buffer.from(`<svg width="${totalWidth}" height="${totalHeight}">${defs}<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" rx="${radius + border}" ry="${radius + border}" fill="${fill}" /></svg>`);

    return sharp(frame)
        .composite([{ input: roundedInner, top: border, left: border }])
        .png()
        .toBuffer();
}

/** Crops an uploaded picture to fill the card and re-encodes it small (stored in CardImage) */
function prepareBackgroundImage(input) {
    return sharp(input, { limitInputPixels: 40_000_000 })
        .rotate() // follow the photo's orientation tag
        .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
}

/**
 * Looks up the member's level and rank in this server and draws their card.
 * `customPreview` draws their custom theme even if it isn't equipped (for the /shop preview).
 */
async function cardForMember(client, guild, member, { customPreview = false } = {}) {
    const record = await Member.findOne({ guildId: guild.id, userId: member.id }, { totalXp: 1 }).lean();
    const totalXp = record?.totalXp ?? 0;
    // Same ordering as /leaderboard: most XP first, ties broken by user ID
    const position = 1 + await Member.countDocuments({
        guildId: guild.id,
        $or: [{ totalXp: { $gt: totalXp } }, { totalXp, userId: { $lt: member.id } }],
    });
    const { economy } = await getGuildSettings(guild.id);
    const allowImage = economy.allowCardImages !== false;
    const theme = customPreview
        ? await savedCustomTheme(member.id, (await getWallet(member.id)).customTheme ?? {}, { allowImage })
        : await resolveCardTheme(client, member.id, { allowImage });
    return renderRankCard({ member, ...levelProgress(totalXp), position, theme });
}

module.exports = { renderRankCard, cardForMember, resolveCardTheme, customTheme, normalizeHex, luminance, mixHex, prepareBackgroundImage, DIRECTIONS };
