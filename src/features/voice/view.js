// The control panel posted in each temporary voice channel's text chat.
const { container, row, button, panelPayload, ButtonStyle } = require('../../utils/panels');

function voicePanel(channel, ownerId, locked) {
    const owner = ownerId ? `<@${ownerId}>` : '*nobody · use Claim*';
    return panelPayload(container([
        `### 🔊 ${channel.name}\nOwner: ${owner} · ${locked ? '🔒 Locked' : '🔓 Open'} · Limit: ${channel.userLimit || 'none'}`,
        row(
            button('vc:rename', 'Rename', ButtonStyle.Secondary, { emoji: '✏️' }),
            button('vc:limit', 'Limit', ButtonStyle.Secondary, { emoji: '👥' }),
            locked
                ? button('vc:unlock', 'Unlock', ButtonStyle.Secondary, { emoji: '🔓' })
                : button('vc:lock', 'Lock', ButtonStyle.Secondary, { emoji: '🔒' }),
        ),
        row(
            button('vc:transfer', 'Transfer', ButtonStyle.Secondary, { emoji: '👑' }),
            button('vc:claim', 'Claim', ButtonStyle.Secondary, { emoji: '🙋' }),
        ),
        '-# Only the owner or moderators can use these. **Claim** works once the owner has left.',
    ], 0x5865F2));
}

module.exports = { voicePanel };
