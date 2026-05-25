const axios = require("axios");

class ExecutionEngine {

  constructor(mode = "paper") {

    this.mode = mode; // paper | live
  }

  async placeOrder({
    symbol,
    side,
    quantity,
    price
  }) {

    if (this.mode === "paper") {

      return {
        status: "paper_executed",
        symbol,
        side,
        quantity,
        price
      };
    }

    // LIVE MODE (placeholder - requires API keys)
    try {

      const res =
        await axios.post(
          "https://api.binance.com/api/v3/order",
          {
            symbol,
            side,
            type: "MARKET",
            quantity
          },
          {
            headers: {
              "X-MBX-APIKEY":
                process.env.BINANCE_KEY
            }
          }
        );

      return res.data;

    } catch (err) {

      return {
        error: err.message
      };
    }
  }
}

module.exports = {
  ExecutionEngine
};
