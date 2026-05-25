const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const symbols = [
  "ADAUSDT",   // Cardano
  "XRPUSDT",   // Ripple
  "VETUSDT",   // VeChain
  "TONUSDT",   // Toncoin (sometimes slightly above $1 but requested)
  "LDOUSDT",   // Lido DAO (fits 'lab/ldo')
  "IDUSDT",    // Space ID (fits 'space')
  "LUNCUSDT",  // Terra Classic
  "LUNAUSDT"   // Terra
];

const interval = "1h"; // analysis timeframe

function runMcpTool(symbol) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [path.join(__dirname, "index.js")]);
    
    let responseText = "";
    child.stdout.on("data", (data) => {
      responseText += data.toString();
    });

    child.on("close", () => {
      try {
        const lines = responseText.split("\n").filter(l => l.trim());
        // Find the line that has the result for the tool call
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.id === 2 && parsed.result?.content?.[0]?.text) {
            const resultText = parsed.result.content[0].text;
            resolve(JSON.parse(resultText));
            return;
          }
        }
        reject("No valid tool response found");
      } catch (err) {
        reject(err.message + " | Response: " + responseText);
      }
    });

    // Send initialize message first
    const initMsg = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    };
    
    // Send tool call message
    const toolMsg = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "analyze_market",
        arguments: { symbol, interval }
      }
    };

    child.stdin.write(JSON.stringify(initMsg) + "\n");
    child.stdin.write(JSON.stringify(toolMsg) + "\n");
    child.stdin.end();
  });
}

async function start() {
  console.log(`Starting MCP analysis for coins: ${symbols.join(", ")}`);
  const results = [];

  for (const sym of symbols) {
    try {
      console.log(`Analyzing ${sym}...`);
      const analysis = await runMcpTool(sym);
      
      const lastPrice = analysis.analysis.lastPrice;
      const trend = analysis.analysis.trend;
      const rsi = parseFloat(analysis.analysis.indicators.rsi);
      const smc = analysis.analysis.smartMoneyConcepts;
      
      // Determine signals and entries
      let signal = "NEUTRAL ⚪";
      let details = [];
      let entry = lastPrice;
      let sl = 0, tp = 0;

      // Bullish indicators
      const hasBullOB = smc.orderBlocks.some(ob => ob.type === "bullish");
      const hasBullFVG = smc.fairValueGaps.some(f => f.type === "bullish");
      
      // Bearish indicators
      const hasBearOB = smc.orderBlocks.some(ob => ob.type === "bearish");
      const hasBearFVG = smc.fairValueGaps.some(f => f.type === "bearish");

      if (trend === "bullish") {
        if (rsi < 65) {
          signal = "STRONG BUY 🟢";
          details.push("Bullish trend");
          details.push(`RSI ${rsi}`);
          if (hasBullOB) details.push("Bullish Order Block detected");
          if (hasBullFVG) details.push("Bullish FVG detected");
          
          // SL below lowest OB or 1% below entry
          const bullOBs = smc.orderBlocks.filter(ob => ob.type === "bullish");
          const lowestOB = bullOBs.length > 0 ? Math.min(...bullOBs.map(ob => ob.zone.low)) : entry * 0.99;
          sl = Math.min(lowestOB, entry * 0.992);
          tp = entry + (entry - sl) * 2; // 1:2 Risk to Reward
        }
      } else if (trend === "bearish") {
        if (rsi > 35) {
          signal = "STRONG SELL 🔴";
          details.push("Bearish trend");
          details.push(`RSI ${rsi}`);
          if (hasBearOB) details.push("Bearish Order Block detected");
          if (hasBearFVG) details.push("Bearish FVG detected");
          
          // SL above highest OB or 1% above entry
          const bearOBs = smc.orderBlocks.filter(ob => ob.type === "bearish");
          const highestOB = bearOBs.length > 0 ? Math.max(...bearOBs.map(ob => ob.zone.high)) : entry * 1.01;
          sl = Math.max(highestOB, entry * 1.008);
          tp = entry - (sl - entry) * 2; // 1:2 Risk to Reward
        }
      }

      results.push({
        symbol: sym,
        price: lastPrice.toFixed(4),
        signal,
        details: details.join(", ") || "No strong setup",
        entry: entry.toFixed(4),
        sl: sl > 0 ? sl.toFixed(4) : "N/A",
        tp: tp > 0 ? tp.toFixed(4) : "N/A",
        rr: sl > 0 ? "2.00" : "N/A"
      });
      
    } catch (err) {
      console.error(`Failed to analyze ${sym}:`, err);
    }
  }

  console.log("\nSetup Analysis Completed:");
  console.table(results);

  // Write results to JSON
  fs.writeFileSync(path.join(__dirname, "scanned-mcp-setups.json"), JSON.stringify(results, null, 2));
  console.log("Written results to scanned-mcp-setups.json");
}

start();
