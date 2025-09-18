// frontend/app.js

// -----------------------------
// CONFIGURATION
// -----------------------------

// Binance API endpoint
const BINANCE_API_URL = "https://api.binance.com/api/v3/klines";

// Demo & Real balances
let demoBalance = 1000;       // $1000 ডেমো ব্যালেন্স
let realBalance = 0;          // শুরুতে 0, ডিপোজিট করলে বাড়বে

// Trade settings
const minTrade = 1;           // $1
const maxTrade = 1000;        // $1000
const payoutPercent = 0.85;   // Win → 85%
const lossPercent = 1;        // Loss → 100%

// Timeframes in minutes
const timeframes = [1, 2, 5]; // 1m, 2m, 5m

// Demo win rate: 70-80%, Real win rate: 20-25%
const demoWinRate = 0.75;
const realWinRate = 0.22;

// Selected market & interval
let selectedMarket = "BTCUSDT";
let selectedInterval = "1m";

// -----------------------------
// UTILITY FUNCTIONS
// -----------------------------

// Fetch candlestick data from Binance
async function fetchCandles(symbol = selectedMarket, interval = selectedInterval, limit = 100) {
  try {
    const response = await fetch(`${BINANCE_API_URL}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const data = await response.json();
    return data.map(c => ({
      openTime: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  } catch (err) {
    console.error("Error fetching candles:", err);
    return [];
  }
}

// Generate random trade outcome based on win rate
function simulateTrade(isDemo = true) {
  const winRate = isDemo ? demoWinRate : realWinRate;
  return Math.random() <= winRate; // true = win, false = loss
}

// Place a trade
function placeTrade(amount, isDemo = true) {
  if (amount < minTrade || amount > maxTrade) {
    alert(`Trade amount must be between $${minTrade} and $${maxTrade}`);
    return;
  }

  let balance = isDemo ? demoBalance : realBalance;
  const won = simulateTrade(isDemo);

  if (won) {
    balance += amount * payoutPercent;
    alert(`🎉 You won! +$${(amount * payoutPercent).toFixed(2)}`);
  } else {
    balance -= amount * lossPercent;
    alert(`💸 You lost -$${(amount * lossPercent).toFixed(2)}`);
  }

  if (isDemo) demoBalance = balance;
  else realBalance = balance;

  updateBalances();
  addTradeHistory(amount, won, isDemo);
}

// Update balances on UI
function updateBalances() {
  document.getElementById("demo-balance").innerText = `$${demoBalance.toFixed(2)}`;
  document.getElementById("real-balance").innerText = `$${realBalance.toFixed(2)}`;
}

// Trade history
let tradeHistory = [];
function addTradeHistory(amount, won, isDemo) {
  tradeHistory.push({
    time: new Date().toLocaleTimeString(),
    market: selectedMarket,
    amount,
    won,
    type: isDemo ? "Demo" : "Real"
  });
  renderTradeHistory();
}

function renderTradeHistory() {
  const container = document.getElementById("trade-history");
  container.innerHTML = "";
  tradeHistory.slice(-10).reverse().forEach(trade => {
    const div = document.createElement("div");
    div.className = "trade-entry";
    div.innerText = `[${trade.type}] ${trade.time} | ${trade.market} | $${trade.amount} | ${trade.won ? "Win" : "Loss"}`;
    container.appendChild(div);
  });
}

// -----------------------------
// EVENT LISTENERS
// -----------------------------

document.getElementById("trade-btn").addEventListener("click", () => {
  const amount = parseFloat(document.getElementById("trade-amount").value);
  const isDemo = document.getElementById("trade-mode").value === "demo";
  placeTrade(amount, isDemo);
});

document.getElementById("market-select").addEventListener("change", (e) => {
  selectedMarket = e.target.value;
});

document.getElementById("interval-select").addEventListener("change", (e) => {
  selectedInterval = e.target.value;
});

// -----------------------------
// INITIAL SETUP
// -----------------------------

// Set default balances
updateBalances();

// Fetch initial candle data (optional, can be used for chart)
fetchCandles().then(candles => {
  console.log("Latest candles:", candles.slice(-5));
});
