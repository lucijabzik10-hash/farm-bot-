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

const PLANT_TIMES = {
  "plant_2h": 2 * 60 * 60 * 1000,
  "plant_3h": 3 * 60 * 60 * 1000,
  "plant_4h": 4 * 60 * 60 * 1000
};

const PLANT_TIME_TEXT = `***Vreme trajanja sadnje:

PAMUK: 3 H ✓

CVEKLA: 2 H ✓

HMELJ:  3 H ✓

REPA: 3 H ✓

KAFA: 2 H ✓

JAGODA: 4 H ✓

BRESKVA:

NARANDZA: 4 H ✓

KRUSKA:  4 H ✓

LIMUN: 4 H ✓

KUKURUZ: 4 H

PASULJ: 2 H ✓

ZITO: 3 H

PIRINAC: 2 H ✓

SECERNA TRSKA: 2 H ✓

CRNO GROZDJE: 4 H ✓

BELO GROZDJE: 4 H ✓

KRUMPIR:  2 H ✓

PARADAJZ: 2 H ✓

KUPUS: 1 H I 45 MIN

BELI LUK: 2 H ✓

LUK: 2 H ✓

PAPRIKA: 1 H I 45 MIN

JABUKA: 4 H ✓

20% je 4h
40% je 3h 
60% je 2h***`;

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
      .setPlaceholder("Izaberi vreme sadnje")
      .addOptions(
        {
          label: "2h",
          value: "plant_2h",
          emoji: "⏱️"
        },
        {
          label: "3h",
          value: "plant_3h",
          emoji: "⏱️"
        },
        {
          label: "4h",
          value: "plant_4h",
          emoji: "⏱️"
        }
      )
  );
}

function buildPlantEmbed({
  cropName,
  amount,
  userId,
  plantedAt,
  harvestAt,
  imageUrl
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
    imageUrl: row.imageUrl || null
  });

  const content = HARVEST_ROLE_ID
    ? `<@&${HARVEST_ROLE_ID}> <@${row.userId}>`
    : `<@${row.userId}>`;

  for (const channelId of harvestChannelIds) {
    const channel = await client.channels
      .fetch(channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) {
      continue;
    }

    await channel.send({
      content,
      embeds: [embed],
      components: [buildHarvestButton(row.id)]
    }).catch(console.error);
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
  try {

    if (interaction.isStringSelectMenu()) {

      if (!interaction.customId.startsWith("planttime_")) {
        return;
      }

      const growTime = PLANT_TIMES[interaction.values[0]];

      if (!growTime) {
        await interaction.reply({
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
          .catch(() => null);

      if (!originalMessage) {
        await interaction.reply({
          content: "Ne mogu pronaći originalnu poruku.",
          ephemeral: true
        });
        return;
      }

      const parsed = parsePlantMessage(
        originalMessage.content
      );

      if (!parsed) {
        await interaction.reply({
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

      saved.imageUrl = imageUrl;

      scheduleHarvest(saved);

      const embed = buildPlantEmbed({
        cropName: formatCropName(parsed.cropKey),
        amount: parsed.amount,
        userId: originalMessage.author.id,
        plantedAt,
        harvestAt,
        imageUrl
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
    console.error(
      "Greška u interactionCreate:",
      err
    );
  }
});

client.once("clientReady", () => {
  console.log(
    `Bot online kao ${client.user.tag}`
  );
});

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error(
    "DISCORD_TOKEN nije postavljen."
  );

  process.exit(1);
}

client.login(token);
