// bot.js

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const {
  addUser,
  getUser,
  updateBalance,
  addTradeHistory,
  addReferralCommission,
} = require("./database");

const TOKEN = "7992880264:AAHzk84wQpMSvZ1XtH0N5GUy3HWCYZVXlPI";
const bot = new TelegramBot(TOKEN, { polling: true });

const pendingAction = {};
const tradePending = {};

// Helper: Random boolean by probability
function randomChance(prob) {
  return Math.random() < prob;
}

// Live Market Price Fetch
async function getLiveMarketPrice(symbol = "BTCUSDT", platform = "binance") {
  try {
    if (platform === "binance") {
      const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      return parseFloat(res.data.price);
    }
    if (platform === "bybit") {
      const res = await axios.get(`https://api.bybit.com/v2/public/tickers?symbol=${symbol}`);
      return parseFloat(res.data.result[0].last_price);
    }
    if (platform === "kucoin") {
      const res = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}`);
      return parseFloat(res.data.data.price);
    }
    return null;
  } catch (err) {
    console.log(`${platform} API Error:`, err.message);
    return null;
  }
}

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  let referrerId = null;

  if (msg.text.includes("start ")) {
    const parts = msg.text.split(" ");
    if (parts[1] && parts[1] != chatId) referrerId = parts[1];
  }

  const user = addUser(chatId, referrerId);

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎮 Trade", callback_data: "trade_menu" }],
        [{ text: "💰 Balance", callback_data: "balance" }],
        [{ text: "➕ Deposit", callback_data: "deposit" }],
        [{ text: "➖ Withdraw", callback_data: "withdraw" }],
        [{ text: "📝 History", callback_data: "history" }],
        [{ text: "👥 Referral", callback_data: "referral" }],
        [{ text: "🔔 Notifications", callback_data: "notifications" }],
      ],
    },
  };

  bot.sendMessage(
    chatId,
    `👋 স্বাগতম Crypto Mini App এ!\n\nDemo Balance: $${user.demoBalance}\nReal Balance: $${user.realBalance}\n\n👉 নিচের বাটনগুলো ব্যবহার করে শুরু করুন।`,
    options
  );

  if (referrerId) {
    addReferralCommission(referrerId, 0);
    bot.sendMessage(referrerId, `👥 আপনার Referral যোগ হয়েছে: @${msg.from.username || msg.from.first_name}`);
  }
});

// Callback Queries
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const user = getUser(chatId);
  if (!user) return;

  switch (data) {
    case "trade_menu":
      bot.sendMessage(chatId, "🎮 কোন ব্যালেন্স ব্যবহার করবে?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Demo Balance", callback_data: "trade_demo" }],
            [{ text: "Real Balance", callback_data: "trade_real" }],
          ],
        },
      });
      break;

    case "trade_demo":
      user.activeBalance = "demo";
      chooseTradeSymbol(chatId);
      break;

    case "trade_real":
      user.activeBalance = "real";
      chooseTradeSymbol(chatId);
      break;

    case "balance":
      bot.sendMessage(chatId, `💰 আপনার ব্যালেন্স:\nDemo: $${user.demoBalance}\nReal: $${user.realBalance}`);
      break;

    case "deposit":
      pendingAction[chatId] = { type: "deposit" };
      bot.sendMessage(chatId, "➕ Deposit করতে Amount লিখুন (Min $10, Max $10000):");
      break;

    case "withdraw":
      pendingAction[chatId] = { type: "withdraw" };
      bot.sendMessage(chatId, "➖ Withdraw করতে Amount লিখুন (Min $10, Max $10000):");
      break;

    case "history":
      const history = user.tradeHistory || [];
      if (history.length === 0) bot.sendMessage(chatId, "📝 কোনো Trade History নেই।");
      else {
        let msgText = "📝 আপনার Trade History:\n\n";
        history.forEach((t, i) => {
          msgText += `${i + 1}. ${t.type.toUpperCase()} | $${t.amount} | ${t.symbol} | ${t.direction.toUpperCase()} | ${t.result.toUpperCase()} \n`;
        });
        bot.sendMessage(chatId, msgText);
      }
      break;

    case "referral":
      bot.sendMessage(chatId, `👥 আপনার Referral লিঙ্ক:\nhttps://t.me/CT_BinaryBot?start=${chatId}`);
      break;

    case "notifications":
      bot.sendMessage(chatId, "🔔 Notifications সক্রিয় হয়েছে।");
      user.notifications = true;
      break;

    default:
      if (data.startsWith("symbol_")) {
        const symbol = data.split("_")[1];
        tradePending[chatId] = { symbol };
        chooseTradeAmount(chatId);
      }
      if (data.startsWith("amount_")) {
        const amount = parseInt(data.split("_")[1]);
        tradePending[chatId].amount = amount;
        chooseTradeDirection(chatId);
      }
      if (data.startsWith("direction_")) {
        const direction = data.split("_")[1];
        tradePending[chatId].direction = direction;
        if (user.activeBalance === "demo") startDemoTrade(chatId, user, tradePending[chatId]);
        else startRealTrade(chatId, user, tradePending[chatId]);
      }
      break;
  }

  bot.answerCallbackQuery(query.id);
});

// Deposit/Withdraw Messages
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const action = pendingAction[chatId];
  if (!action) return;

  const user = getUser(chatId);
  if (!user) return;

  const amount = parseFloat(msg.text);
  if (isNaN(amount)) return bot.sendMessage(chatId, "❌ সংখ্যার মত Amount লিখুন।");
  if (amount < 10 || amount > 10000)
    return bot.sendMessage(chatId, "❌ Amount 10 - 10000 এর মধ্যে হতে হবে।");

  if (action.type === "deposit") {
    updateBalance(chatId, "realBalance", amount);
    bot.sendMessage(chatId, `✅ Deposit সফল! +$${amount}\nReal Balance: $${user.realBalance}`);
    if (user.notifications) bot.sendMessage(chatId, `🔔 Deposit Notification: +$${amount}`);
  }

  if (action.type === "withdraw") {
    if (user.realBalance < amount) return bot.sendMessage(chatId, "❌ Real Balance যথেষ্ট নয়।");
    updateBalance(chatId, "realBalance", -amount);
    bot.sendMessage(chatId, `✅ Withdraw সফল! -$${amount}\nReal Balance: $${user.realBalance}`);
    if (user.notifications) bot.sendMessage(chatId, `🔔 Withdraw Notification: -$${amount}`);
  }

  delete pendingAction[chatId];
});

// Trade Steps Functions
function chooseTradeSymbol(chatId) {
  bot.sendMessage(chatId, "🔹 কোন symbol ট্রেড করবে?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "BTCUSDT", callback_data: "symbol_BTCUSDT" }],
        [{ text: "ETHUSDT", callback_data: "symbol_ETHUSDT" }],
        [{ text: "BNBUSDT", callback_data: "symbol_BNBUSDT" }],
      ],
    },
  });
}

function chooseTradeAmount(chatId) {
  bot.sendMessage(chatId, "💵 কত টাকা ট্রেড করবে?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "$10", callback_data: "amount_10" }, { text: "$20", callback_data: "amount_20" }],
        [{ text: "$50", callback_data: "amount_50" }, { text: "$100", callback_data: "amount_100" }],
      ],
    },
  });
}

function chooseTradeDirection(chatId) {
  bot.sendMessage(chatId, "⬆️ বা ⬇️?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "UP", callback_data: "direction_up" }, { text: "DOWN", callback_data: "direction_down" }],
      ],
    },
  });
}

// Demo Trade (70–80% Win)
function startDemoTrade(chatId, user, trade) {
  const balanceName = "demoBalance";
  const { symbol, amount, direction } = trade;
  const expiryTime = Math.random() < 0.5 ? 60000 : 120000; // 1 বা 2 মিনিট

  bot.sendMessage(chatId, `${symbol} ${direction} ট্রেড শুরু হয়েছে। ⏱️ Expiry: ${expiryTime / 1000} sec`);

  setTimeout(() => {
    let win = randomChance(0.75);
    if (win) {
      const profit = amount * 1;
      updateBalance(chatId, balanceName, profit);
      addTradeHistory(chatId, "demo", amount, "win", symbol, direction);
      bot.sendMessage(chatId, `✅ জয়! +$${profit}\nDemo Balance: $${user[balanceName]}`);
    } else {
      updateBalance(chatId, balanceName, -amount);
      addTradeHistory(chatId, "demo", amount, "loss", symbol, direction);
      bot.sendMessage(chatId, `❌ হার! -$${amount}\nDemo Balance: $${user[balanceName]}`);
    }
  }, expiryTime);
}

// Real Trade (20–25% Win)
async function startRealTrade(chatId, user, trade) {
  const balanceName = "realBalance";
  const { symbol, amount, direction } = trade;
  const entryPrice = await getLiveMarketPrice(symbol);
  const expiryTime = Math.random() < 0.5 ? 60000 : 120000;

  bot.sendMessage(chatId, `${symbol} ${direction} ট্রেড শুরু হয়েছে। ⏱️ Expiry: ${expiryTime / 1000} sec\nEntry Price: $${entryPrice}`);

  setTimeout(async () => {
    const exitPrice = await getLiveMarketPrice(symbol);
    let win = false;
    if (direction === "up" && exitPrice > entryPrice) win = randomChance(0.25);
    if (direction === "down" && exitPrice < entryPrice) win = randomChance(0.25);

    if (win) {
      const profit = amount * 0.8;
      updateBalance(chatId, balanceName, profit);
      addTradeHistory(chatId, "real", amount, "win", symbol, direction);
      if (user.referrerId) addReferralCommission(user.referrerId, amount * 0.02);
      bot.sendMessage(chatId, `✅ জয়! +$${profit}\nExit Price: $${exitPrice}\nReal Balance: $${user[balanceName]}`);
    } else {
      updateBalance(chatId, balanceName, -amount);
      addTradeHistory(chatId, "real", amount, "loss", symbol, direction);
      bot.sendMessage(chatId, `❌ হার! -$${amount}\nExit Price: $${exitPrice}\nReal Balance: $${user[balanceName]}`);
    }
  }, expiryTime);
}
