function getSwings(highs, lows) {

  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < highs.length - 2; i++) {

    if (
      highs[i] > highs[i - 1] &&
      highs[i] > highs[i - 2] &&
      highs[i] > highs[i + 1] &&
      highs[i] > highs[i + 2]
    ) {
      swingHighs.push({
        index: i,
        price: highs[i]
      });
    }

    if (
      lows[i] < lows[i - 1] &&
      lows[i] < lows[i - 2] &&
      lows[i] < lows[i + 1] &&
      lows[i] < lows[i + 2]
    ) {
      swingLows.push({
        index: i,
        price: lows[i]
      });
    }
  }

  return {
    swingHighs,
    swingLows
  };
}

function detectBOS(closes, swingHighs, swingLows) {

  const lastClose =
    closes[closes.length - 1];

  const recentHigh =
    swingHighs[swingHighs.length - 1];

  const recentLow =
    swingLows[swingLows.length - 1];

  return {

    bullishBOS:
      recentHigh &&
      lastClose > recentHigh.price,

    bearishBOS:
      recentLow &&
      lastClose < recentLow.price
  };
}

function detectCHOCH(trend, bos) {

  if (
    trend === "bearish" &&
    bos.bullishBOS
  ) {
    return "bullish_choch";
  }

  if (
    trend === "bullish" &&
    bos.bearishBOS
  ) {
    return "bearish_choch";
  }

  return "none";
}

module.exports = {
  getSwings,
  detectBOS,
  detectCHOCH
};
