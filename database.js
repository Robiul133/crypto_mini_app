// database.js

// ইউজারদের ডেটা (Demo + Real + Referral + Trade History)
let users = {};

// নতুন ইউজার এড করা
function addUser(userId, referrerId = null) {
  if (!users[userId]) {
    users[userId] = {
      demoBalance: 1000,       // ফ্রি ডেমো ব্যালেন্স
      realBalance: 0,          // আসল ডিপোজিট ব্যালেন্স
      activeBalance: "demo",   // ডিফল্ট ব্যালেন্স
      tradeHistory: [],        // Trade History
      referrerId: referrerId,  // রেফারার আইডি
      referralCommission: 0,   // রেফারাল কমিশন
      notifications: false,    // নোটিফিকেশন
    };
  }
  return users[userId];
}

// ইউজারের ব্যালেন্স আপডেট করা
function updateBalance(userId, type, amount) {
  if (users[userId]) {
    users[userId][type] += amount;
  }
}

// ইউজারের ডেটা পাওয়া
function getUser(userId) {
  return users[userId];
}

// Trade History এড করা
function addTradeHistory(userId, type, amount, result, symbol, direction) {
  if (users[userId]) {
    users[userId].tradeHistory.push({
      type,        // demo বা real
      amount,      // ট্রেডের অ্যামাউন্ট
      result,      // win বা loss
      symbol,      // BTCUSDT, ETHUSDT ইত্যাদি
      direction,   // up বা down
      time: new Date().toLocaleString(), // ট্রেড টাইম
    });
  }
}

// Referral Commission এড করা
function addReferralCommission(referrerId, amount) {
  if (users[referrerId]) {
    users[referrerId].referralCommission += amount;
  }
}

module.exports = {
  addUser,
  getUser,
  updateBalance,
  addTradeHistory,
  addReferralCommission,
};
