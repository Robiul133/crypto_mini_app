// database.js - tiny file DB for demo starter (not for production)
const fs = require('fs');
const path = require('path');
const DB_FILE = path.join(__dirname, 'db.json');

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    users: {}, trades: [], deposits: [], withdrawals: []
  }, null, 2));
}

function read() {
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function write(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function addUser(id, username = null) {
  const db = read();
  if (!db.users[id]) {
    db.users[id] = {
      id,
      username,
      demoBalance: 1000,
      realBalance: 0,
      tradeHistory: [],
      deposits: [],
      withdrawals: [],
      referrerId: null,
      referralEarned: 0
    };
    write(db);
  }
  return db.users[id];
}

function getUser(id) {
  const db = read();
  return db.users[id] || null;
}

function updateBalance(id, field, delta) {
  const db = read();
  if (!db.users[id]) return null;
  db.users[id][field] = (db.users[id][field] || 0) + delta;
  write(db);
  return db.users[id];
}

function addTrade(id, tradeObj) {
  const db = read();
  db.trades.push(tradeObj);
  if (db.users[id]) db.users[id].tradeHistory.push(tradeObj);
  write(db);
}

function addDeposit(id, obj) {
  const db = read();
  db.deposits.push(obj);
  if (db.users[id]) db.users[id].deposits.push(obj);
  write(db);
}

function addWithdrawal(id, obj) {
  const db = read();
  db.withdrawals.push(obj);
  if (db.users[id]) db.users[id].withdrawals.push(obj);
  write(db);
}

function setReferrer(userId, refId) {
  const db = read();
  if (db.users[userId] && !db.users[userId].referrerId) {
    db.users[userId].referrerId = refId;
    write(db);
  }
}

function addReferralEarned(refId, amount) {
  const db = read();
  if (db.users[refId]) {
    db.users[refId].referralEarned = (db.users[refId].referralEarned||0) + amount;
    write(db);
  }
}

module.exports = {
  addUser, getUser, updateBalance, addTrade, addDeposit, addWithdrawal, setReferrer, addReferralEarned
};
