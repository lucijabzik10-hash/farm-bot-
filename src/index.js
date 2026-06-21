require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");

const db = require("./db");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const FARM_CHANNEL_ID = process.env.FARM_CHANNEL_ID;
const HARVEST_ROLE_ID = process.env.HARVEST_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;

const HARVEST_CHANNEL_ID_1 = "1487121637454381243";
const HARVEST_CHANNEL_ID_2 = "1487810730857074790";
const DAILY_REPORT_CHANNEL_ID = "1518237730029437241";

const PLANT_TIMES = {
  "plant_20": 240 * 60 * 1000, // 4h
  "plant_25": 225 * 60 * 1000, // 3h 45min
  "plant_30": 210 * 60 * 1000, // 3h 30min
  "plant_35": 195 * 60 * 1000, // 3h 15min
  "plant_40": 180 * 60 * 1000, // 3h
  "plant_45": 165 * 60 * 1000, // 2h 45min
  "plant_50": 150 * 60 * 1000, // 2h 30min
  "plant_55": 135 * 60 * 1000, // 2h 15min
  "plant_60": 120 * 60 * 1000, // 2h
  "plant_65": 105 * 60 * 1000, // 1h 45min
  "plant_70": 90 * 60 * 1000,  // 1h 30min
  "plant_75": 75 * 60 * 1000,  // 1h 15min
  "plant_80": 60 * 60 * 1000   // 1h
};

const PLANT_TIME_TEXT = `***Vreme trajanja sadnje:

20% = 4h
25% = 3h 45min
30% = 3h 30min
35% =	3h 15min
40%	= 3h
45%	= 2h 45min
50%	= 2h 30min
55%	= 2h 15min
60%	= 2h
65%	= 1h 45min
70%	= 1h 30min
75%	= 1h 15min
80%	= 1h***`;

const activeTimers = new Map();
const harvestedPlantings = new Set();

function normalizeCropName(input) {
  return input.trim().toLowerCase();
}

function formatCropName(input) {
  return input
    .split(" ")
    .map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
}

function parsePlantMessage(content) {
  const match = content
    .trim()
    .match(/^(.+?)\s*(?:x\s*)?(\d+)$/i);

  if (!match) return null;

  const cropKey = normalizeCropName(match[1]);
  const amount = parseInt(match[2], 10);

  if (!cropKey) return null;

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  return {
    cropKey,
    amount
  };
}

function discordTime(ms, format = "f") {
  return `<t:${Math.floor(ms / 1000)}:${format}>`;
}

function getMessageImage(message) {
  const attachment = message.attachments.find(att => {
    if (!att.contentType) {
      return /\.(png|jpe?g|gif|webp)$/i.test(att.name || "");
    }

    return att.contentType.startsWith("image/");
  });

  return attachment ? attachment.url : null;
}

function buildPlantTimeMenu(messageId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`planttime_${messageId}`)
      .setPlaceholder("Izaberi postotak sadnje")
      .addOptions(
        { label: "20% - 4h", value: "plant_20", emoji: "🌱" },
        { label: "25% - 3h 45min", value: "plant_25", emoji: "🌱" },
        { label: "30% - 3h 30min", value: "plant_30", emoji: "🌱" },
        { label: "35% - 3h 15min", value: "plant_35", emoji: "🌱" },
        { label: "40% - 3h", value: "plant_40", emoji: "🌱" },
        { label: "45% - 2h 45min", value: "plant_45", emoji: "🌱" },
        { label: "50% - 2h 30min", value: "plant_50", emoji: "🌱" },
        { label: "55% - 2h 15min", value: "plant_55", emoji: "🌱" },
        { label: "60% - 2h", value: "plant_60", emoji: "🌱" },
        { label: "65% - 1h 45min", value: "plant_65", emoji: "🌱" },
        { label: "70% - 1h 30min", value: "plant_70", emoji: "🌱" },
        { label: "75% - 1h 15min", value: "plant_75", emoji: "🌱" },
        { label: "80% - 1h", value: "plant_80", emoji: "🌱" }
      )
  );
}

function buildPlantEmbed({
  cropName,
  amount,
  userId,
  plantedAt,
  harvestAt,
  imageUrl,
  totalPlantings
}) {

  const embed = new EmbedBuilder()
    .setTitle("🌱 Sadnja zabeležena!")
    .setDescription(`<@${userId}> je posadio/la.`)
    .addFields(
      {
        name: "🌿 Vrsta",
        value: cropName,
        inline: true
      },
      {
        name: "📦 Količina",
        value: String(amount),
        inline: true
      },
      {
        name: "📈 Ukupno sadnji",
        value: String(totalPlantings),
        inline: true
      },
      {
        name: "🕒 Posađeno",
        value: discordTime(plantedAt),
        inline: true
      },
      {
        name: "⏰ Berba",
        value: discordTime(harvestAt),
        inline: true
      },
      {
        name: "📍 Lokacija",
        value: "Ranch",
        inline: true
      }
    )
    .setColor(0x57f287);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildHarvestEmbed({
  cropName,
  amount,
  userId,
  plantedAt,
  harvestAt,
  imageUrl
}) {
  const embed = new EmbedBuilder()
    .setTitle("🚨 Spremno za branje!")
    .setDescription(`<@${userId}> spremno je za branje.`)
    .addFields(
      {
        name: "🌿 Vrsta",
        value: cropName,
        inline: true
      },
      {
        name: "📦 Količina",
        value: String(amount),
        inline: true
      },
      {
        name: "🕒 Posađeno",
        value: discordTime(plantedAt),
        inline: true
      },
      {
        name: "✅ Spremno",
        value: discordTime(harvestAt),
        inline: true
      },
      {
        name: "📍 Lokacija",
        value: "Ranch",
        inline: true
      }
    )
    .setColor(0xed4245);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildHarvestedEmbed({
  cropName,
  amount,
  plantedUserId,
  harvestedByUserId,
  plantedAt,
  harvestAt,
  harvestedAt,
  imageUrl
}) {
  const embed = new EmbedBuilder()
    .setTitle("✅ Obrano!")
    .setDescription(
      `<@${harvestedByUserId}> je obrao/la sadnju od <@${plantedUserId}>.`
    )
    .addFields(
      {
        name: "🌿 Vrsta",
        value: cropName,
        inline: true
      },
      {
        name: "📦 Količina",
        value: String(amount),
        inline: true
      },
      {
        name: "🕒 Posađeno",
        value: discordTime(plantedAt),
        inline: true
      },
      {
        name: "⏰ Bilo spremno",
        value: discordTime(harvestAt),
        inline: true
      },
      {
        name: "🧺 Obrano",
        value: discordTime(harvestedAt),
        inline: true
      },
      {
        name: "👨‍🌾 Obrao",
        value: `<@${harvestedByUserId}>`,
        inline: true
      },
      {
        name: "📍 Lokacija",
        value: "Ranch",
        inline: true
      }
    )
    .setColor(0x5865f2);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildHarvestButton(plantingId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`obrano_${plantingId}`)
      .setLabel("Obrano")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🧺")
  );
}

function insertPlanting(data) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO plantings (
        guild_id,
        channel_id,
        user_id,
        message_id,
        crop_key,
        amount,
        planted_at,
        harvest_at,
        harvested
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `,
      [
        data.guildId,
        data.channelId,
        data.userId,
        data.messageId,
        data.cropKey,
        data.amount,
        data.plantedAt,
        data.harvestAt
      ],
      function (err) {
        if (err) return reject(err);

        resolve({
          id: this.lastID,
          ...data
        });
      }
    );
  });
}

function incrementUserPlantings(userId) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO daily_stats (user_id, plantings)
      VALUES (?, 1)
      ON CONFLICT(user_id)
      DO UPDATE SET plantings = plantings + 1
      `,
      [userId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function incrementTotalPlantings(userId) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO user_stats (user_id, total_plantings)
      VALUES (?, 1)
      ON CONFLICT(user_id)
      DO UPDATE SET total_plantings = total_plantings + 1
      `,
      [userId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function getTotalPlantings(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      `
      SELECT total_plantings
      FROM user_stats
      WHERE user_id = ?
      `,
      [userId],
      (err, row) => {
        if (err) return reject(err);

        resolve(row ? row.total_plantings : 0);
      }
    );
  });
}
async function sendHarvestMessage(row) {
  const harvestChannelIds = [
    HARVEST_CHANNEL_ID_1,
    HARVEST_CHANNEL_ID_2
  ];

  const embed = buildHarvestEmbed({
    cropName: formatCropName(row.cropKey),
    amount: row.amount,
    userId: row.userId,
    plantedAt: row.plantedAt,
    harvestAt: row.harvestAt,
    imageUrl: row.imageUrl
  });

  const content = HARVEST_ROLE_ID
    ? `<@&${HARVEST_ROLE_ID}> <@${row.userId}>`
    : `<@${row.userId}>`;

  for (const channelId of harvestChannelIds) {
    const channel = await client.channels
      .fetch(channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) continue;

    await channel.send({
      content,
      embeds: [embed],
      components: [buildHarvestButton(row.id)]
    });
  }
}


function scheduleHarvest(row) {
  const delay = Math.max(
    0,
    row.harvestAt - Date.now()
  );

  const timeout = setTimeout(async () => {
    await sendHarvestMessage(row);

    activeTimers.delete(row.id);
  }, delay);

  activeTimers.set(row.id, timeout);
}

async function sendDailyReport() {
  try {
    const channel = await client.channels.fetch(
      DAILY_REPORT_CHANNEL_ID
    ).catch(() => null);

    if (!channel) return;

    db.all(
      `
      SELECT *
      FROM daily_stats
      ORDER BY plantings DESC
      `,
      async (err, rows) => {

        if (err) {
          console.error(err);
          return;
        }

        let description = "";

        if (!rows.length) {
          description =
            "📊 Danas nije bilo nijedne sadnje.";
        } else {

          rows.forEach((row, index) => {

            let medal = "🌱";

            if (index === 0) medal = "🥇";
            else if (index === 1) medal = "🥈";
            else if (index === 2) medal = "🥉";

            description +=
              `${medal} <@${row.user_id}> — **${row.plantings}** sadnji\n`;
          });

        }

        const embed = new EmbedBuilder()
          .setTitle("📊 Dnevni izvještaj sadnji")
          .setDescription(description)
          .setColor(0x57f287)
          .setTimestamp();

        await channel.send({
          embeds: [embed]
        });

        db.run("DELETE FROM daily_stats");
      }
    );

  } catch (err) {
    console.error(err);
  }
}

function scheduleDailyReport() {

  const now = new Date();

  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);

  const ms = midnight - now;

  setTimeout(() => {

    sendDailyReport();

    setInterval(
      sendDailyReport,
      24 * 60 * 60 * 1000
    );

  }, ms);
}

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    if (message.guild.id !== GUILD_ID) return;

    if (message.channel.id !== FARM_CHANNEL_ID) {
      return;
    }

    const parsed = parsePlantMessage(message.content);

    if (!parsed) return;

    await message.react("✅").catch(() => null);

    await message.channel.send({
      content: `${PLANT_TIME_TEXT}

<@${message.author.id}> izaberi vreme sadnje za **${formatCropName(parsed.cropKey)} x${parsed.amount}**:`,
      components: [buildPlantTimeMenu(message.id)]
    });

  } catch (err) {
    console.error("Greška u messageCreate:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  console.log("INTERACTION RECEIVED");

  try {

    if (interaction.isStringSelectMenu()) {

      await interaction.deferUpdate();

      if (!interaction.customId.startsWith("planttime_")) {
        return;
      }

      console.log("CUSTOM ID:", interaction.customId);

      const growTime = PLANT_TIMES[interaction.values[0]];

      console.log("SELECTED:", interaction.values[0]);
      console.log("GROW TIME:", growTime);

      if (!growTime) {
        await interaction.followUp({
          content: "Nepoznato vreme sadnje.",
          ephemeral: true
        });
        return;
      }

      const originalMessageId =
        interaction.customId.replace(
          "planttime_",
          ""
        );

      const originalMessage =
        await interaction.channel.messages
          .fetch(originalMessageId)
          .catch(err => {
            console.error("FETCH ERROR:", err);
            return null;
          });

      if (!originalMessage) {
        await interaction.followUp({
          content: "Ne mogu pronaći originalnu poruku.",
          ephemeral: true
        });
        return;
      }

      const parsed = parsePlantMessage(
        originalMessage.content
      );

      if (!parsed) {
        await interaction.followUp({
          content: "Neispravna sadnja.",
          ephemeral: true
        });
        return;
      }

      const plantedAt = Date.now();
      const harvestAt = plantedAt + growTime;

      const imageUrl =
        getMessageImage(originalMessage);

      const saved = await insertPlanting({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        userId: originalMessage.author.id,
        messageId: originalMessage.id,
        cropKey: parsed.cropKey,
        amount: parsed.amount,
        plantedAt,
        harvestAt,
        imageUrl
      });

      await incrementUserPlantings(
        originalMessage.author.id
      );

      await incrementTotalPlantings(
        originalMessage.author.id
      );

      const totalPlantings =
        await getTotalPlantings(
          originalMessage.author.id
        );

      saved.imageUrl = imageUrl;

      scheduleHarvest(saved);

      const embed = buildPlantEmbed({
  cropName: formatCropName(parsed.cropKey),
  amount: parsed.amount,
  userId: originalMessage.author.id,
  plantedAt,
  harvestAt,
  imageUrl,
  totalPlantings
});

await interaction.update({
  content: `✅ Sadnja zabeležena za <@${originalMessage.author.id}>.`,
  embeds: [embed],
  components: []
});

return;
    }

    if (!interaction.isButton()) return;

        

    if (!interaction.customId.startsWith("obrano_")) {
      return;
    }

    const plantingId = interaction.customId.replace(
      "obrano_",
      ""
    );

    if (harvestedPlantings.has(plantingId)) {
      await interaction.reply({
        content: "Ovo je već obrano.",
        ephemeral: true
      });

      return;
    }

    harvestedPlantings.add(plantingId);

    const embed = interaction.message.embeds[0];

    const existingImage =
      embed?.image?.url || null;

    const fieldMap = new Map();

    for (const field of embed?.fields || []) {
      fieldMap.set(field.name, field.value);
    }

    const vrsta =
      fieldMap.get("🌿 Vrsta") || "Nepoznato";

    const kolicina =
      fieldMap.get("📦 Količina") || "0";

    const plantedUserMatch =
      interaction.message.content.match(
        /<@(\d+)>/
      );

    const plantedUserId = plantedUserMatch
      ? plantedUserMatch[1]
      : interaction.user.id;

    let plantedAt = Date.now();
    let harvestAt = Date.now();

    const readyField =
      fieldMap.get("✅ Spremno") ||
      fieldMap.get("⏰ Bilo spremno");

    const plantedField =
      fieldMap.get("🕒 Posađeno");

    const plantedTimestampMatch =
      plantedField?.match(/<t:(\d+):[a-z]>/i);

    const readyTimestampMatch =
      readyField?.match(/<t:(\d+):[a-z]>/i);

    if (plantedTimestampMatch) {
      plantedAt =
        Number(plantedTimestampMatch[1]) * 1000;
    }

    if (readyTimestampMatch) {
      harvestAt =
        Number(readyTimestampMatch[1]) * 1000;
    }

    const editedEmbed = buildHarvestedEmbed({
      cropName: vrsta,
      amount: kolicina,
      plantedUserId,
      harvestedByUserId: interaction.user.id,
      plantedAt,
      harvestAt,
      harvestedAt: Date.now(),
      imageUrl: existingImage
    });

    await interaction.update({
      content: `✅ Obrano od strane <@${interaction.user.id}>`,
      embeds: [editedEmbed],
      components: []
    });

  } catch (err) {
  console.error("FULL ERROR:");
  console.error(err);
  console.error(err.stack);
  }

  });
client.once("clientReady", () => {

  console.log(
    `Bot online kao ${client.user.tag}`
  );

  scheduleDailyReport();
});

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error(
    "DISCORD_TOKEN nije postavljen."
  );

  process.exit(1);
}

client.login(token);
