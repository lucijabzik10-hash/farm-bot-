require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField
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

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const FARM_CHANNEL_ID = process.env.FARM_CHANNEL_ID;
const HARVEST_ROLE_ID = process.env.HARVEST_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;

const GROW_TIME_MS = 5 * 60 * 60 * 1000; // 5 sati
const activeTimers = new Map();

const CROPS = {
  luk: {
    displayName: "Luk",
    growTimeMs: GROW_TIME_MS
  }
};

function normalizeCropName(input) {
  return input.trim().toLowerCase();
}

function parsePlantMessage(content) {
  // dozvoljava:
  // luk x 5
  // Luk x5
  // luk X 10
  const match = content.trim().match(/^([a-zA-ZčćžšđČĆŽŠĐ]+)\s*x\s*(\d+)$/i);
  if (!match) return null;

  const cropKey = normalizeCropName(match[1]);
  const amount = parseInt(match[2], 10);

  if (!CROPS[cropKey]) return null;
  if (!Number.isInteger(amount) || amount <= 0) return null;

  return { cropKey, amount };
}

function discordTime(ms, format = "f") {
  return `<t:${Math.floor(ms / 1000)}:${format}>`;
}

function buildPlantEmbed({ cropName, amount, userId, plantedAt, harvestAt }) {
  return new EmbedBuilder()
    .setTitle("🌱 Sadnja zabeležena!")
    .setDescription(`<@${userId}> je posadio/la.`)
    .addFields(
      { name: "🌿 Sadnica", value: `${cropName} x ${amount}`, inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "⏰ Berba", value: discordTime(harvestAt), inline: true },
      { name: "📍 Lokacija", value: "Luk 5", inline: false }
    )
    .setColor(0x57f287)
    .setTimestamp(new Date(plantedAt));
}

function buildHarvestEmbed({ cropName, amount, userId, plantedAt, harvestAt }) {
  return new EmbedBuilder()
    .setTitle("🚨 Spremno za branje!")
    .setDescription(`<@${userId}> spremno je za branje.`)
    .addFields(
      { name: "🌿 Sadnica", value: `${cropName} x ${amount}`, inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "✅ Spremno", value: discordTime(harvestAt), inline: true },
      { name: "📍 Lokacija", value: "Luk 5", inline: false }
    )
    .setColor(0xed4245)
    .setTimestamp(new Date(harvestAt));
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
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
          guild_id: data.guildId,
          channel_id: data.channelId,
          user_id: data.userId,
          message_id: data.messageId,
          crop_key: data.cropKey,
          amount: data.amount,
          planted_at: data.plantedAt,
          harvest_at: data.harvestAt,
          harvested: 0
        });
      }
    );
  });
}

function getPendingPlantings() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM plantings WHERE harvested = 0`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function markPlantingHarvested(id) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE plantings SET harvested = 1 WHERE id = ?`,
      [id],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

async function sendHarvestMessage(row) {
  const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const crop = CROPS[row.crop_key];
  if (!crop) return;

  const embed = buildHarvestEmbed({
    cropName: crop.displayName,
    amount: row.amount,
    userId: row.user_id,
    plantedAt: row.planted_at,
    harvestAt: row.harvest_at
  });

  await channel.send({
    content: `<@&${HARVEST_ROLE_ID}> <@${row.user_id}>`,
    embeds: [embed],
    allowedMentions: {
      users: [row.user_id],
      roles: [HARVEST_ROLE_ID]
    }
  });

  await markPlantingHarvested(row.id);
}

function scheduleHarvest(row) {
  const now = Date.now();
  const delay = Math.max(0, row.harvest_at - now);

  if (activeTimers.has(row.id)) {
    clearTimeout(activeTimers.get(row.id));
  }

  const timeout = setTimeout(async () => {
    try {
      await sendHarvestMessage(row);
    } catch (error) {
      console.error("Greška kod slanja berbe:", error);
    } finally {
      activeTimers.delete(row.id);
    }
  }, delay);

  activeTimers.set(row.id, timeout);
}

async function restoreSchedules() {
  try {
    const rows = await getPendingPlantings();

    for (const row of rows) {
      scheduleHarvest(row);
    }

    console.log(`Vraćeno aktivnih sadnji: ${rows.length}`);
  } catch (error) {
    console.error("Greška pri vraćanju sadnji:", error);
  }
}

client.once("ready", async () => {
  console.log(`Bot online kao ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) {
    console.warn("Guild nije pronađen. Provjeri GUILD_ID.");
  }

  restoreSchedules();
});

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (message.guild.id !== GUILD_ID) return;
    if (message.channel.id !== FARM_CHANNEL_ID) return;

    const parsed = parsePlantMessage(message.content);
    if (!parsed) return;

    const crop = CROPS[parsed.cropKey];
    const plantedAt = Date.now();
    const harvestAt = plantedAt + crop.growTimeMs;

    const savedRow = await insertPlanting({
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      messageId: message.id,
      cropKey: parsed.cropKey,
      amount: parsed.amount,
      plantedAt,
      harvestAt
    });

    scheduleHarvest(savedRow);

    await message.react("✅").catch(() => null);

    const embed = buildPlantEmbed({
      cropName: crop.displayName,
      amount: parsed.amount,
      userId: message.author.id,
      plantedAt,
      harvestAt
    });

    await message.channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error("Greška u messageCreate:", error);
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN nije postavljen u Railway Variables.");
  process.exit(1);
}

console.log("DISCORD_TOKEN postoji:", !!process.env.DISCORD_TOKEN);
console.log("Duzina tokena:", process.env.DISCORD_TOKEN.trim().length);

client.login(process.env.DISCORD_TOKEN.trim());
