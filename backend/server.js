require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const db = require('./database');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://crypto-mini-bot.netlify.app/'; // set env
const PORT = process.env.PORT || 4000;

if (!TELEGRAM_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

/* ------------------ Telegram Bot (simple) ------------------ */
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('Telegram bot started.');

bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const param = match && match[1];
  db.addUser(String(chatId), msg.from.username || null);
  if (param && param.startsWith('ref_')) {
    const refId = param.split('_')[1];
    db.setReferrer(String(chatId), refId);
  }
  bot.sendMessage(chatId, `👋 স্বাগতম Crypto Mini App!\nDemo: $1000 (auto), Real: $0\nOpen Mini App দিয়ে ট্রেড করুন।`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Open Mini App', web_app: { url: WEB_APP_URL } }],
        [{ text: '💰 Balance', callback_data: 'balance' }, { text: '📝 History', callback_data: 'history' }],
        [{ text: '👥 Referral', callback_data: 'referral' }, { text: '🔔 Support', callback_data: 'support' }]
      ]
    }
  });
});

bot.on('callback_query', (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const user = db.getUser(String(chatId)) || db.addUser(String(chatId), q.message.chat.username || null);

  if (data === 'balance') {
    bot.sendMessage(chatId, `💰 আপনার ব্যালেন্স:\nDemo: $${user.demoBalance}\nReal: $${user.realBalance}`);
  } else if (data === 'history') {
    const h = user.tradeHistory || [];
    if (h.length === 0) return bot.sendMessage(chatId, '📝 কোনো ট্রেড ইতিহাস নেই।');
    let txt = '📝 টপ 10 ট্রেড:\n';
    h.slice(-10).reverse().forEach((t,i) => {
      txt += `${i+1}. ${t.market} ${t.amount}$ ${t.direction} => ${t.result.toUpperCase()}\n`;
    });
    bot.sendMessage(chatId, txt);
  } else if (data === 'referral') {
    const link = `https://t.me/${(q.from.username||'') || 'yourbot'}?start=ref_${chatId}`;
    bot.sendMessage(chatId, `👥 আপনার রেফারেল লিঙ্ক:\n${link}`);
  } else if (data === 'support') {
    bot.sendMessage(chatId, 'Support: https://t.me/cryptotradeappss');
  }
  bot.answerCallbackQuery(q.id);
});

/* ------------------ Express API ------------------ */
const app = express();
app.use(cors());
app.use(bodyParser.json());

// simple endpoints to be used by frontend
// NOTE: in production protect these with auth (session/jwt)
app.get('/api/user/:id', (req, res) => {
  const user = db.getUser(String(req.params.id)) || null;
  res.json({ ok: true, user });
});

app.post('/api/create_user', (req, res) => {
  const { id, username } = req.body;
  const user = db.addUser(String(id), username || null);
  res.json({ ok:true, user });
});

// record trade result (frontend triggers when trade resolves)
app.post('/api/trade', (req, res) => {
  const { userId, market, amount, direction, result, profit, mode } = req.body;
  const time = Date.now();
  const tradeObj = { userId, market, amount, direction, result, profit: profit||0, mode, time };
  db.addTrade(String(userId), tradeObj);

  if (result === 'win') {
    // credit balance: for demo mode credit demoBalance; for real, credit realBalance
    const field = mode === 'demo' ? 'demoBalance' : 'realBalance';
    db.updateBalance(String(userId), field, profit);
    // referral: if user has referrer, pay 2% of trade volume to referrer as referralEarned (not auto-withdraw)
    const user = db.getUser(String(userId));
    if (user && user.referrerId) {
      const commission = amount * 0.02;
      db.addReferralEarned(String(user.referrerId), commission);
    }
  } else if (result === 'loss') {
    const field = mode === 'demo' ? 'demoBalance' : 'realBalance';
    db.updateBalance(String(userId), field, -amount);
  }
  res.json({ ok:true, trade: tradeObj });
});

// deposit record - for manual admin credit later
app.post('/api/deposit', (req, res) => {
  const { userId, amount, method, txid } = req.body;
  const obj = { userId, amount, method, txid, time: Date.now(), status: 'pending' };
  db.addDeposit(String(userId), obj);
  res.json({ ok:true, deposit: obj });
});

// withdraw request
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, address } = req.body;
  const user = db.getUser(String(userId));
  if (!user || user.realBalance < amount) return res.json({ ok:false, error:'Insufficient balance' });
  const obj = { userId, amount, address, time: Date.now(), status: 'pending' };
  db.addWithdrawal(String(userId), obj);
  // hold realBalance until admin processes (optionally deduct instantly)
  res.json({ ok:true, withdrawal: obj });
});

app.get('/', (req, res) => res.send('Mini App API running'));

app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});
