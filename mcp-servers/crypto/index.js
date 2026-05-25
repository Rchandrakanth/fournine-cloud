const axios = require("axios");
const { RSI, EMA, MACD } = require("technicalindicators");

// Import user's custom engines
const { detectFVG } = require("./engines/fvg");
const { detectOrderBlocks } = require("./engines/orderblocks");
const { detectEqualHighs, detectEqualLows, detectLiquiditySweep } = require("./engines/liqudity");
const { getSwings, detectBOS, detectCHOCH } = require("./engines/structure");
const { analyzeVolume, volumeDelta } = require("./engines/volume");
const { calculateCVD, detectAbsorption, detectIceberg } = require("./engines/orderflow");
const { detectDisplacement, detectInducement, detectBreakerBlock } = require("./engines/smc");

process.stdin.setEncoding("utf8");

async function apiGet(url) {
  const response = await axios.get(url);
  return response.data;
}

async function getKlines(symbol, interval, limit = 200) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await axios.get(url);
  return response.data;
}

function fetchDepth(symbol, limit = 100) {
  return apiGet(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${limit}`);
}

function fetchTrades(symbol, limit = 500) {
  return apiGet(`https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=${limit}`);
}

// Analyze pending liquidity from order book
function analyzeOrderBookLiquidity(depth) {
  const bids = depth.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]);
  const asks = depth.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]);

  const topBids = [...bids].sort((a, b) => (b[0] * b[1]) - (a[0] * a[1])).slice(0, 5);
  const topAsks = [...asks].sort((a, b) => (b[0] * b[1]) - (a[0] * a[1])).slice(0, 5);

  return {
    bidLiquidityWalls: topBids.map(b => ({ price: b[0], size: b[1], valueUsd: (b[0] * b[1]).toFixed(2) })),
    askLiquidityWalls: topAsks.map(a => ({ price: a[0], size: a[1], valueUsd: (a[0] * a[1]).toFixed(2) }))
  };
}

function analyzeMarket(klines) {
  const closes = klines.map(k => parseFloat(k[4]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const lastPrice = closes[closes.length - 1];

  // Technical Indicators
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });

  // Calculate Trend
  let trend = "neutral";
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  if (lastEma20 > lastEma50) {
    trend = "bullish";
  } else if (lastEma20 < lastEma50) {
    trend = "bearish";
  }

  // Use user's custom engines
  const volumeStats = analyzeVolume(klines);
  const fvgs = detectFVG(klines);
  const orderBlocks = detectOrderBlocks(klines);
  const sweeps = detectLiquiditySweep(highs, lows);
  const equalHighs = detectEqualHighs(highs);
  const equalLows = detectEqualLows(lows);
  const swings = getSwings(highs, lows);
  const bos = detectBOS(closes, swings.swingHighs, swings.swingLows);
  const choch = detectCHOCH(trend, bos);
  const displacement = detectDisplacement(klines);
  const inducement = detectInducement(highs, lows);
  const breaker = detectBreakerBlock(closes);
  const absorption = detectAbsorption(klines);

  return {
    trend,
    lastPrice,
    indicators: {
      rsi: rsi[rsi.length - 1]?.toFixed(2),
      ema20: lastEma20?.toFixed(2),
      ema50: lastEma50?.toFixed(2),
      macd: macd[macd.length - 1]
    },
    smartMoneyConcepts: {
      marketStructure: {
        bos,
        choch,
        trendChange: choch !== "none"
      },
      orderBlocks: orderBlocks.map(ob => ({
        type: ob.type,
        zone: { high: ob.high, low: ob.low }
      })),
      fairValueGaps: fvgs.map(f => ({
        type: f.type,
        zone: { top: f.top, bottom: f.bottom }
      })),
      displacement: displacement.displacement,
      inducement,
      breakerBlock: breaker.breakerBlock,
      absorption: absorption.absorption
    },
    liquidity: {
      sweeps,
      equalHighs: equalHighs.map(h => h.level),
      equalLows: equalLows.map(l => l.level)
    },
    volume: {
      averageVolume: volumeStats.avgVolume,
      currentVolume: volumeStats.currentVolume,
      volumeSpike: volumeStats.volumeSpike
    }
  };
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let lineEnd;
  while ((lineEnd = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, lineEnd);
    buffer = buffer.slice(lineEnd + 1);
    if (line.trim()) {
      handleMessage(line);
    }
  }
});

async function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    return;
  }

  const { method, id, params } = msg;

  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "crypto-analysis", version: "1.0.0" }
    });
    return;
  }

  if (method === "tools/list") {
    sendResponse(id, {
      tools: [
        {
          name: "analyze_market",
          description: "Fetch and analyze price action, technical indicators, and Smart Money Concepts (SMC, Order Blocks, FVGs, sweeps, BOS, CHOCH)",
          inputSchema: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Trading pair, e.g. ETHUSDT or BTCUSDT" },
              interval: { type: "string", description: "Candlestick interval, e.g. 1d, 4h, 1h, 15m" }
            },
            required: ["symbol"]
          }
        },
        {
          name: "analyze_liquidity",
          description: "Analyze market liquidity (order book depth, swing highs/lows, whale trades, and institutional order blocks/FVGs)",
          inputSchema: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Trading pair, e.g. ETHUSDT or BTCUSDT" }
            },
            required: ["symbol"]
          }
        }
      ]
    });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    const symbol = (args.symbol || "ETHUSDT").toUpperCase();

    if (name === "analyze_market") {
      const interval = args.interval || "1h";
      try {
        const klines = await getKlines(symbol, interval, 200);
        const analysis = analyzeMarket(klines);
        
        sendResponse(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                symbol,
                interval,
                analysis
              }, null, 2)
            }
          ]
        });
      } catch (err) {
        sendError(id, err.message);
      }
      return;
    }

    if (name === "analyze_liquidity") {
      try {
        const [depth, trades, klinesDaily, klines4h, klines1h, klines15m] = await Promise.all([
          fetchDepth(symbol, 100),
          fetchTrades(symbol, 500),
          getKlines(symbol, "1d", 30),
          getKlines(symbol, "4h", 30),
          getKlines(symbol, "1h", 50),
          getKlines(symbol, "15m", 50)
        ]);

        const currentPrice = parseFloat(trades[0].price);

        const orderBookLiq = analyzeOrderBookLiquidity(depth);
        
        // Analyze trades for CVD and icebergs
        const cvdStats = calculateCVD(trades);
        const icebergStats = detectIceberg(trades);

        const dailySwings = getSwings(klinesDaily.map(k => parseFloat(k[2])), klinesDaily.map(k => parseFloat(k[3])));
        const h4Swings = getSwings(klines4h.map(k => parseFloat(k[2])), klines4h.map(k => parseFloat(k[3])));

        const h1FVGs = detectFVG(klines1h);
        const m15FVGs = detectFVG(klines15m);

        const analysisResult = {
          symbol,
          currentPrice,
          orderBook: orderBookLiq,
          orderFlow: {
            cumulativeVolumeDelta: cvdStats.cvd.toFixed(4),
            buyVolume: cvdStats.buyVol.toFixed(4),
            sellVolume: cvdStats.sellVol.toFixed(4),
            icebergDetected: icebergStats.icebergLikely
          },
          liquidityPools: {
            dailySwingHighs: dailySwings.swingHighs.slice(-3).map(h => h.price),
            dailySwingLows: dailySwings.swingLows.slice(-3).map(l => l.price),
            h4SwingHighs: h4Swings.swingHighs.slice(-3).map(h => h.price),
            h4SwingLows: h4Swings.swingLows.slice(-3).map(l => l.price)
          },
          imbalances: {
            h1FVGs: h1FVGs.slice(-3),
            m15FVGs: m15FVGs.slice(-3)
          }
        };

        sendResponse(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(analysisResult, null, 2)
            }
          ]
        });
      } catch (err) {
        sendError(id, err.message);
      }
      return;
    }

    sendError(id, `Tool not found: ${name}`);
  }
}

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } }) + "\n");
}
