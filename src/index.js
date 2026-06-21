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
  plant_80: 60 * 60 * 1000
};

const activeTimers = new Map();
const harvestedPlantings = new Set();

// ================= HELPERS =================

function normalizeCropName(input) {
  return input.trim().toLowerCase();
}

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
    cropKey: normalizeCropName(match[1]),
    amount: parseInt(match[2], 10)
  };
}

function discordTime(ms, format = "f") {
  return `<t:${Math.floor(ms / 1000)}:${format}>`;
}

function getMessageImage(message) {
  const attachment = message.attachments.find(att =>
    att.contentType?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp)$/i.test(att.name || "")
  );

  return attachment ? attachment.url : null;
}

// ================= EMBEDS =================

function buildPlantEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle("🌱 Sadnja zabeležena!")
    .setColor(0x57f287)
    .addFields(
      { name: "🌿 Vrsta", value: data.cropName, inline: true },
      { name: "📦 Količina", value: String(data.amount), inline: true },
      { name: "📈 Ukupno sadnji", value: String(data.totalPlantings), inline: true },
      { name: "🕒 Posađeno", value: discordTime(data.plantedAt), inline: true },
      { name: "⏰ Berba", value: discordTime(data.harvestAt), inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
    );

  if (data.imageUrl) embed.setImage(data.imageUrl);
  return embed;
}

function buildHarvestedEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle("✅ Obrano!")
    .setColor(0x5865f2)
    .setDescription(
      `<@${data.harvestedByUserId}> je obrao sadnju od <@${data.plantedUserId}>`
    )
    .addFields(
      { name: "🌿 Vrsta", value: data.cropName, inline: true },
      { name: "📦 Količina", value: String(data.amount), inline: true },
      { name: "🕒 Posađeno", value: discordTime(data.plantedAt), inline: true },
      { name: "⏰ Bilo spremno", value: discordTime(data.harvestAt), inline: true },
      { name: "🧺 Obrano", value: discordTime(data.harvestedAt), inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
    );

  if (data.imageUrl) embed.setImage(data.imageUrl);
  return embed;
}

function buildPlantTimeMenu(messageId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`planttime_${messageId}`)
      .setPlaceholder("Izaberi postotak sadnje")
      .addOptions(
        { label: "20% - 1h", value: "plant_20" },
        { label: "25% - 1h 15min", value: "plant_25" },
        { label: "30% - 1h 30min", value: "plant_30" },
        { label: "35% - 1h 45min", value: "plant_35" },
        { label: "40% - 2h", value: "plant_40" },
        { label: "45% - 2h 15min", value: "plant_45" },
        { label: "50% - 2h 30min", value: "plant_50" },
        { label: "55% - 2h 45min", value: "plant_55" },
        { label: "60% - 3h", value: "plant_60" },
        { label: "65% - 3h 15min", value: "plant_65" },
        { label: "70% - 3h 30min", value: "plant_70" },
        { label: "75% - 3h 45min", value: "plant_75" },
        { label: "80% - 4h", value: "plant_80" },
        { label: "85% - 4h 15min", value: "plant_85" }
      )
  );
}

// ================= EVENTS =================

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

client.on("interactionCreate", async (interaction) => {
  try {
    // ===== SELECT MENU =====
    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("planttime_")) return;

      await interaction.deferUpdate();

      const growTime = PLANT_TIMES[interaction.values[0]];
      if (!growTime) return;

      const messageId = interaction.customId.replace("planttime_", "");

      const originalMessage = await interaction.channel.messages.fetch(messageId).catch(() => null);
      if (!originalMessage) return;

      const parsed = parsePlantMessage(originalMessage.content);
      if (!parsed) return;

      const plantedAt = Date.now();
      const harvestAt = plantedAt + growTime;

      const imageUrl = getMessageImage(originalMessage);

      const embed = buildPlantEmbed({
        cropName: formatCropName(parsed.cropKey),
        amount: parsed.amount,
        userId: originalMessage.author.id,
        plantedAt,
        harvestAt,
        imageUrl,
        totalPlantings: 1
      });

      return interaction.editReply({
        content: "✅ Sadnja zabeležena!",
        embeds: [embed],
        components: []
      });
    }

    // ===== BUTTON =====
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("obrano_")) return;

    await interaction.deferUpdate();

    const embed = interaction.message.embeds[0];

    const edited = new EmbedBuilder(embed)
      .setTitle("✅ Obrano!");

    return interaction.editReply({
      embeds: [edited],
      components: []
    });

  } catch (err) {
    console.error(err);
  }
});

// ================= START =================

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
