const {
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    UserSelectMenuBuilder,
} = require('discord.js');

module.exports = (customId, title, inputs) => {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    for (const input of inputs) {
        const type = input.type ?? 'text';
        //console.log(input);
        //console.log(input.label);
        if (type === 'text') {
            const textInput = new TextInputBuilder()
                .setCustomId(input.customId)
                .setLabel(input.label)
                .setStyle(input.style)
                .setRequired(input.required ?? true);

            if (input.placeholder) {
                textInput.setPlaceholder(input.placeholder);
            }

            modal.addComponents(
                new ActionRowBuilder().addComponents(textInput)
            );
        }

        else if (type === 'label' && input.component?.type === 'userSelect') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId(input.component.customId)
                .setPlaceholder(input.component.placeholder ?? '')
                .setRequired(input.required ?? false);

            const label = new LabelBuilder()
                .setLabel(input.label)
                .setUserSelectMenuComponent(userSelect);

            modal.addLabelComponents(label);
            continue;
        }

        // ─────────────────────────────
        // UNKNOWN TYPE
        // ─────────────────────────────
        else {
            throw new Error(`Unsupported modal input type: ${input.type}`);
        }
    }

    return modal;
};
