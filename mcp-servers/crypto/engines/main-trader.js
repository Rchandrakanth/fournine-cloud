const {
  ExecutionEngine
} = require("./engines/execution-engine");

const {
  RiskManager
} = require("./engines/risk-manager");

const {
  PositionManager
} = require("./engines/position-manager");

const {
  TradeJournal
} = require("./engines/trade-journal");

const {
  alert
} = require("./engines/alert-engine");

const engine =
  new ExecutionEngine("paper");

const risk =
  new RiskManager();

const positions =
  new PositionManager();

const journal =
  new TradeJournal();

// SIMULATED STRATEGY SIGNAL
function strategySignal(price) {

  if (price % 2 === 0) {

    return {
      side: "buy"
    };
  }

  return {
    side: "sell"
  };
}

async function run(price) {

  if (!risk.canTrade()) {

    alert("TRADING BLOCKED - RISK LIMIT HIT");

    return;
  }

  const signal =
    strategySignal(price);

  const order =
    await engine.placeOrder({
      symbol: "BTCUSDT",
      side: signal.side,
      quantity: 0.001,
      price
    });

  positions.open({
    entry: price,
    side: signal.side
  });

  journal.log(order);

  risk.updateTrade(-1);

  alert(
    `Trade executed: ${signal.side} @ ${price}`
  );
}

// SIM LOOP (replace with MCP/WebSocket later)
setInterval(() => {

  const price =
    65000 + Math.random() * 100;

  run(price);

}, 5000);
