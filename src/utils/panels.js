// Small helpers for Components V2 messages ("panels"), so features build them the same way.
// Keeping builder usage here also limits what a future discord.js upgrade has to touch.
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MessageFlags,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} = require('discord.js');

const text = (content) => new TextDisplayBuilder().setContent(content);

const separator = (divider = true) =>
    new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);

// `label` may be null for emoji-only buttons (game boards); a button needs a label or an emoji
const button = (customId, label, style = ButtonStyle.Secondary, { disabled = false, emoji } = {}) => {
    const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(disabled);
    if (label) b.setLabel(label);
    if (emoji) b.setEmoji(emoji);
    if (!label && !emoji) b.setLabel('​'); // blank square (e.g. an empty board cell)
    return b;
};

// A button that opens a URL (e.g. a jump link into a server) instead of sending an interaction
const linkButton = (url, label, emoji) => {
    const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label);
    if (emoji) b.setEmoji(emoji);
    return b;
};

const row = (...components) => new ActionRowBuilder().addComponents(...components);

// A picture in a panel, e.g. gallery('attachment://board.png') for a file sent with the message
const gallery = (url, description) => new MediaGalleryBuilder().addItems(item => {
    item.setURL(url);
    if (description) item.setDescription(description);
    return item;
});

// Text with a button on its right
const section = (content, accessory) =>
    new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(accessory);

/**
 * Builds a container from a list of parts. Strings become text displays; `null`/`false`
 * entries are skipped so optional parts can be written inline.
 */
function container(parts, accentColor) {
    const c = new ContainerBuilder();
    if (accentColor !== undefined) c.setAccentColor(accentColor);
    for (const part of parts) {
        if (!part) continue;
        if (typeof part === 'string') c.addTextDisplayComponents(text(part));
        else if (part instanceof TextDisplayBuilder) c.addTextDisplayComponents(part);
        else if (part instanceof SectionBuilder) c.addSectionComponents(part);
        else if (part instanceof SeparatorBuilder) c.addSeparatorComponents(part);
        else if (part instanceof ActionRowBuilder) c.addActionRowComponents(part);
        else if (part instanceof MediaGalleryBuilder) c.addMediaGalleryComponents(part);
        else throw new Error(`Unsupported panel part: ${part?.constructor?.name}`);
    }
    return c;
}

/**
 * Message payload for a V2 panel. Mentions render but never ping.
 * `convert: true` is for turning a deferred/plain reply into a panel (content/embeds must be cleared).
 */
function panelPayload(containerBuilder, { convert = false } = {}) {
    const payload = {
        flags: MessageFlags.IsComponentsV2,
        components: [containerBuilder],
        allowedMentions: { parse: [] },
    };
    if (convert) Object.assign(payload, { content: null, embeds: [] });
    return payload;
}

module.exports = { text, separator, button, linkButton, row, gallery, section, container, panelPayload, ButtonStyle };
