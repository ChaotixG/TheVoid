// /ticket flow and the buttons on ticket messages ("ticket:*" custom IDs, plus legacy IDs).
const { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const buildModal = require('../../utils/buildModal');
const { getGuildSettings } = require('../../services/guildSettings');
const { TICKET_TYPES, LEGACY_FORM_IDS } = require('./types');
const { TicketError, createTicket, creatorFromMessage, canManageTicket, archiveTicket, deleteTicket } = require('./tickets');
const { ephemeral } = require('../../utils/interactionReplies');

const NOT_SET_UP = 'Tickets aren\'t set up here yet. An admin can set them up in **/settings → Tickets**.';

function availableTypes(settings) {
    return Object.entries(TICKET_TYPES).filter(([, type]) => settings.tickets[type.settingsKey]?.channelId);
}

const ticketForm = (typeKey) => {
    const { form } = TICKET_TYPES[typeKey];
    return buildModal(`ticket:form:${typeKey}`, form.title, form.inputs);
};

// ─── /ticket ──────────────────────────────────────────────────
async function openTicketMenu(interaction) {
    const types = availableTypes(await getGuildSettings(interaction.guildId));
    if (!types.length) return interaction.reply(ephemeral(NOT_SET_UP));

    // Only one kind of ticket: skip the menu and open its form right away
    if (types.length === 1) return interaction.showModal(ticketForm(types[0][0]));

    const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket:type')
        .setPlaceholder('Select ticket type')
        .addOptions(types.map(([value, type]) => ({ label: type.label, description: type.description, value })));

    return interaction.reply({
        content: 'What kind of ticket do you want to open?',
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral,
    });
}

// ─── Interactions ─────────────────────────────────────────────
async function handleInteraction(client, interaction) {
    const id = interaction.customId;

    if (interaction.isStringSelectMenu() && (id === 'ticket:type' || id === 'ticketType')) {
        const typeKey = interaction.values[0];
        if (!TICKET_TYPES[typeKey]) return interaction.reply(ephemeral('That ticket type no longer exists.'));
        return interaction.showModal(ticketForm(typeKey));
    }

    if (interaction.isModalSubmit()) {
        const typeKey = id.startsWith('ticket:form:') ? id.slice('ticket:form:'.length) : LEGACY_FORM_IDS[id];
        if (TICKET_TYPES[typeKey]) return submitTicket(interaction, typeKey);
        return;
    }

    if (interaction.isButton()) {
        if (id === 'ticket:archive' || id === 'archive_ticket') return handleTicketButton(interaction, 'archive');
        if (id === 'ticket:delete' || id === 'delete_ticket') return handleTicketButton(interaction, 'delete');
    }
}

async function submitTicket(interaction, typeKey) {
    // From the type menu: replace the menu with the result. Opened directly by /ticket: reply.
    const fromMenu = interaction.isFromMessage();
    if (fromMenu) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const respond = (content) => interaction.editReply({ content, components: [] });

    const type = TICKET_TYPES[typeKey];
    const settings = await getGuildSettings(interaction.guildId);
    const target = settings.tickets[type.settingsKey];
    if (!target?.channelId) return respond('This ticket type was just turned off. Please try another one.');

    const fields = interaction.fields;
    const values = {
        title: fields.getTextInputValue('title').trim(),
        description: fields.getTextInputValue('description').trim(),
        reportedUserIds: fields.fields.has('reportedUser') ? [...(fields.getSelectedUsers('reportedUser')?.keys() ?? [])] : [],
    };

    try {
        const thread = await createTicket({
            guild: interaction.guild,
            user: interaction.user,
            type,
            values,
            target,
            staffRoleIds: settings.staffRoleIds,
        });
        return respond(`✅ Your ticket was created: <#${thread.id}>`);
    } catch (err) {
        if (err instanceof TicketError) return respond(`❌ ${err.message}`);
        throw err;
    }
}

async function handleTicketButton(interaction, action) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // lookups below may take a moment
    const thread = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId);
    const settings = await getGuildSettings(interaction.guildId);
    const creatorId = creatorFromMessage(interaction.message);

    if (!canManageTicket(interaction, creatorId, settings.staffRoleIds)) {
        return interaction.editReply(`You don't have permission to ${action} this ticket.`);
    }

    try {
        if (action === 'archive') {
            await archiveTicket(thread, interaction.user);
            return interaction.editReply('🗄️ Ticket archived. Sending a message in it will reopen it.');
        }
        // The thread (and this reply with it) is gone once this succeeds
        await deleteTicket(thread, interaction.user, { transcriptChannelId: settings.tickets.transcriptChannelId, creatorId });
    } catch (err) {
        if (err instanceof TicketError) return interaction.editReply(`❌ ${err.message}`);
        throw err;
    }
}

module.exports = { openTicketMenu, handleInteraction };
