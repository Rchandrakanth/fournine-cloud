function detectOrderBlocks(klines) {

  const obs = [];

  for (let i = 1; i < klines.length; i++) {

    const open =
      parseFloat(klines[i][1]);

    const close =
      parseFloat(klines[i][4]);

    const prevOpen =
      parseFloat(klines[i - 1][1]);

    const prevClose =
      parseFloat(klines[i - 1][4]);

    // bullish OB
    if (
      prevClose < prevOpen &&
      close > open
    ) {

      obs.push({
        type: "bullish",
        high: parseFloat(klines[i - 1][2]),
        low: parseFloat(klines[i - 1][3])
      });
    }

    // bearish OB
    if (
      prevClose > prevOpen &&
      close < open
    ) {

      obs.push({
        type: "bearish",
        high: parseFloat(klines[i - 1][2]),
        low: parseFloat(klines[i - 1][3])
      });
    }
  }

  return obs.slice(-5);
}

module.exports = {
  detectOrderBlocks
};
