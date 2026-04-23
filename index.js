require('dotenv').config();
const { startBot } = require('./src/bot');
const { startFeedMonitor } = require('./src/feeds/monitor');

if (!process.env.BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}
if (!process.env.OWNER_ID) {
  console.error('Missing OWNER_ID in .env');
  process.exit(1);
}

(async () => {
  const bot = await startBot();
  startFeedMonitor(bot);

  const shutdown = async (sig) => {
    console.log(`[${sig}] stopping bot…`);
    await bot.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
})();
