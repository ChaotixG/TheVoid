// The ticket types members can open. `settingsKey` is where /settings stores each type's channel.
// `tagNames`: in a forum, posts get the first tag whose name contains one of these words.
const TICKET_TYPES = {
    troubleshooting: {
        settingsKey: 'troubleshooting',
        label: 'Support',
        description: 'Request general support.',
        tagNames: ['support', 'troubleshoot', 'help'],
        form: require('../../modals/tickets/troubleshooting'),
    },
    suggestion: {
        settingsKey: 'suggestions',
        label: 'Suggestion',
        description: 'Suggest a new feature for the server.',
        tagNames: ['suggestion', 'idea', 'feature'],
        form: require('../../modals/tickets/suggestion'),
    },
    issue: {
        settingsKey: 'complaints',
        label: 'Issue / Complaint',
        description: 'Report a bug or user issue.',
        tagNames: ['complaint', 'issue', 'report', 'bug'],
        form: require('../../modals/tickets/issue'),
    },
};

// Tags preferred for transcript posts when the transcripts channel is a forum
const TRANSCRIPT_TAG_NAMES = ['transcript', 'closed', 'archive', 'log'];

// Form IDs used before custom IDs were namespaced (forms opened just before an update)
const LEGACY_FORM_IDS = {
    ticket_troubleshooting: 'troubleshooting',
    ticket_suggestion: 'suggestion',
    ticket_complaint: 'issue',
};

module.exports = { TICKET_TYPES, TRANSCRIPT_TAG_NAMES, LEGACY_FORM_IDS };
