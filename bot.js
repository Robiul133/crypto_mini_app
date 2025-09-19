const { Telegraf } = require('telegraf');
require('dotenv').config(); // .env থেকে টোকেন লোড

const bot = new Telegraf(process.env.BOT_TOKEN);

// /start হ্যান্ডলার
bot.start((ctx) => {
  ctx.reply(
    "Welcome to Crypto Mini Trading! Click below to open the trading app.",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open App", url: "https://crypto-mini-bot.netlify.app/" }]
        ]
      }
    }
  );
});

bot.launch();
console.log("Bot is running...");
