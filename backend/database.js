const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ users: {}, trades: [], deposits: [], withdrawals: [] }, null, 2)
  );
}

function load() {
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const db = load();

module.exports = {
  save: () => save(db),

  /* ---------------- Users ---------------- */
  getUser(id) {
    return db.users[id] || null;
  },

  getUserByEmail(email) {
    return Object.values(db.users).find(u => u.email === email) || null;
  },

  addUserWithEmail(first, last, email, password, verificationCode) {
    const id = Date.now().toString();
    db.users[id] = {
      id,
      first,
      last,
      email,
      password,
      verified: false,
      verificationCode,
      demoBalance: 1000,
      realBalance: 0,
      tradeHistory: [],
      referrerId: null,
      withdrawCode: null
    };
    save(db);
    return db.users[id];
  },

  addUser(id, username = null) {
    if (!db.users[id]) {
      db.users[id] = {
        id,
        username,
        demoBalance: 1000,
        realBalance: 0,
        tradeHistory: [],
        referrerId: null,
        withdrawCode: null
      };
      save(db);
    }
    return db.users[id];
  },

  setReferrer(id, refId) {
    if (db.users[id]) {
      db.users[id].referrerId = refId;
      save(db);
    }
  },

  /* ---------------- Balance ---------------- */
  updateBalance(userId, field, amount) {
    const user = db.users[userId];
    if (!user) return;
    if (field === 'demoBalance' || field === 'realBalance') {
      user[field] = (user[field] || 0) + amount;
      save(db);
    }
  },

  addReferralEarned(userId, amount) {
    const user = db.users[userId];
    if (!user) return;
    user.referralEarned = (user.referralEarned || 0) + amount;
    save(db);
  },

  /* ---------------- Trade ---------------- */
  addTrade(userId, trade) {
    db.trades.push(trade);
    if (db.users[userId]) {
      db.users[userId].tradeHistory.push(trade);
    }
    save(db);
  },

  /* ---------------- Deposit & Withdraw ---------------- */
  addDeposit(userId, amount, method) {
    const dep = { userId, amount, method, time: Date.now(), status: 'pending' };
    db.deposits.push(dep);
    save(db);
    return dep;
  },

  addWithdrawal(userId, amount, method) {
    const wd = { userId, amount, method, time: Date.now(), status: 'success' };
    db.withdrawals.push(wd);
    save(db);
    return wd;
  }
};
