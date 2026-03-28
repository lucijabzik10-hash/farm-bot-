require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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
const HARVEST_CHANNEL_ID = process.env.HARVEST_CHANNEL_ID;
const HARVEST_ROLE_ID = process.env.HARVEST_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;

// 30 sekundi
const GROW_TIME_MS = 30 * 1000;

const activeTimers = new Map();

function normalizeCropName(input) {
  return input.trim().toLowerCase();
}

function formatCropName(input) {
  const clean = input.trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// podrzava:
// cvetx5
// cvet x 5
// cvet 5
function parsePlantMessage(content) {
  const match = content.trim().match(/^([a-zA-ZčćžšđČĆŽŠĐ]+)\s*(?:x\s*)?(\d+)$/i);
  if (!match) return null;

  const cropKey = normalizeCropName(match[1]);
  const amount = parseInt(match[2], 10);

  if (!cropKey) return null;
  if (!Number.isInteger(amount) || amount <= 0) return null;

  return { cropKey, amount };
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
      { name: "🌿 Vrsta", value: cropName, inline: true },
      { name: "📦 Količina", value: String(amount), inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "⏰ Berba", value: discordTime(harvestAt), inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
    )
    .setColor(0x57f287);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildHarvestReadyEmbed({
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
      { name: "🌿 Vrsta", value: cropName, inline: true },
      { name: "📦 Količina", value: String(amount), inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "✅ Spremno", value: discordTime(harvestAt), inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
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
  plantedByUserId,
  plantedAt,
  harvestAt,
  harvestedByUserId,
  harvestedAt,
  imageUrl
}) {
  const embed = new EmbedBuilder()
    .setTitle("✅ Obrano!")
    .setDescription(
      `<@${plantedByUserId}> je posadio/la, a <@${harvestedByUserId}> je obrao/la.`
    )
    .addFields(
      { name: "🌿 Vrsta", value: cropName, inline: true },
      { name: "📦 Količina", value: String(amount), inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "⏰ Spremno", value: discordTime(harvestAt), inline: true },
      { name: "🧺 Obrano", value: discordTime(harvestedAt), inline: true },
      { name: "👨‍🌾 Obrao", value: `<@${harvestedByUserId}>`, inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
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
      .setCustomId(`harvest_${plantingId}`)
      .setLabel("Obrano")
      .setEmoji("🧺")
      .setStyle(ButtonStyle.Success)
  );
}

function insertPlanting(data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO plantings (
        guild_id,
        channel_id,
        user_id,
        message_id,
        crop_key,
        amount,
        planted_at,
        harvest_at,
        harvested,
        image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        data.guildId,
        data.channelId,
        data.userId,
        data.messageId,
        data.cropKey,
        data.amount,
        data.plantedAt,
        data.harvestAt,
        data.imageUrl || null
      ],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, ...data });
      }
    );
  });
}

function getPlantingById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT
        id,
        guild_id as guildId,
        channel_id as channelId,
        user_id as userId,
        message_id as messageId,
        crop_key as cropKey,
        amount,
        planted_at as plantedAt,
        harvest_at as harvestAt,
        harvested,
        image_url as imageUrl,
        harvest_message_id as harvestMessageId,
        harvest_channel_id as harvestChannelId,
        harvested_by as harvestedBy,
        harvested_at as harvestedAt
      FROM plantings
      WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

function getPendingPlantings() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT
        id,
        guild_id as guildId,
        channel_id as channelId,
        user_id as userId,
        message_id as messageId,
        crop_key as cropKey,
        amount,
        planted_at as plantedAt,
        harvest_at as harvestAt,
        harvested,
        image_url as imageUrl,
        harvest_message_id as harvestMessageId,
        harvest_channel_id as harvestChannelId,
        harvested_by as harvestedBy,
        harvested_at as harvestedAt
      FROM plantings
      WHERE harvested = 0`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

function saveHarvestMessageInfo(id, harvestChannelId, harvestMessageId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE plantings
       SET harvest_channel_id = ?, harvest_message_id = ?
       WHERE id = ?`,
      [harvestChannelId, harvestMessageId, id],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function markPlantingHarvested(id, harvestedBy, harvestedAt) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE plantings
       SET harvested = 1,
           harvested_by = ?,
           harvested_at = ?
       WHERE id = ? AND harvested = 0`,
      [harvestedBy, harvestedAt, id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

async function sendHarvestMessage(row) {
  const guild = await client.guilds.fetch(row.guildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(HARVEST_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = buildHarvestReadyEmbed({
    cropName: formatCropName(row.cropKey),
    amount: row.amount,
    userId: row.userId,
    plantedAt: row.plantedAt,
    harvestAt: row.harvestAt,
    imageUrl: row.imageUrl || null
  });

  const sentMessage = await channel.send({
    content: HARVEST_ROLE_ID
      ? `<@&${HARVEST_ROLE_ID}> <@${row.userId}>`
      : `<@${row.userId}>`,
    embeds: [embed],
    components: [buildHarvestButton(row.id)]
  });

  await saveHarvestMessageInfo(row.id, channel.id, sentMessage.id);
}

function scheduleHarvest(row) {
  if (activeTimers.has(row.id)) {
    clearTimeout(activeTimers.get(row.id));
    activeTimers.delete(row.id);
  }

  const delay = Math.max(0, row.harvestAt - Date.now());

  const timeout = setTimeout(async () => {
    try {
      const fresh = await getPlantingById(row.id);
      if (!fresh || fresh.harvested) return;

      if (fresh.harvestMessageId && fresh.harvestChannelId) {
        return;
      }

      await sendHarvestMessage(fresh);
    } catch (err) {
      console.error("Greška u scheduleHarvest:", err);
    } finally {
      activeTimers.delete(row.id);
    }
  }, delay);

  activeTimers.set(row.id, timeout);
}

async function restorePendingPlantings() {
  const pending = await getPendingPlantings();

  for (const planting of pending) {
    if (planting.harvestMessageId && planting.harvestChannelId) {
      continue;
    }

    scheduleHarvest(planting);
  }

  console.log(`Vraćeno aktivnih sadnji: ${pending.length}`);
}

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (message.guild.id !== GUILD_ID) return;
    if (message.channel.id !== FARM_CHANNEL_ID) return;

    const parsed = parsePlantMessage(message.content);
    if (!parsed) return;

    const plantedAt = Date.now();
    const harvestAt = plantedAt + GROW_TIME_MS;
    const imageUrl = getMessageImage(message);

    const saved = await insertPlanting({
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      messageId: message.id,
      cropKey: parsed.cropKey,
      amount: parsed.amount,
      plantedAt,
      harvestAt,
      imageUrl
    });

    scheduleHarvest(saved);

    await message.react("✅").catch(() => null);

    const embed = buildPlantEmbed({
      cropName: formatCropName(parsed.cropKey),
      amount: parsed.amount,
      userId: message.author.id,
      plantedAt,
      harvestAt,
      imageUrl
    });

    await message.channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Greška u messageCreate:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("harvest_")) return;

    const plantingId = Number(interaction.customId.replace("harvest_", ""));
    if (!Number.isInteger(plantingId)) {
      await interaction.reply({
        content: "Neispravan ID sadnje.",
        ephemeral: true
      }).catch(() => null);
      return;
    }

    const planting = await getPlantingById(plantingId);

    if (!planting) {
      await interaction.reply({
        content: "Sadnja nije pronađena.",
        ephemeral: true
      }).catch(() => null);
      return;
    }

    if (planting.harvested) {
      await interaction.reply({
        content: "Ovo je već obrano.",
        ephemeral: true
      }).catch(() => null);
      return;
    }

    const harvestedAt = Date.now();
    const updated = await markPlantingHarvested(
      plantingId,
      interaction.user.id,
      harvestedAt
    );

    if (!updated) {
      await interaction.reply({
        content: "Neko je već obrao pre tebe.",
        ephemeral: true
      }).catch(() => null);
      return;
    }

    const embed = buildHarvestedEmbed({
      cropName: formatCropName(planting.cropKey),
      amount: planting.amount,
      plantedByUserId: planting.userId,
      plantedAt: planting.plantedAt,
      harvestAt: planting.harvestAt,
      harvestedByUserId: interaction.user.id,
      harvestedAt,
      imageUrl: planting.imageUrl || null
    });

    await interaction.update({
      content: `✅ Obrano od strane <@${interaction.user.id}>`,
      embeds: [embed],
      components: []
    }).catch(() => null);
  } catch (err) {
    console.error("Greška u interactionCreate:", err);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Došlo je do greške.",
        ephemeral: true
      }).catch(() => null);
    }
  }
});

client.once("clientReady", async () => {
  console.log(`Bot online kao ${client.user.tag}`);

  try {
    await restorePendingPlantings();
  } catch (err) {
    console.error("Greška pri vraćanju sadnji:", err);
  }
});

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error("DISCORD_TOKEN nije postavljen.");
  process.exit(1);
}

client.login(token);
