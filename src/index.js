require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const FARM_CHANNEL_ID = process.env.FARM_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;

// 20% = 4h, 100% = 5h
const PLANT_TIMES = {
  plant_20: 240 * 60 * 1000,
  plant_25: 225 * 60 * 1000,
  plant_30: 210 * 60 * 1000,
  plant_35: 195 * 60 * 1000,
  plant_40: 180 * 60 * 1000,
  plant_45: 165 * 60 * 1000,
  plant_50: 150 * 60 * 1000,
  plant_55: 135 * 60 * 1000,
  plant_60: 120 * 60 * 1000,
  plant_65: 105 * 60 * 1000,
  plant_70: 90 * 60 * 1000,
  plant_75: 75 * 60 * 1000,
  plant_80: 60 * 60 * 1000,
  plant_85: 45 * 60 * 1000
};

const activeIntervals = new Map();

// ================= HELPERS =================

function formatCropName(input) {
  return input
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function parsePlantMessage(content) {
  const match = content.trim().match(/^(.+?)\s*(?:x\s*)?(\d+)$/i);
  if (!match) return null;

  return {
    cropKey: match[1].toLowerCase(),
    amount: parseInt(match[2], 10)
  };
}

function discordTime(ms, format = "f") {
  return `<t:${Math.floor(ms / 1000)}:${format}>`;
}

function formatRemaining(ms) {
  if (ms <= 0) return "⏰ Spremno za berbu!";

  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  return `⏳ ${h}h ${m}m`;
}

// ================= MENU =================

function buildPlantTimeMenu(messageId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`planttime_${messageId}`)
      .setPlaceholder("Izaberi postotak sadnje")
      .addOptions(
        { label: "20% - 4h", value: "plant_20" },
        { label: "25% - 3h 45min", value: "plant_25" },
        { label: "30% - 3h 30min", value: "plant_30" },
        { label: "35% - 3h 15min", value: "plant_35" },
        { label: "40% - 3h", value: "plant_40" },
        { label: "45% - 2h 45min", value: "plant_45" },
        { label: "50% - 2h 30min", value: "plant_50" },
        { label: "55% - 2h 15min", value: "plant_55" },
        { label: "60% - 2h", value: "plant_60" },
        { label: "65% - 1h 45min", value: "plant_65" },
        { label: "70% - 1h 30min", value: "plant_70" },
        { label: "75% - 1h 15min", value: "plant_75" },
        { label: "80% - 1h", value: "plant_80" },
        { label: "85% - 45min", value: "plant_85" }
      )
  );
}

// ================= LIVE EMBED =================

function buildPlantEmbed({ cropName, amount, plantedAt, harvestAt, remaining }) {
  return new EmbedBuilder()
    .setTitle("🌱 Sadnja u toku")
    .setColor(0x57f287)
    .addFields(
      { name: "🌿 Vrsta", value: cropName, inline: true },
      { name: "📦 Količina", value: String(amount), inline: true },
      { name: "🕒 Početak", value: discordTime(plantedAt), inline: true },
      { name: "⏰ Berba", value: discordTime(harvestAt), inline: true },
      { name: "⏳ Status", value: remaining, inline: false }
    );
}

// ================= MESSAGE =================

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (message.guild.id !== GUILD_ID) return;
  if (message.channel.id !== FARM_CHANNEL_ID) return;

  const parsed = parsePlantMessage(message.content);
  if (!parsed) return;

  await message.react("✅").catch(() => null);

  await message.channel.send({
    content: `Izaberi vreme sadnje za ${formatCropName(parsed.cropKey)} x${parsed.amount}`,
    components: [buildPlantTimeMenu(message.id)]
  });
});

// ================= INTERACTION =================

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith("planttime_")) return;

    const growTime = PLANT_TIMES[interaction.values[0]];
    if (!growTime) return;

    const messageId = interaction.customId.replace("planttime_", "");

    const originalMessage = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!originalMessage) return;

    const parsed = parsePlantMessage(originalMessage.content);
    if (!parsed) return;

    const plantedAt = Date.now();
    const harvestAt = plantedAt + growTime;

    const sentMessage = await interaction.reply({
      content: "🌱 Sadnja pokrenuta...",
      fetchReply: true
    });

    // LIVE UPDATE LOOP
    const interval = setInterval(async () => {
      const now = Date.now();
      const remaining = harvestAt - now;

      const embed = buildPlantEmbed({
        cropName: formatCropName(parsed.cropKey),
        amount: parsed.amount,
        plantedAt,
        harvestAt,
        remaining: formatRemaining(remaining)
      });

      try {
        await sentMessage.edit({ embeds: [embed] });
      } catch (err) {
        clearInterval(interval);
      }

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 60000); // svake 60 sekundi

    activeIntervals.set(sentMessage.id, interval);

  } catch (err) {
    console.error(err);
  }
});

// ================= START =================

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
