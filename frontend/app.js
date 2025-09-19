// frontend/app.js
// Live Binance websockets for candlesticks + real trade resolution (no simulation)

// CONFIG
const BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws";
const BINANCE_KLINES_REST = "https://api.binance.com/api/v3/klines";
const BINANCE_PRICE_REST = "https://api.binance.com/api/v3/ticker/price";

let demoBalance = 1000;
let realBalance = 0;
let chart = null;
let chartSymbol = "BTCUSDT";
let chartInterval = "1m";
let candleLimit = 80; // number of candles to show

// pendingTrades: array of { id, mode, market, interval, amount, position, entryTime (ms), entryPrice, placedAt }
let pendingTrades = [];

// utility: interval in ms
const intervalMsMap = { "1m": 60_000, "5m": 300_000, "15m": 900_000 };

// UI helpers
function updateBalancesUI() {
  document.getElementById('demo-balance').innerText = `$${demoBalance.toFixed(2)}`;
  document.getElementById('real-balance').innerText = `$${realBalance.toFixed(2)}`;
}

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function pushTradeHistory(entry) {
  // store entry at beginning, keep full list in memory
  const container = document.getElementById('trade-history');
  const d = document.createElement('div');
  d.className = 'trade-entry';
  d.innerHTML = `<strong>[${entry.mode}] ${entry.market}</strong> ${entry.position} — $${entry.amount} — <strong>${entry.result}</strong> <span class="small">(@entry ${entry.entryPrice}, exit ${entry.exitPrice || '—'})</span><div class="small">${new Date(entry.time).toLocaleString()}</div>`;
  container.prepend(d);
}

// fetch live price for display fallback
async function fetchLivePrice(symbol) {
  try {
    const r = await fetch(`${BINANCE_PRICE_REST}?symbol=${symbol}`);
    const j = await r.json();
    return Number(j.price);
  } catch (e) {
    console.error('fetchLivePrice err', e);
    return null;
  }
}

// fetch initial candles (REST) to populate chart
async function fetchInitialCandles(symbol = chartSymbol, interval = chartInterval, limit = candleLimit) {
  try {
    const res = await fetch(`${BINANCE_KLINES_REST}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const data = await res.json();
    // convert to {x: Date, o,h,l,c}
    return data.map(d => ({
      x: new Date(d[0]),
      o: Number(d[1]),
      h: Number(d[2]),
      l: Number(d[3]),
      c: Number(d[4])
    }));
  } catch (e) {
    console.error('fetchInitialCandles err', e);
    return [];
  }
}

/* -------------------------
   WebSocket handling
   We'll open one ws per (symbol,interval) combination.
   When user switches market/interval we reconnect.
   We listen to "kline" events and:
     - update live chart (both open and closed candles)
     - when a kline with k.x === true (closed) arrives, we resolve pending trades whose entryTime < closedTime for that (symbol,interval)
   ------------------------- */

let ws = null;
let lastCandles = []; // current dataset for chart (array of {x,o,h,l,c})

// build ws url for symbol & interval (symbol lowercased)
function buildWsUrl(symbol, interval) {
  return `${BINANCE_WS_BASE}/${symbol.toLowerCase()}@kline_${interval}`;
}

function connectWs(symbol, interval) {
  // cleanup previous
  if (ws) {
    try { ws.close(); } catch(e){/*ignore*/ }
    ws = null;
  }

  const url = buildWsUrl(symbol, interval);
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('WS open', url);
    document.getElementById('live-price-display').innerText = 'connected';
  };

  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      // kline payload at data.k
      if (!data || !data.k) return;
      const k = data.k;
      const candle = {
        x: new Date(k.t),
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        isFinal: Boolean(k.x)
      };

      // update lastCandles: last element is the "current" open candle; replace or push
      if (lastCandles.length === 0) {
        // nothing - push
        lastCandles.push(candle);
      } else {
        const last = lastCandles[lastCandles.length - 1];
        if (last.x.getTime() === candle.x.getTime()) {
          // same candle timestamp - replace
          lastCandles[lastCandles.length - 1] = candle;
        } else if (candle.x.getTime() > last.x.getTime()) {
          // new candle - push
          lastCandles.push(candle);
          // keep limit
          if (lastCandles.length > candleLimit) lastCandles.shift();
        } else {
          // older candle - ignore
        }
      }

      // update chart dataset
      if (chart) {
        chart.data.datasets[0].data = lastCandles.map(c => ({ x: c.x, o: c.o, h: c.h, l: c.l, c: c.c }));
        chart.update();
      }

      // update live price display with latest close (or current close)
      document.getElementById('live-price-display').innerText = Number(candle.c).toFixed(6);

      // if candle is final (closed), resolve any pending trades for same symbol+interval
      if (candle.isFinal) {
        resolvePendingTradesForClosedCandle(symbol, interval, candle);
      }
    } catch (e) {
      console.error('WS msg parse err', e);
    }
  };

  ws.onerror = (e) => {
    console.error('WS error', e);
  };

  ws.onclose = (e) => {
    console.log('WS closed', e.reason);
    document.getElementById('live-price-display').innerText = 'disconnected';
    // attempt reconnect after a short delay
    setTimeout(() => {
      // only reconnect if still matches current chartSymbol/chartInterval
      if (chartSymbol === symbol && chartInterval === interval) connectWs(symbol, interval);
    }, 3000);
  };
}

/* -------------------------
   Trade placement & resolution
   - placeTrade() records entry as last CLOSED candle's close (if exists)
   - pendingTrades[] keeps trades waiting for the next CLOSE for that (symbol,interval)
   - when a closed kline arrives, resolve trades whose entryTime < closedTime
   ------------------------- */

function placeTrade(position) {
  const amountEl = document.getElementById('trade-amount');
  const amount = Number(amountEl.value);
  const mode = document.getElementById('trade-mode').value;
  const market = document.getElementById('market-select').value;
  const interval = document.getElementById('interval-select').value;

  // validation
  if (!amount || amount < 1 || amount > 1000) { alert('Amount must be between $1 and $1000'); return; }
  if (mode === 'demo' && amount > demoBalance) { alert('Insufficient demo balance'); return; }
  if (mode === 'real' && amount > realBalance) { alert('Insufficient real balance'); return; }

  // need last closed candle for this symbol+interval
  // lastCandles holds current dataset for chartSymbol/chartInterval; ensure symbol/interval match current chart
  if (market !== chartSymbol || interval !== chartInterval) {
    // quick sync: update the chartSymbol/interval and reconnect WS then ask user to place again
    chartSymbol = market; chartInterval = interval;
    initializeChartAndWs(); // this will fetch REST & connect ws
    alert(' switched market/interval — please click UP or DOWN again after data loads (no simulation).');
    return;
  }

  // find last CLOSED candle in lastCandles (the most recent where isFinal !== false)
  // because lastCandles contains live open candle (not final) at end, we scan from end to find most recent final
  let lastClosed = null;
  for (let i = lastCandles.length - 1; i >= 0; i--) {
    const c = lastCandles[i];
    // We don't store isFinal flag for REST candles; treat all except newest open (which comes from ws and has isFinal false) as closed.
    // Heuristic: if lastCandles length>1 then lastCandles[last] may be open; the previous one is last closed.
    if (i === lastCandles.length - 1) {
      // if this candle was marked isFinal === false it is open; skip
      if (c.isFinal === false) continue;
    }
    // treat as closed
    lastClosed = c;
    break;
  }
  // fallback: if not found, use second last element
  if (!lastClosed && lastCandles.length >= 2) {
    lastClosed = lastCandles[lastCandles.length - 2];
  }
  if (!lastClosed) {
    alert('No closed candle available yet. Please wait a moment and try again.');
    return;
  }

  const entryPrice = Number(lastClosed.c);
  const entryTime = lastClosed.x.getTime();

  // create pending trade
  const trade = {
    id: Date.now().toString(),
    mode, market, interval, amount, position,
    entryPrice, entryTime, time: Date.now()
  };
  pendingTrades.push(trade);

  // show pending in history UI
  pushTradeHistoryUI({
    id: trade.id, mode: trade.mode, market: trade.market,
    position: trade.position, amount: trade.amount,
    result: 'PENDING', entryPrice: entryPrice.toFixed(6),
    time: trade.time
  });

  // clear input
  amountEl.value = '';

  alert(`Trade placed: ${position} ${market} $${amount} — result will be determined at next ${interval} candle close (no simulation).`);
}

// When a candle closes (final), resolve pending trades whose entryTime < closedTime for matching symbol+interval
function resolvePendingTradesForClosedCandle(symbol, interval, closedCandle) {
  const closedTime = closedCandle.x.getTime();
  const exitPrice = Number(closedCandle.c);

  // resolve in FIFO order for matching trades
  const toResolve = pendingTrades.filter(t => t.market === symbol && t.interval === interval && t.entryTime < closedTime);

  toResolve.forEach(trade => {
    const won = (trade.position.toLowerCase() === 'up' && exitPrice > trade.entryPrice) ||
                (trade.position.toLowerCase() === 'down' && exitPrice < trade.entryPrice);
    const result = won ? 'Win' : 'Loss';

    // payout rule: Win -> +85% of amount, Loss -> -100% of amount
    if (trade.mode === 'demo') {
      demoBalance += won ? trade.amount * 0.85 : -trade.amount;
    } else {
      realBalance += won ? trade.amount * 0.85 : -trade.amount;
    }

    // update UI history: replace pending row (we appended a pending) by final entry — simplest: prepend final
    pushTradeHistoryUI({
      id: trade.id,
      mode: trade.mode,
      market: trade.market,
      position: trade.position,
      amount: trade.amount,
      result,
      entryPrice: trade.entryPrice.toFixed(6),
      exitPrice: exitPrice.toFixed(6),
      time: Date.now()
    });

    // remove from pendingTrades
    pendingTrades = pendingTrades.filter(p => p.id !== trade.id);
    updateBalancesUI();
  });
}

// history UI helpers: we keep pending entries visible; final ones prepend
function pushTradeHistoryUI(obj) {
  // obj fields: id, mode, market, position, amount, result, entryPrice, exitPrice?, time
  const container = document.getElementById('trade-history');
  const d = document.createElement('div');
  d.className = 'trade-entry';
  d.dataset.id = obj.id || '';
  d.innerHTML = `<strong>[${obj.mode}] ${obj.market}</strong> ${obj.position} — $${obj.amount} — <strong>${obj.result}</strong> <span class="small">(@entry ${obj.entryPrice || '—'} ${obj.exitPrice? ', exit '+obj.exitPrice : ''})</span><div class="small">${new Date(obj.time).toLocaleString()}</div>`;
  container.prepend(d);
}

// Draw & update chart dataset from lastCandles array
async function drawInitialChartAndConnect() {
  // fetch initial candles via REST
  lastCandles = await fetchInitialCandles(chartSymbol, chartInterval, candleLimit);
  const dataset = lastCandles.map(k => ({ x: k.x, o: k.o, h: k.h, l: k.l, c: k.c }));

  const canvas = document.getElementById('candleChart');
  const ctx = canvas.getContext('2d');

  if (chart) { chart.destroy(); chart = null; }

  chart = new Chart(ctx, {
    type: 'candlestick',
    data: { datasets: [{ label: chartSymbol, data: dataset }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'MMM dd HH:mm' } },
        y: { beginAtZero: false }
      }
    }
  });

  // connect websocket for live updates
  connectWs(chartSymbol, chartInterval);

  // update live price display
  const p = await fetchLivePrice(chartSymbol);
  if (p !== null) document.getElementById('live-price-display').innerText = p.toFixed(6);
}

// helper: fetch initial candles used above
async function fetchInitialCandles(symbol, interval, limit) {
  try {
    const res = await fetch(`${BINANCE_KLINES_REST}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const data = await res.json();
    // map to objects with x date
    return data.map(d => ({
      x: new Date(d[0]),
      o: Number(d[1]),
      h: Number(d[2]),
      l: Number(d[3]),
      c: Number(d[4])
    }));
  } catch (e) {
    console.error('fetchInitialCandles err', e);
    return [];
  }
}

// UI event bindings
document.getElementById('btn-up').addEventListener('click', () => placeTrade('up'));
document.getElementById('btn-down').addEventListener('click', () => placeTrade('down'));
document.getElementById('reset-demo-btn').addEventListener('click', () => { demoBalance = 1000; updateBalancesUI(); alert('Demo balance reset to $1000'); });
document.getElementById('market-select').addEventListener('change', (e) => {
  chartSymbol = e.target.value;
  initializeChartAndWs();
});
document.getElementById('interval-select').addEventListener('change', (e) => {
  chartInterval = e.target.value;
  initializeChartAndWs();
});

// wrapper to init chart + ws
async function initializeChartAndWs() {
  // small UI feedback
  document.getElementById('live-price-display').innerText = 'loading...';
  await drawInitialChartAndConnect();
}

// initial load
updateBalancesUI();
initializeChartAndWs();

// periodic safety refresh: every 60s re-fetch initial candles to avoid desync
setInterval(() => {
  // only re-fetch (not recreate) if chartSymbol/chartInterval unchanged
  initializeChartAndWs();
}, 60_000);
