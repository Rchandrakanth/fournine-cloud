const axios = require("axios");
const { RSI, EMA } = require("technicalindicators");
const { detectOrderBlocks } = require("./engines/orderblocks");
const { detectLiquiditySweep } = require("./engines/liqudity");

async function scan() {
  console.log("Fetching tickers from Binance...");
  try {
    const response = await axios.get("https://api.binance.com/api/v3/ticker/24hr");
    const tickers = response.data;
    
    // Filter symbols ending in USDT, price <= 1.0, exclude stablecoins and leveraged tokens
    const cheapCoins = tickers.filter(t => {
      const symbol = t.symbol;
      const price = parseFloat(t.lastPrice);
      if (!symbol.endsWith("USDT")) return false;
      if (price > 1.0 || price <= 0.0) return false;
      
      // Exclude stablecoins and leveraged tokens
      const blacklist = ["USDC", "FDUSD", "TUSD", "USDP", "DAI", "EUR", "UP", "DOWN", "BULL", "BEAR", "AUD", "GBP", "AEUR", "USDS"];
      for (const item of blacklist) {
        if (symbol.startsWith(item) || symbol.includes(item)) return false;
      }
      return true;
    });

    console.log(`Found ${cheapCoins.length} cheap coins. Sorting by volume...`);
    
    // Sort by quoteVolume (USDT volume) descending
    cheapCoins.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
    
    // Take top 30
    const topCheapCoins = cheapCoins.slice(0, 30);
    console.log(`Analyzing top ${topCheapCoins.length} cheap coins on 1h timeframe...`);

    const setups = [];

    for (const coin of topCheapCoins) {
      const symbol = coin.symbol;
      const price = parseFloat(coin.lastPrice);
      
      try {
        // Fetch 1h klines
        const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`;
        const klinesRes = await axios.get(klinesUrl);
        const klines = klinesRes.data;
        if (klines.length < 50) continue;

        const closes = klines.map(k => parseFloat(k[4]));
        const highs = klines.map(k => parseFloat(k[2]));
        const lows = klines.map(k => parseFloat(k[3]));

        // Indicators
        const ema20 = EMA.calculate({ values: closes, period: 20 });
        const ema50 = EMA.calculate({ values: closes, period: 50 });
        const rsiArr = RSI.calculate({ values: closes, period: 14 });

        const lastEma20 = ema20[ema20.length - 1];
        const lastEma50 = ema50[ema50.length - 1];
        const lastRsi = rsiArr[rsiArr.length - 1];
        const trend = lastEma20 > lastEma50 ? "bullish" : "bearish";

        // SMC
        const sweeps = detectLiquiditySweep(highs, lows);
        const orderBlocks = detectOrderBlocks(klines);

        // Analyze setup
        let signal = "neutral";
        let score = 0;
        let details = [];

        // Check Bullish Setups
        if (trend === "bullish") {
          score += 1;
          details.push("Bullish trend (EMA20 > EMA50)");
          
          if (lastRsi < 55) {
            score += 1;
            details.push(`Healthy RSI: ${lastRsi.toFixed(1)}`);
          }
          
          const bullOBs = orderBlocks.filter(ob => ob.type === "bullish");
          if (bullOBs.length > 0) {
            // Find closest bullish OB below current price
            const closestOB = bullOBs.reduce((prev, curr) => {
              if (curr.high <= price) {
                return (prev === null || curr.high > prev.high) ? curr : prev;
              }
              return prev;
            }, null);

            if (closestOB) {
              const distancePct = ((price - closestOB.high) / price) * 100;
              if (distancePct < 2.0) {
                score += 2;
                details.push(`Bullish OB nearby at $${closestOB.low.toFixed(4)}-$${closestOB.high.toFixed(4)} (${distancePct.toFixed(1)}% away)`);
              }
            }
          }

          if (sweeps.sweepLow) {
            score += 2;
            details.push("Liquidity sweep of recent lows detected");
          }

          if (score >= 3) {
            signal = "strong_buy";
          }
        } 
        // Check Bearish Setups
        else if (trend === "bearish") {
          score += 1;
          details.push("Bearish trend (EMA20 < EMA50)");

          if (lastRsi > 45) {
            score += 1;
            details.push(`Healthy RSI: ${lastRsi.toFixed(1)}`);
          }

          const bearOBs = orderBlocks.filter(ob => ob.type === "bearish");
          if (bearOBs.length > 0) {
            // Find closest bearish OB above current price
            const closestOB = bearOBs.reduce((prev, curr) => {
              if (curr.low >= price) {
                return (prev === null || curr.low < prev.low) ? curr : prev;
              }
              return prev;
            }, null);

            if (closestOB) {
              const distancePct = ((closestOB.low - price) / price) * 100;
              if (distancePct < 2.0) {
                score += 2;
                details.push(`Bearish OB nearby at $${closestOB.low.toFixed(4)}-$${closestOB.high.toFixed(4)} (${distancePct.toFixed(1)}% away)`);
              }
            }
          }

          if (sweeps.sweepHigh) {
            score += 2;
            details.push("Liquidity sweep of recent highs detected");
          }

          if (score >= 3) {
            signal = "strong_sell";
          }
        }

        if (signal === "strong_buy" || signal === "strong_sell") {
          // Generate precise entries, stop losses and targets
          let entry = price;
          let sl, tp, rr;

          if (signal === "strong_buy") {
            // SL below the closest OB low or 1% below entry
            const bullOBs = orderBlocks.filter(ob => ob.type === "bullish");
            const lowestOB = bullOBs.length > 0 ? Math.min(...bullOBs.map(ob => ob.low)) : entry * 0.99;
            sl = Math.min(lowestOB, entry * 0.992);
            // 1:2 Risk to Reward
            const risk = entry - sl;
            tp = entry + (risk * 2);
          } else {
            // SL above the closest OB high or 1% above entry
            const bearOBs = orderBlocks.filter(ob => ob.type === "bearish");
            const highestOB = bearOBs.length > 0 ? Math.max(...bearOBs.map(ob => ob.high)) : entry * 1.01;
            sl = Math.max(highestOB, entry * 1.008);
            // 1:2 Risk to Reward
            const risk = sl - entry;
            tp = entry - (risk * 2);
          }

          rr = Math.abs(tp - entry) / Math.abs(entry - sl);

          setups.push({
            symbol,
            price: price.toFixed(4),
            signal: signal === "strong_buy" ? "STRONG BUY 🟢" : "STRONG SELL 🔴",
            score,
            details: details.join(", "),
            entry: entry.toFixed(4),
            sl: sl.toFixed(4),
            tp: tp.toFixed(4),
            rr: rr.toFixed(2),
            volume: parseFloat(coin.quoteVolume).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
          });
        }
      } catch (err) {
        console.error(`Error analyzing ${symbol}:`, err.message);
      }
    }

    console.log("\nScan complete. Found setups:");
    console.table(setups);

    // Save results to a JSON file
    const fs = require("fs");
    fs.writeFileSync("/home/chandu/mcp-servers/crypto/scanned-setups.json", JSON.stringify(setups, null, 2));
    console.log("\nResults written to scanned-setups.json");
  } catch (error) {
    console.error("Scanner failed:", error);
  }
}

scan();
