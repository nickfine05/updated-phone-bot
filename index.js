require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { RestClient } = require("@signalwire/compatibility-api");

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const swClient = RestClient(
  process.env.SIGNALWIRE_PROJECT_ID,
  process.env.SIGNALWIRE_API_TOKEN,
  { signalwireSpaceUrl: process.env.SIGNALWIRE_SPACE_URL }
);

const CALL_LIST = [];
for (let i = 1; i <= 190; i++) {
  const person = process.env[`PERSON_${i}`];
  const from = process.env[`FROM_${((i - 1) % 24) + 1}`];
  if (person && from) {
    CALL_LIST.push({ personIndex: i, to: person, from: from });
  }
}

const CALL_GROUPS = {};
for (const entry of CALL_LIST) {
  if (!CALL_GROUPS[entry.from]) CALL_GROUPS[entry.from] = [];
  CALL_GROUPS[entry.from].push(entry);
}

console.log(`📦 ${CALL_LIST.length} people across ${Object.keys(CALL_GROUPS).length} parallel lanes`);

const COOLDOWN = 120000;
const INTRA_GROUP_DELAY_MS = 150;
const PERSONAL_NUMBER = "+17572688203";
const PERSONAL_FROM_NUMBER = process.env.FROM_1;
const PERSONAL_REPEAT_COUNT = 10;
const PERSONAL_REPEAT_DELAY_MS = 20000;
const RING_TIMEOUT_SEC = 20;
const AUTO_CANCEL_MS = 5000;
let lastCallTime = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callWithRetry(target, fromNumber, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📞 Attempt ${attempt} calling ${target} from ${fromNumber}`);
      const call = await swClient.calls.create({
        to: target,
        from: fromNumber,
        twiml: "<Response><Say>Alert triggered</Say></Response>",
        timeout: RING_TIMEOUT_SEC
      });
      console.log(`✅ Call placed SID: ${call.sid}`);

      setTimeout(async () => {
        try {
          await swClient.calls(call.sid).update({ status: "completed" });
        } catch (e) {}
      }, AUTO_CANCEL_MS);

      return true;
    } catch (error) {
      console.log(`❌ Attempt ${attempt} failed for ${target}: ${error.message}`);
      if (attempt === retries) {
        console.log(`🚫 All attempts failed for ${target}`);
        return false;
      }
      await delay(2000);
    }
  }
}

async function processLane(fromNumber, entries) {
  for (const entry of entries) {
    await callWithRetry(entry.to, entry.from);
    await delay(INTRA_GROUP_DELAY_MS);
  }
  console.log(`✅ Lane ${fromNumber} done (${entries.length} calls)`);
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== CHANNEL_ID) return;

  const now = Date.now();
  if (now - lastCallTime < COOLDOWN) {
    const remaining = Math.ceil((COOLDOWN - (now - lastCallTime)) / 1000);
    console.log(`⏳ Cooldown active — ${remaining}s remaining`);
    return;
  }
  lastCallTime = now;

  const startTime = Date.now();
  console.log(`🚀 Triggered by message: "${message.content}"`);
  console.log(`📞 Firing ${CALL_LIST.length} calls across ${Object.keys(CALL_GROUPS).length} lanes`);

  await Promise.all(
    Object.entries(CALL_GROUPS).map(([from, entries]) => processLane(from, entries))
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Call cycle finished in ${elapsed}s`);

  for (let i = 1; i <= PERSONAL_REPEAT_COUNT; i++) {
    console.log(`📱 Personal call ${i}/${PERSONAL_REPEAT_COUNT}`);
    await callWithRetry(PERSONAL_NUMBER, PERSONAL_FROM_NUMBER);
    if (i < PERSONAL_REPEAT_COUNT) {
      await delay(PERSONAL_REPEAT_DELAY_MS);
    }
  }
  console.log("🏁 All personal calls complete");
});

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`📞 People loaded: ${CALL_LIST.length}`);
});

client.login(DISCORD_BOT_TOKEN);

