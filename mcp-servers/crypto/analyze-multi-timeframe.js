const { spawn } = require("child_process");
const path = require("path");

const intervals = ["4h", "1h", "15m", "5m", "1m"];
const symbol = "ETHUSDT";

function runMcpTool(interval) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [path.join(__dirname, "index.js")]);
    
    let responseText = "";
    child.stdout.on("data", (data) => {
      responseText += data.toString();
    });

    child.on("close", () => {
      try {
        const lines = responseText.split("\n").filter(l => l.trim());
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.id === 2 && parsed.result?.content?.[0]?.text) {
            resolve(JSON.parse(parsed.result.content[0].text));
            return;
          }
        }
        reject(`No valid response for ${interval}`);
      } catch (err) {
        reject(`${err.message} for ${interval}`);
      }
    });

    const initMsg = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mtf-client", version: "1.0.0" }
      }
    };
    
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
  const mtfData = {};
  for (const interval of intervals) {
    console.log(`Querying ${interval} analysis...`);
    try {
      mtfData[interval] = await runMcpTool(interval);
    } catch (e) {
      console.error(`Error querying ${interval}:`, e);
    }
  }
  
  // Write to a temporary file in the crypto dir
  const fs = require("fs");
  fs.writeFileSync(path.join(__dirname, "mtf-eth-analysis.json"), JSON.stringify(mtfData, null, 2));
  console.log("Multi-timeframe analysis written to mtf-eth-analysis.json");
}

start();
