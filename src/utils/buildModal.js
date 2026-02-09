const {
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} = require('discord.js');

module.exports = (customId, title, inputs) => {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    for (const input of inputs) {
        const type = input.type ?? 'text';

        if (type === 'text') {
            const textInput = new TextInputBuilder()
                .setCustomId(input.customId)
                .setStyle(input.style)
                .setRequired(input.required ?? false);

            if (input.placeholder) textInput.setPlaceholder(input.placeholder);
            if (input.minLength) textInput.setMinLength(input.minLength);
            if (input.maxLength) textInput.setMaxLength(input.maxLength);

            const label = new LabelBuilder()
                .setLabel(input.label)
                .setTextInputComponent(textInput);

            if (input.description) label.setDescription(input.description);

            modal.addLabelComponents(label);
        }
        else if (type === 'label' && input.component?.type === 'userSelect') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId(input.component.customId)
                .setPlaceholder(input.component.placeholder ?? '')
                .setRequired(input.required ?? false);

            if (input.component.minValues) userSelect.setMinValues(input.component.minValues);
            if (input.component.maxValues) userSelect.setMaxValues(input.component.maxValues);

            const label = new LabelBuilder()
                .setLabel(input.label)
                .setUserSelectMenuComponent(userSelect);

            if (input.description) label.setDescription(input.description);

            modal.addLabelComponents(label);
        }
        else {
            throw new Error(`Unsupported modal input type: ${type}`);
        }
    }

    return modal;
};