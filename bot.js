require('dotenv').config();
const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `👋 স্বাগতম Crypto Mini App এ!\n\nOpen Mini App করতে নিচের বাটন ক্লিক করুন।`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Open Mini App", web_app: { url: "https://crypto-mini-bot.netlify.app/" } }],
      ],
    },
  });
});

console.log("Bot is running...");
