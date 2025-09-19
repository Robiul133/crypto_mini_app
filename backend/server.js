require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const nodemailer = require('nodemailer');
const db = require('./database');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://crypto-mini-bot.netlify.app/';
const PORT = process.env.PORT || 4000;

if (!TELEGRAM_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

/* ------------------ Telegram Bot ------------------ */
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

/* ---------------------- Nodemailer ---------------------- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/* ---------------------- User APIs ---------------------- */
app.post('/api/register', async (req,res)=>{
  const {firstName,lastName,email,password} = req.body;
  if(db.getUserByEmail(email)) return res.json({ok:false,error:'Email already registered'});

  const verificationCode = Math.floor(100000 + Math.random()*900000);
  const user = db.addUserWithEmail(firstName,lastName,email,password,verificationCode);

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: 'Verify your Crypto Mini Account',
    text: `Your verification code: ${verificationCode}`
  });

  res.json({ok:true,message:'Verification code sent to email'});
});

app.post('/api/verify-email',(req,res)=>{
  const {email,code} = req.body;
  const user = db.getUserByEmail(email);
  if(!user) return res.json({ok:false,error:'User not found'});
  if(user.verificationCode != code) return res.json({ok:false,error:'Invalid code'});

  user.verified = true;
  db.save();
  res.json({ok:true,message:'Email verified, you can login now'});
});

app.post('/api/login',(req,res)=>{
  const {email,password} = req.body;
  const user = db.getUserByEmail(email);
  if(!user) return res.json({ok:false,error:'User not found'});
  if(!user.verified) return res.json({ok:false,error:'Email not verified'});
  if(user.password !== password) return res.json({ok:false,error:'Wrong password'});
  res.json({ok:true,user});
});

/* ---------------------- Trade APIs ---------------------- */
app.post('/api/trade', (req, res) => {
  const { userId, market, amount, direction, result, profit, mode } = req.body;
  const time = Date.now();
  const tradeObj = { userId, market, amount, direction, result, profit: profit||0, mode, time };
  db.addTrade(String(userId), tradeObj);

  if (result === 'win') {
    const field = mode === 'demo' ? 'demoBalance' : 'realBalance';
    db.updateBalance(String(userId), field, profit);
    const user = db.getUser(String(userId));
    if(user && user.referrerId){
      const commission = amount * 0.02;
      db.addReferralEarned(String(user.referrerId), commission);
    }
  } else if (result === 'loss') {
    const field = mode === 'demo' ? 'demoBalance' : 'realBalance';
    db.updateBalance(String(userId), field, -amount);
  }
  res.json({ ok:true, trade: tradeObj });
});

/* ---------------------- Deposit & Withdraw APIs ---------------------- */
app.post('/api/deposit',(req,res)=>{
  const {userId,amount,method} = req.body;
  const dep = db.addDeposit(userId,amount,method);
  res.json({ok:true,deposit:dep});
});

app.post('/api/withdraw',(req,res)=>{
  const {userId,amount,method,email} = req.body;
  const user = db.getUser(userId);
  if(!user) return res.json({ok:false,error:'User not found'});
  if(user.realBalance < amount) return res.json({ok:false,error:'Insufficient balance'});

  const code = Math.floor(100000 + Math.random()*900000);
  user.withdrawCode = code;
  db.save();

  transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: 'Crypto Mini Withdraw Verification',
    text: `Your withdraw verification code: ${code}`
  });

  res.json({ok:true,message:'Verification code sent to email'});
});

app.post('/api/confirm-withdraw',(req,res)=>{
  const {userId,code,amount,method} = req.body;
  const user = db.getUser(userId);
  if(!user) return res.json({ok:false,error:'User not found'});
  if(user.withdrawCode != code) return res.json({ok:false,error:'Invalid code'});

  user.realBalance -= amount;
  db.addWithdrawal(userId,amount,method);
  user.withdrawCode = null;
  db.save();
  res.json({ok:true,message:'Withdraw successful'});
});

app.get('/',(req,res)=>res.send('Mini App API running'));

app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
