const { ActivityType, ApplicationIntegrationType, AttachmentBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const canvacord = require('canvacord');
const sharp = require('sharp');
const Member = require('../../models/Member');
const { levelProgress } = require('../../utils/leveling');

canvacord.Font.loadDefault(); // load the font once, not on every /rank

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription("Shows your/someone's player Card")
        .addUserOption(o => o.setName('user').setDescription('Whose card to show'))
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    callback: async (client, interaction) => {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const self = user.id === interaction.user.id;
        if (user.bot) return interaction.reply({ content: 'Bots don\x27t earn XP.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply();

        const targetUserObj = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!targetUserObj) return interaction.editReply('They\x27re not in this server.');

        const record = await Member.findOne({ guildId: interaction.guildId, userId: user.id }, { totalXp: 1 }).lean();
        if (!record?.totalXp) {
            return interaction.editReply({
                content: self ? "You don't have a profile yet. Chat a little more and try again." : `<@${user.id}> doesn't have a profile yet. Try again when they chat a little more.`,
                allowedMentions: { parse: [] },
            });
        }

        // Same ordering as /leaderboard: most XP first, ties broken by user ID
        const position = 1 + await Member.countDocuments({
            guildId: interaction.guildId,
            $or: [{ totalXp: { $gt: record.totalXp } }, { totalXp: record.totalXp, userId: { $lt: user.id } }],
        });
        const { level, xpIntoLevel, xpForNext } = levelProgress(record.totalXp);

        const roleHex = `#${targetUserObj.displayColor.toString(16).padStart(6, '0')}`;
        const rank = new canvacord.RankCardBuilder()
        .setDisplayName(targetUserObj.displayName) // Big name (globalName is null for some users)
        .setUsername(targetUserObj.user.username) // small name, do not include it if you want to hide it
        .setAvatar(targetUserObj.user.displayAvatarURL({ size: 256 })) // Avatar from the user object
        .setCurrentXP(xpIntoLevel)
        .setRequiredXP(xpForNext)
        .setLevel(level)
        .setRank(position)
        //.setStatus(targetUserObj.presence?.status || 'offline')
        .setFonts({ // Add this line to load fonts
            progress: 'Arial', // For example, use Arial for progress
            level: 'Arial', // Font for level text
            rank: 'Arial', // Font for rank text
            xp: 'Arial', // Font for XP text
            username: 'Arial' // Font for username text
        })
        .setStyles({
            container: {
                style: {
                backgroundColor: '#23272b',   // your card background
                border: `6px solid #484b51`,   // 6px thick border in your chosen color
                borderRadius: '16px',          // match or tweak your corner radius
                padding: '8px'                // keep your inner spacing
                }
            },
            avatar: {
                image: {
                style: {
                    width: '160px',            // avatar diameter
                    height: '160px',
                    borderRadius: '50%',       // keep it round
                    objectFit: 'cover',        // no distortion
                    border: `7px solid ${getPresenceActivityColor(targetUserObj)}` // uniform 7px ring
                }
                }
            },
            progressbar: {
                thumb: {
                    style: {
                        backgroundColor: roleHex
                    }
                },
                background: { style: { backgroundColor: "#2C2F33" } },
                border: { style: { backgroundColor: "#99AAB5" } }
            },
            username: {
                handle: { style: { color: "#aaaaaa", fontSize: 14 } },
                name: { style: { color: roleHex, fontSize: 34 } }
            },
            level: { style: { color: '#FFFFFF', fontSize: 24 } },
            rank: { style: { color: '#FFFFFF', fontSize: 24 } },
            xp: { style: { color: '#FFFFFF', fontSize: 18 } }
            })

        const raw = await rank.build();
        const final = await roundAndBorder(raw, roleHex, 24, 12) // Round corners and add border
        const attachement = new AttachmentBuilder(final);
        await interaction.editReply({files: [attachement]});
    },
};

function getPresenceActivityColor(member) {
  // Define your presence‑status colors
  const statusColors = {
    online:    '#489c54', // green
    idle:      '#bf9353', // yellow
    dnd:       '#cb3543', // red
    invisible: '#181818', // dark gray
    offline:   '#181818'  // dark gray
  };

  // Define your activity colors
  const activityColors = {
    [ActivityType.Playing]:   '#2edb48', // blurple
    [ActivityType.Streaming]: '#d4382a', // red‑orange
    [ActivityType.Listening]: '#489c54', // green
    [ActivityType.Watching]:  '#d45a2a', // orange‑yellow
    [ActivityType.Competing]: '#FFD700', // gold
    [ActivityType.Custom]:    '#EB459E'  // fuchsia (for custom statuses)
  };

  // Grab their first activity, if any
  const activity = member.presence?.activities[0];
  if (activity && activity.type in activityColors) {
    return activityColors[activity.type];
  }

  // Otherwise use their presence status
  const status = member.presence?.status || 'offline';
  return statusColors[status] || '#2C2F33';
}

async function roundAndBorder(data, roleHex, radius = 24, border = 12) {
  const { width, height } = await sharp(data).metadata();

  // 1️⃣ Make the original image rounded
  const roundedInner = await sharp(data)
    .composite([{
      input: Buffer.from(`
        <svg width="${width}" height="${height}">
          <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff" />
        </svg>
      `),
      blend: 'dest-in'
    }])
    .png()
    .toBuffer();

  // 2️⃣ Create the border background with a rounded hole
  const totalWidth = width + border * 2;
  const totalHeight = height + border * 2;
  const borderSvg = Buffer.from(`
    <svg width="${totalWidth}" height="${totalHeight}">
      <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" rx="${radius + border}" ry="${radius + border}" fill="${roleHex}" />
    </svg>
  `);

  // 3️⃣ Composite the rounded image on top, centered
  const final = await sharp(borderSvg)
    .composite([
      {
        input: roundedInner,
        top: border,
        left: border
      }
    ])
    .png()
    .toBuffer();

  return final;
}
