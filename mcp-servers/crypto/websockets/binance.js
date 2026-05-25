const WebSocket = require("ws");

let latestTicker = {};
let orderBook = {};
let tradeStats = {
  buyVolume: 0,
  sellVolume: 0
};

function startBinanceStream(symbol = "btcusdt") {

  const streams = [
    `${symbol}@trade`,
    `${symbol}@depth20@100ms`,
    `${symbol}@kline_1m`
  ];

  const ws = new WebSocket(
    `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`
  );

  ws.on("open", () => {
    console.log("Binance WebSocket connected");
  });

  ws.on("message", (raw) => {

    const msg = JSON.parse(raw);

    const data = msg.data;

    // trades
    if (data.e === "trade") {

      const qty =
        parseFloat(data.q);

      const price =
        parseFloat(data.p);

      const isSell =
        data.m;

      latestTicker = {
        price,
        qty
      };

      if (isSell) {
        tradeStats.sellVolume += qty;
      } else {
        tradeStats.buyVolume += qty;
      }
    }

    // order book
    if (data.e === "depthUpdate") {

      orderBook = {
        bids: data.b,
        asks: data.a
      };
    }

  });

  ws.on("close", () => {
    console.log("WebSocket closed");
  });

  ws.on("error", (err) => {
    console.log(err.message);
  });
}

function getRealtimeData() {

  const delta =
    tradeStats.buyVolume -
    tradeStats.sellVolume;

  return {

    latestTicker,

    orderBook,

    volumeDelta:
      delta.toFixed(4),

    buyVolume:
      tradeStats.buyVolume.toFixed(4),

    sellVolume:
      tradeStats.sellVolume.toFixed(4)
  };
}

module.exports = {
  startBinanceStream,
  getRealtimeData
};
