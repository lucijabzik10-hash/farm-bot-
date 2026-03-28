require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder
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

const GROW_TIME_MS = 5 * 60 * 60 * 1000;
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
    .setColor(0x57f287);
}

function buildHarvestEmbed({ cropName, amount, userId, plantedAt, harvestAt }) {
  return new EmbedBuilder()
    .setTitle("🚨 Spremno za branje!")
    .setDescription(`<@${userId}> spremno je za branje.`)
    .addFields(
      { name: "🌿 Sadnica", value: `${cropName} x ${amount}`, inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "✅ Spremno", value: discordTime(harvestAt), inline: true }
    )
    .setColor(0xed4245);
}

function insertPlanting(data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO plantings (guild_id, channel_id, user_id, message_id, crop_key, amount, planted_at, harvest_at, harvested)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
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
        resolve({ id: this.lastID, ...data });
      }
    );
  });
}

async function sendHarvestMessage(row) {
  const guild = await client.guilds.fetch(row.guildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(row.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const crop = CROPS[row.cropKey];
  if (!crop) return;

  const embed = buildHarvestEmbed({
    cropName: crop.displayName,
    amount: row.amount,
    userId: row.userId,
    plantedAt: row.plantedAt,
    harvestAt: row.harvestAt
  });

  await channel.send({
    content: `<@&${HARVEST_ROLE_ID}> <@${row.userId}>`,
    embeds: [embed]
  });
}

function scheduleHarvest(row) {
  const delay = Math.max(0, row.harvestAt - Date.now());

  const timeout = setTimeout(async () => {
    await sendHarvestMessage(row);
  }, delay);

  activeTimers.set(row.id, timeout);
}

client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (message.guild.id !== GUILD_ID) return;
  if (message.channel.id !== FARM_CHANNEL_ID) return;

  const parsed = parsePlantMessage(message.content);
  if (!parsed) return;

  const crop = CROPS[parsed.cropKey];
  const plantedAt = Date.now();
  const harvestAt = plantedAt + crop.growTimeMs;

  const saved = await insertPlanting({
    guildId: message.guild.id,
    channelId: message.channel.id,
    userId: message.author.id,
    messageId: message.id,
    cropKey: parsed.cropKey,
    amount: parsed.amount,
    plantedAt,
    harvestAt
  });

  scheduleHarvest(saved);

  await message.react("✅");

  const embed = buildPlantEmbed({
    cropName: crop.displayName,
    amount: parsed.amount,
    userId: message.author.id,
    plantedAt,
    harvestAt
  });

  await message.channel.send({ embeds: [embed] });
});

client.once("ready", () => {
  console.log(`Bot online kao ${client.user.tag}`);
});


// ✅ TOKEN FIX (SAMO OVO NA KRAJU)
const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error("DISCORD_TOKEN nije postavljen.");
  process.exit(1);
}

console.log("DISCORD_TOKEN postoji:", true);
console.log("Duzina tokena:", token.length);

if (!token.includes(".")) {
  console.error("Pogrešan token (nije Discord bot token)");
  process.exit(1);
}

client.login(token);
