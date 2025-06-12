const { Client, Interaction, ApplicationCommandOptionType, AttachmentBuilder } = require('discord.js');
const canvacord = require('canvacord');
const calculateLevelXp = require('../../utils/calculateLevelXp');
const Server = require('../../models/Server');
const { log, error } = require("../../services/logger")
const sharp = require('sharp');

module.exports = {  
    /**
     * 
     * @param {Client} client
     * @param {Interaction} interaction
     * @param {Buffer} data    - the raw buffer from rank.build()
     * @param {string} roleHex - e.g. '#FF5733'
     * @param {number} radius  - how round the corners are
     * @param {number} border  - thickness of the border
     */

    name: 'rank',
    description: "Shows your/someone's player Card",
    options: [{
        name: 'target-user',
        description: 'The user whose the level you want to see',
        type: ApplicationCommandOptionType.Mentionable,
    }],

    callback: async (client, interaction) => {
        if(!interaction.inGuild()) {interaction.reply({content: "You can only run this command insinde a server.", flags: 64}); return;}
        await interaction.deferReply();

        try {
            const mentionedUser = interaction.options.get('target-user')?.value
            const targetUser = mentionedUser || interaction.user.id; // If user is not provided, use the interaction user
            const targetUserObj = await interaction.guild.members.fetch(targetUser);
            const server = await Server.findOne({ guildId: interaction.guild.id }); // Find the server
            const serverUser = server.users.find(serverUser => serverUser.userId === targetUser); // Find the user in the server
            
            if(!serverUser) {interaction.editReply(
                mentionedUser? `${targetUser.id} doesn't have a profile yet. Try again when they chat a little more.` 
                : "You dont have a profile yet. Chat a little more and try again."
                ); 
                return;
            }


            let allLevels = await server.users.sort((a, b) =>{
                if(a.level === b.level) {
                    return b.xp - a.xp;
                }else{
                return b.level - a.level;
                }
            });
            let currRank = allLevels.findIndex((user) => user.userId === targetUser) + 1;
            log(targetUserObj.user.globalName)
            const roleHex = `#${targetUserObj.displayColor.toString(16).padStart(6, '0')}`;
            canvacord.Font.loadDefault('Arial'); // Load the default font
            const rank = new canvacord.RankCardBuilder()
            .setDisplayName(targetUserObj.user.globalName) // Big name
            .setUsername(targetUserObj.user.username) // small name, do not include it if you want to hide it
            .setAvatar(targetUserObj.user.displayAvatarURL({ size: 256 })) // Avatar from the user object
            .setCurrentXP(serverUser.xp)
            .setRequiredXP(calculateLevelXp(serverUser.level))
            .setLevel(serverUser.level)
            .setRank(currRank)
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
            interaction.editReply({files: [attachement]});
            log(`#${targetUserObj.displayColor.toString(16).padStart(6, '0')}`);


        }catch (err) {
            error(`Error finding user in server: `, err);
        }
    }
}
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
    PLAYING:   '#2edb48', // blurple
    STREAMING: '#d4382a', // red‑orange
    LISTENING: '#489c54', // green
    WATCHING:  '#d45a2a', // orange‑yellow
    COMPETING: '#FFD700', // gold
    CUSTOM:    '#EB459E'  // fuchsia (for custom statuses)
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


