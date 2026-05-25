const axios = require("axios");
const WebSocket = require("ws");
const http = require("http");
const url = require("url");
const { RSI, EMA, MACD } = require("technicalindicators");

// Import engines
const { detectFVG } = require("./engines/fvg");
const { detectOrderBlocks } = require("./engines/orderblocks");
const { detectLiquiditySweep } = require("./engines/liqudity");
const { getSwings, detectBOS, detectCHOCH } = require("./engines/structure");
const { PaperAccount } = require("./papertrade");
const { generateTradePlan } = require("./engines/risk");

let SYMBOL = "ETHUSDT";
let INTERVAL = "1m";
const PORT = 3005;

const account = new PaperAccount(10000); // Start with $10,000
let activePosition = null; // { side: 'BUY'|'SELL', entry, sl, tp, time }
let klines = [];
let clients = new Set();
let binanceWs = null;
let currentPrice = 0; // Store live price tick globally
let autoTradeEnabled = true; // Auto-trading state

async function getHistoricalKlines() {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=120`;
    const response = await axios.get(url);
    klines = response.data;
    if (klines.length > 0) {
      currentPrice = parseFloat(klines[klines.length - 1][4]);
    }
    console.log(`[INIT] Loaded ${klines.length} historical ${INTERVAL} candles for ${SYMBOL}`);
  } catch (err) {
    console.error(`[ERROR] Failed to load historical klines: ${err.message}`);
  }
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (let client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function analyzeAndTrade(price) {
  if (klines.length < 50) return;

  const latestCandle = klines[klines.length - 1];
  latestCandle[4] = price.toString(); // Close
  latestCandle[2] = Math.max(parseFloat(latestCandle[2]), price).toString(); // High
  latestCandle[3] = Math.min(parseFloat(latestCandle[3]), price).toString(); // Low

  // Check active position
  if (activePosition) {
    let closed = false;
    let result = "";

    if (activePosition.side === "BUY") {
      if (price >= activePosition.tp) {
        closed = true;
        result = "win";
      } else if (price <= activePosition.sl) {
        closed = true;
        result = "loss";
      }
    } else if (activePosition.side === "SELL") {
      if (price <= activePosition.tp) {
        closed = true;
        result = "win";
      } else if (price >= activePosition.sl) {
        closed = true;
        result = "loss";
      }
    }

    if (closed) {
      account.executeTrade({
        symbol: SYMBOL,
        side: activePosition.side,
        entry: activePosition.entry,
        sl: activePosition.sl,
        tp: activePosition.tp,
        result: result
      });

      const lastTrade = account.trades[account.trades.length - 1];
      console.log(`\n🎉 [TRADE CLOSED] ${activePosition.side} @ $${price} | Result: ${result.toUpperCase()} | PnL: $${lastTrade.pnl.toFixed(2)}\n`);
      
      broadcast({
        type: "trade_closed",
        trade: lastTrade,
        balance: account.balance
      });

      activePosition = null;
    }
    return;
  }

  // If auto-trading is turned off, do not seek auto entry
  if (!autoTradeEnabled) return;

  // Evaluate entry criteria
  const closes = klines.map(k => parseFloat(k[4]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));

  // Indicators
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const trend = lastEma20 > lastEma50 ? "bullish" : "bearish";

  // SMC
  const sweeps = detectLiquiditySweep(highs, lows);
  const orderBlocks = detectOrderBlocks(klines);

  const isBullishSetup = (trend === "bullish" && (sweeps.sweepLow || orderBlocks.some(ob => ob.type === "bullish" && price <= ob.high && price >= ob.low)));
  const isBearishSetup = (trend === "bearish" && (sweeps.sweepHigh || orderBlocks.some(ob => ob.type === "bearish" && price >= ob.low && price <= ob.high)));

  if (isBullishSetup) {
    const plan = generateTradePlan("bullish", price);
    activePosition = {
      side: "BUY",
      entry: price,
      sl: parseFloat(plan.stoploss),
      tp: parseFloat(plan.target),
      time: Date.now()
    };
    console.log(`\n🚀 [LONG ENTRY] BUY @ $${price} | SL: $${activePosition.sl} | TP: $${activePosition.tp}`);
    broadcast({
      type: "trade_opened",
      activePosition
    });
  } else if (isBearishSetup) {
    const plan = generateTradePlan("bearish", price);
    activePosition = {
      side: "SELL",
      entry: price,
      sl: parseFloat(plan.stoploss),
      tp: parseFloat(plan.target),
      time: Date.now()
    };
    console.log(`\n🚀 [SHORT ENTRY] SELL @ $${price} | SL: $${activePosition.sl} | TP: $${activePosition.tp}`);
    broadcast({
      type: "trade_opened",
      activePosition
    });
  }
}

function startRealTimeFeed() {
  if (binanceWs) {
    try {
      binanceWs.terminate();
    } catch (e) {
      console.error(e);
    }
  }

  binanceWs = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@kline_${INTERVAL}`);

  binanceWs.on("open", () => {
    console.log(`[WS] Connected to Binance WebSocket stream for ${SYMBOL} (${INTERVAL})`);
  });

  binanceWs.on("message", (data) => {
    const msg = JSON.parse(data);
    if (msg.e === "kline") {
      const k = msg.k;
      const price = parseFloat(k.c);
      currentPrice = price; // Update global price
      
      const tickData = {
        type: "tick",
        price,
        time: k.t,
        activePosition,
        balance: account.balance,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        isClosed: k.x
      };

      if (k.x) {
        // Candle Closed
        klines.push([
          k.t,
          k.o,
          k.h,
          k.l,
          k.c,
          k.v,
          k.T,
          k.q,
          k.n,
          k.V,
          k.Q,
          k.B
        ]);
        if (klines.length > 150) klines.shift();
        console.log(`[CANDLE CLOSE] New candle completed (${INTERVAL}). Price: $${price}`);
      }

      // Check trade triggers
      analyzeAndTrade(price);
      // Broadcast tick update to browser
      broadcast(tickData);
    }
  });

  binanceWs.on("close", () => {
    console.log("[WS] Binance stream closed.");
  });
}

// HTTP Server Serving Dashboard
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname === "/api/toggle-autotrade") {
    const enabled = parsedUrl.query.enabled === "true";
    autoTradeEnabled = enabled;
    console.log(`[SYSTEM] Auto-Trading bot toggled to: ${autoTradeEnabled ? "ON" : "OFF"}`);
    
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ success: true, autoTradeEnabled }));
    return;
  }

  if (pathname === "/api/open-position") {
    if (activePosition) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "Position already active" }));
      return;
    }

    const side = parsedUrl.query.side || "BUY";
    const entryPrice = currentPrice;
    
    // Generate SL and TP (SL = 0.5%, TP = 1.5% - 3:1 RR)
    let stoploss = 0;
    let target = 0;
    
    if (side === "BUY") {
      stoploss = entryPrice * 0.995;
      target = entryPrice * 1.015;
    } else {
      stoploss = entryPrice * 1.005;
      target = entryPrice * 0.985;
    }

    activePosition = {
      side: side,
      entry: entryPrice,
      sl: parseFloat(stoploss.toFixed(2)),
      tp: parseFloat(target.toFixed(2)),
      time: Date.now()
    };

    console.log(`\n🚀 [MANUAL ENTRY] Opened ${side} @ $${entryPrice} | SL: $${activePosition.sl} | TP: $${activePosition.tp}\n`);

    broadcast({
      type: "trade_opened",
      activePosition
    });

    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ success: true, activePosition }));
    return;
  }

  if (pathname === "/api/close-position") {
    if (!activePosition) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "No active position" }));
      return;
    }

    const exitPrice = currentPrice;
    let result = "win";
    if (activePosition.side === "BUY") {
      result = exitPrice >= activePosition.entry ? "win" : "loss";
    } else {
      result = exitPrice <= activePosition.entry ? "win" : "loss";
    }

    account.executeTrade({
      symbol: SYMBOL,
      side: activePosition.side,
      entry: activePosition.entry,
      sl: activePosition.sl,
      tp: activePosition.tp,
      exitPrice: exitPrice,
      result: result
    });

    const lastTrade = account.trades[account.trades.length - 1];
    console.log(`\n🎉 [MANUAL CLOSE] Closed ${activePosition.side} @ $${exitPrice} | Result: ${result.toUpperCase()} | PnL: $${lastTrade.pnl.toFixed(2)}\n`);

    broadcast({
      type: "trade_closed",
      trade: lastTrade,
      balance: account.balance
    });

    activePosition = null;

    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ success: true, balance: account.balance }));
    return;
  }

  if (pathname === "/api/change-timeframe") {
    const newInterval = parsedUrl.query.interval || "1m";
    console.log(`[SYSTEM] Switching interval from ${INTERVAL} to ${newInterval}...`);
    INTERVAL = newInterval;
    
    // Reset active position to align with new chart timeframe
    activePosition = null; 
    
    await getHistoricalKlines();
    startRealTimeFeed();
    
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ success: true, interval: INTERVAL }));
    return;
  }

  if (pathname === "/api/change-symbol") {
    const newSymbol = (parsedUrl.query.symbol || "ETHUSDT").toUpperCase();
    console.log(`[SYSTEM] Switching symbol from ${SYMBOL} to ${newSymbol}...`);
    SYMBOL = newSymbol;
    
    // Reset active position to align with new symbol
    activePosition = null; 
    
    await getHistoricalKlines();
    startRealTimeFeed();
    
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ success: true, symbol: SYMBOL }));
    return;
  }

  if (pathname === "/api/history") {
    const formatted = klines.map(k => ({
      time: Math.floor(parseInt(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4])
    }));
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(formatted));
    return;
  }

  if (pathname === "/api/stats") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      balance: account.balance,
      trades: account.trades,
      activePosition,
      symbol: SYMBOL,
      autoTradeEnabled
    }));
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getHtmlContent());
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({ server });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`\n🖥️  [DASHBOARD] SMC Trading Dashboard active at http://localhost:${PORT}\n`);
});

(async function main() {
  await getHistoricalKlines();
  startRealTimeFeed();
})();

function getHtmlContent() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMC Paper Trader Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    :root {
      --bg-main: #0b0f19;
      --bg-card: #151c2c;
      --border: #222e45;
      --primary: #7c3aed;
      --primary-glow: rgba(124, 58, 237, 0.4);
      --green: #10b981;
      --green-glow: rgba(16, 185, 129, 0.25);
      --red: #f43f5e;
      --red-glow: rgba(244, 63, 94, 0.25);
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg-main);
      color: var(--text);
      overflow-x: hidden;
      padding: 24px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
    }

    h1 {
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, #a78bfa, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .tf-dropdown {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      outline: none;
      font-family: 'Outfit', sans-serif;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .tf-dropdown:hover, .tf-dropdown:focus {
      border-color: var(--primary);
      box-shadow: 0 0 10px var(--primary-glow);
    }

    .live-badge {
      background: var(--green-glow);
      color: var(--green);
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 12px;
      border: 1px solid var(--green);
      font-weight: 600;
      letter-spacing: 0.5px;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }

    /* Switch styling */
    .switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 22px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--border);
      transition: .3s;
      border-radius: 22px;
      border: 1px solid var(--border);
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: var(--text-muted);
      transition: .3s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: var(--green-glow);
      border-color: var(--green);
    }
    input:checked + .slider:before {
      transform: translateX(22px);
      background-color: var(--green);
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(124, 58, 237, 0.15);
    }

    .card-title {
      font-size: 14px;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }

    .card-val {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .card-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 8px;
    }

    .glow-purple { border-left: 4px solid var(--primary); }
    .glow-green { border-left: 4px solid var(--green); }
    .glow-red { border-left: 4px solid var(--red); }

    .main-grid {
      display: grid;
      grid-template-columns: 2.2fr 1fr;
      gap: 24px;
    }

    #chart-container {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      height: 520px;
      padding: 16px;
      position: relative;
    }

    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-weight: 600;
    }

    .table-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      max-height: 520px;
      overflow-y: auto;
    }

    .table-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th {
      text-align: left;
      color: var(--text-muted);
      font-weight: 600;
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
    }

    td {
      padding: 12px 8px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }

    .profit-green { color: var(--green); font-weight: 600; }
    .loss-red { color: var(--red); font-weight: 600; }

    .position-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge-buy { background: var(--green-glow); color: var(--green); border: 1px solid var(--green); }
    .badge-sell { background: var(--red-glow); color: var(--red); border: 1px solid var(--red); }

    .btn-close-pos {
      background: var(--red);
      color: #fff;
      border: none;
      padding: 8px 12px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 10px;
      width: 100%;
      font-family: 'Outfit', sans-serif;
      font-size: 12px;
      letter-spacing: 0.5px;
      box-shadow: 0 0 10px rgba(244, 63, 94, 0.4);
      transition: opacity 0.2s, transform 0.1s;
    }
    .btn-close-pos:hover {
      opacity: 0.9;
    }
    .btn-close-pos:active {
      transform: scale(0.98);
    }

    .btn-manual {
      flex: 1;
      border: none;
      padding: 8px 12px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'Outfit', sans-serif;
      font-size: 12px;
      letter-spacing: 0.5px;
      transition: opacity 0.2s, transform 0.1s;
    }
    .btn-buy {
      background: var(--green);
      color: #fff;
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.4);
    }
    .btn-sell {
      background: var(--red);
      color: #fff;
      box-shadow: 0 0 10px rgba(244, 63, 94, 0.4);
    }
    .btn-manual:hover {
      opacity: 0.9;
    }
    .btn-manual:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🧠 SMC Trade Intelligence <span class="live-badge">LIVE SIMULATOR</span></h1>
      <div class="header-controls">
        <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-card); border: 1px solid var(--border); padding: 8px 16px; border-radius: 8px;">
          <span style="font-weight: 600; font-size: 13px; color: var(--text-muted);">Auto-Trading Bot:</span>
          <label class="switch">
            <input type="checkbox" id="autotrade-toggle" checked onchange="toggleAutoTrade(this.checked)">
            <span class="slider round"></span>
          </label>
        </div>
        <select id="symbol-select" class="tf-dropdown" onchange="changeSymbol(this.value)">
          <option value="ETHUSDT">ETH/USDT</option>
          <option value="XRPUSDT">XRP/USDT</option>
          <option value="ADAUSDT">ADA/USDT</option>
          <option value="VETUSDT">VET/USDT</option>
          <option value="TONUSDT">TON/USDT</option>
          <option value="LDOUSDT">LDO/USDT</option>
          <option value="IDUSDT">ID/USDT</option>
          <option value="LUNCUSDT">LUNC/USDT</option>
          <option value="LUNAUSDT">LUNA/USDT</option>
        </select>
        <select id="tf-select" class="tf-dropdown" onchange="changeTimeframe(this.value)">
          <option value="1m" selected>1m Timeframe</option>
          <option value="5m">5m Timeframe</option>
          <option value="15m">15m Timeframe</option>
          <option value="30m">30m Timeframe</option>
          <option value="1h">1h Timeframe</option>
          <option value="4h">4h Timeframe</option>
        </select>
      </div>
    </header>

    <div class="metrics-grid">
      <div class="card glow-purple">
        <div class="card-title">Account Balance</div>
        <div class="card-val" id="balance-val">$10,000.00</div>
        <div class="card-sub" id="pnl-sub">Net Profit: $0.00 (0.00%)</div>
      </div>
      <div class="card glow-green" id="active-card">
        <div class="card-title">Active Position</div>
        <div class="card-val" id="active-pos-val" style="font-size: 26px; color: var(--text-muted);">NONE</div>
        <div class="card-sub" id="active-details">No positions currently open.</div>
        <div id="manual-controls" style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="btn-manual btn-buy" onclick="openManualPosition('BUY')">BUY (LONG)</button>
          <button class="btn-manual btn-sell" onclick="openManualPosition('SELL')">SELL (SHORT)</button>
        </div>
      </div>
      <div class="card glow-purple">
        <div class="card-title">Win Rate / Total</div>
        <div class="card-val" id="win-rate-val">0.0%</div>
        <div class="card-sub" id="total-trades-sub">Completed Trades: 0</div>
      </div>
    </div>

    <div class="main-grid">
      <div id="chart-container">
        <div class="chart-header">
          <div id="chart-symbol">ETHUSDT <span style="color: var(--text-muted); font-size:12px;">Binance WebSocket Feed</span></div>
          <div id="live-price" style="font-size: 20px; font-weight: 700;">$0.00</div>
        </div>
        <div id="chart" style="width: 100%; height: 440px;"></div>
      </div>

      <div class="table-card">
        <div class="table-title">Simulated Trade Ledger</div>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Entry</th>
              <th>SL / TP</th>
              <th>PnL</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody id="trade-history">
            <!-- Filled dynamically -->
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    let useSvgChart = false;
    let chartData = [];
    let lightweightChart = null;
    let candleSeries = null;
    let chartMarkers = [];

    function drawSvgChart() {
      const container = document.getElementById('chart');
      const width = container.clientWidth || 800;
      const height = 400;
      
      container.innerHTML = '';
      if (chartData.length === 0) return;
      
      const highs = chartData.map(d => d.high);
      const lows = chartData.map(d => d.low);
      const minPrice = Math.min(...lows) * 0.9995;
      const maxPrice = Math.max(...highs) * 1.0005;
      const priceRange = maxPrice - minPrice;
      
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", height);
      svg.style.background = "#151c2c";
      svg.style.borderRadius = "12px";

      for (let i = 1; i <= 4; i++) {
        const gridY = (height / 5) * i;
        const gridPrice = maxPrice - (priceRange / 5) * i;
        
        const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        gridLine.setAttribute("x1", 0);
        gridLine.setAttribute("y1", gridY);
        gridLine.setAttribute("x2", width - 60);
        gridLine.setAttribute("y2", gridY);
        gridLine.setAttribute("stroke", "rgba(255,255,255,0.04)");
        gridLine.setAttribute("stroke-dasharray", "4,4");
        svg.appendChild(gridLine);

        const gridText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        gridText.setAttribute("x", width - 55);
        gridText.setAttribute("y", gridY + 4);
        gridText.setAttribute("fill", "#94a3b8");
        gridText.setAttribute("font-size", "10px");
        gridText.textContent = gridPrice.toFixed(1);
        svg.appendChild(gridText);
      }
      
      const candleCount = chartData.length;
      const candleWidth = ((width - 60) / candleCount) * 0.7;
      const gap = ((width - 60) / candleCount) * 0.3;
      
      chartData.forEach((d, i) => {
        const x = i * (candleWidth + gap) + gap/2;
        
        const yHigh = height - ((d.high - minPrice) / priceRange) * height;
        const yLow = height - ((d.low - minPrice) / priceRange) * height;
        const yOpen = height - ((d.open - minPrice) / priceRange) * height;
        const yClose = height - ((d.close - minPrice) / priceRange) * height;
        
        const isUp = d.close >= d.open;
        const color = isUp ? "#10b981" : "#f43f5e";
        
        const wick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        wick.setAttribute("x1", x + candleWidth/2);
        wick.setAttribute("y1", yHigh);
        wick.setAttribute("x2", x + candleWidth/2);
        wick.setAttribute("y2", yLow);
        wick.setAttribute("stroke", color);
        wick.setAttribute("stroke-width", "1.5");
        svg.appendChild(wick);
        
        const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        body.setAttribute("x", x);
        body.setAttribute("y", Math.min(yOpen, yClose));
        body.setAttribute("width", candleWidth);
        body.setAttribute("height", Math.max(Math.abs(yClose - yOpen), 1.5));
        body.setAttribute("fill", color);
        svg.appendChild(body);
      });

      const lastPrice = chartData[chartData.length - 1].close;
      const activeLineY = height - ((lastPrice - minPrice) / priceRange) * height;
      
      const activeLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      activeLine.setAttribute("x1", 0);
      activeLine.setAttribute("y1", activeLineY);
      activeLine.setAttribute("x2", width - 60);
      activeLine.setAttribute("y2", activeLineY);
      activeLine.setAttribute("stroke", "#818cf8");
      activeLine.setAttribute("stroke-width", "1");
      activeLine.setAttribute("stroke-dasharray", "2,2");
      svg.appendChild(activeLine);
      
      container.appendChild(svg);
    }

    function initChart(historyData) {
      chartData = historyData;

      const container = document.getElementById('chart');
      container.innerHTML = '';

      if (typeof LightweightCharts !== 'undefined') {
        try {
          lightweightChart = LightweightCharts.createChart(container, {
            layout: {
              background: { type: 'solid', color: '#151c2c' },
              textColor: '#94a3b8',
            },
            grid: {
              vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
              horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderColor: '#222e45' },
            timeScale: { borderColor: '#222e45', timeVisible: true }
          });

          candleSeries = lightweightChart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#f43f5e',
            borderDownColor: '#f43f5e',
            borderUpColor: '#10b981',
            wickDownColor: '#f43f5e',
            wickUpColor: '#10b981',
          });

          candleSeries.setData(chartData);
          useSvgChart = false;
          return;
        } catch (e) {
          console.error("LightweightCharts failed, falling back to SVG", e);
        }
      }

      useSvgChart = true;
      drawSvgChart();
    }

    function updateChart(candleTick) {
      if (useSvgChart) {
        if (chartData.length > 0 && chartData[chartData.length - 1].time === candleTick.time) {
          chartData[chartData.length - 1] = candleTick;
        } else {
          chartData.push(candleTick);
          if (chartData.length > 120) chartData.shift();
        }
        drawSvgChart();
      } else {
        if (candleSeries) {
          candleSeries.update(candleTick);
        }
      }
    }

    async function loadHistory() {
      const res = await fetch('/api/history');
      const data = await res.json();
      initChart(data);
    }

    async function loadStats() {
      const res = await fetch('/api/stats');
      const stats = await res.json();
      updateDashboard(stats);
    }

    function updateDashboard(stats) {
      document.getElementById('balance-val').innerText = '$' + stats.balance.toFixed(2);
      const netProfit = stats.balance - 10000;
      const profitPct = (netProfit / 10000) * 100;
      const profitEl = document.getElementById('pnl-sub');
      profitEl.innerText = 'Net Profit: ' + (netProfit >= 0 ? '+' : '') + '$' + netProfit.toFixed(2) + ' (' + profitPct.toFixed(2) + '%)';
      profitEl.className = 'card-sub ' + (netProfit >= 0 ? 'profit-green' : 'loss-red');

      // Sync symbol dropdown
      const symbolSelect = document.getElementById('symbol-select');
      if (symbolSelect && stats.symbol) {
        symbolSelect.value = stats.symbol;
      }
      const chartSymbolEl = document.getElementById('chart-symbol');
      if (chartSymbolEl) {
        chartSymbolEl.innerHTML = stats.symbol + ' <span style="color: var(--text-muted); font-size:12px;">Binance WebSocket Feed</span>';
      }

      // Sync auto-trade checkbox
      const toggleCheckbox = document.getElementById('autotrade-toggle');
      if (toggleCheckbox) {
        toggleCheckbox.checked = stats.autoTradeEnabled;
      }

      const activeCard = document.getElementById('active-card');
      const activeVal = document.getElementById('active-pos-val');
      const activeDetails = document.getElementById('active-details');
      const manualControls = document.getElementById('manual-controls');

      if (stats.activePosition) {
        const pos = stats.activePosition;
        activeVal.innerText = pos.side;
        activeVal.className = 'card-val ' + (pos.side === 'BUY' ? 'profit-green' : 'loss-red');
        
        // Calculate dynamic size and floating PnL based on 5x leverage model
        const currentPriceText = document.getElementById('live-price').innerText.replace('$', '');
        const currentPrice = parseFloat(currentPriceText) || pos.entry;
        const leverage = 5;
        const size = (stats.balance * leverage) / pos.entry;
        let unrealizedPnL = 0;
        if (pos.side === 'BUY') {
          unrealizedPnL = (currentPrice - pos.entry) * size;
        } else {
          unrealizedPnL = (pos.entry - currentPrice) * size;
        }
        
        const pnlText = (unrealizedPnL >= 0 ? '+' : '') + '$' + unrealizedPnL.toFixed(2);
        const pnlClass = unrealizedPnL >= 0 ? 'profit-green' : 'loss-red';

        activeDetails.innerHTML = 'Entry: $' + pos.entry.toFixed(2) + ' | SL: $' + pos.sl.toFixed(2) + ' | TP: $' + pos.tp.toFixed(2) + 
          '<br><span style="font-weight:600; display:block; margin-top:6px;">Floating PnL: <span class="' + pnlClass + '">' + pnlText + '</span></span>' +
          '<button class="btn-close-pos" onclick="closePosition()">MARKET CLOSE POSITION</button>';
          
        activeCard.style.boxShadow = '0 0 15px ' + (pos.side === 'BUY' ? 'var(--green-glow)' : 'var(--red-glow)');
        if (manualControls) manualControls.style.display = 'none';
      } else {
        activeVal.innerText = 'NONE';
        activeVal.className = 'card-val';
        activeDetails.innerText = 'No positions currently open.';
        activeCard.style.boxShadow = 'none';
        if (manualControls) manualControls.style.display = 'flex';
      }

      const totalTrades = stats.trades.length;
      document.getElementById('total-trades-sub').innerText = 'Completed Trades: ' + totalTrades;
      if (totalTrades > 0) {
        const wins = stats.trades.filter(t => t.result === 'win').length;
        const winRate = (wins / totalTrades) * 100;
        document.getElementById('win-rate-val').innerText = winRate.toFixed(1) + '%';
      } else {
        document.getElementById('win-rate-val').innerText = '0.0%';
      }

      const tbody = document.getElementById('trade-history');
      tbody.innerHTML = '';
      [...stats.trades].reverse().forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td><span class="position-badge \${t.side === 'BUY' ? 'badge-buy' : 'badge-sell'}">\${t.side}</span></td>
          <td>$\${t.entry.toFixed(2)}</td>
          <td>\${t.sl.toFixed(2)} / \${t.tp.toFixed(2)}</td>
          <td class="\${t.pnl >= 0 ? 'profit-green' : 'loss-red'}">\${t.pnl >= 0 ? '+' : ''}$\${t.pnl.toFixed(2)}</td>
          <td><span style="font-weight:700;" class="\${t.result === 'win' ? 'profit-green' : 'loss-red'}">\${t.result.toUpperCase()}</span></td>
        \`;
        tbody.appendChild(tr);
      });
    }

    async function changeTimeframe(val) {
      console.log('Switching timeframe to:', val);
      const res = await fetch('/api/change-timeframe?interval=' + val);
      const resData = await res.json();
      if (resData.success) {
        chartMarkers = [];
        await loadHistory();
        await loadStats();
      }
    }

    async function changeSymbol(val) {
      console.log('Switching symbol to:', val);
      const res = await fetch('/api/change-symbol?symbol=' + val);
      const resData = await res.json();
      if (resData.success) {
        chartMarkers = [];
        chartData = [];
        if (candleSeries && !useSvgChart) {
          candleSeries.setData([]);
        }
        await loadHistory();
        await loadStats();
      }
    }

    async function openManualPosition(side) {
      console.log('Manually opening position:', side);
      const res = await fetch('/api/open-position?side=' + side);
      const resData = await res.json();
      if (resData.success) {
        loadStats();
      }
    }

    async function closePosition() {
      console.log('Manually closing position...');
      const res = await fetch('/api/close-position');
      const resData = await res.json();
      if (resData.success) {
        loadStats();
      }
    }

    async function toggleAutoTrade(enabled) {
      console.log('Toggling auto-trade to:', enabled);
      await fetch('/api/toggle-autotrade?enabled=' + enabled);
      loadStats();
    }

    let ws;
    function connectWs() {
      ws = new WebSocket('ws://' + location.host);
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'tick') {
          document.getElementById('live-price').innerText = '$' + msg.price.toFixed(2);
          
          const candleTick = {
            time: Math.floor(msg.time / 1000),
            open: msg.open,
            high: msg.high,
            low: msg.low,
            close: msg.close
          };
          
          updateChart(candleTick);
          loadStats();
        }

        if (msg.type === 'trade_opened') {
          const pos = msg.activePosition;
          if (!useSvgChart && candleSeries) {
            chartMarkers.push({
              time: Math.floor(pos.time / 1000),
              position: pos.side === 'BUY' ? 'belowBar' : 'aboveBar',
              color: pos.side === 'BUY' ? '#10b981' : '#f43f5e',
              shape: pos.side === 'BUY' ? 'arrowUp' : 'arrowDown',
              text: pos.side + ' Entry @ $' + pos.entry
            });
            candleSeries.setMarkers(chartMarkers);
          }
          loadStats();
        }

        if (msg.type === 'trade_closed') {
          const trade = msg.trade;
          if (!useSvgChart && candleSeries) {
            chartMarkers.push({
              time: Math.floor(Date.now() / 1000),
              position: 'inBar',
              color: trade.result === 'win' ? '#10b981' : '#f43f5e',
              shape: 'circle',
              text: 'EXIT: ' + trade.result.toUpperCase() + ' ($' + (trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2) + ')'
            });
            candleSeries.setMarkers(chartMarkers);
          }
          loadStats();
        }
      };

      ws.onclose = () => {
        setTimeout(connectWs, 3000);
      };
    }

    loadHistory().then(loadStats).then(connectWs);

    window.addEventListener('resize', () => {
      if (!useSvgChart && lightweightChart) {
        lightweightChart.resize(document.getElementById('chart').clientWidth, 440);
      } else if (useSvgChart) {
        drawSvgChart();
      }
    });
  </script>
</body>
</html>`;
}
