function getPremiumDiscount(highs, lows, price) {
  const high = Math.max(...highs);
  const low = Math.min(...lows);

  const eq = (high + low) / 2;

  return {
    premium: price > eq,
    discount: price < eq,
    equilibrium: eq
  };
}

function generateExecutionZone(trend, smc) {
  let bias = "neutral";

  if (trend === "bullish" && smc.displacement) {
    bias = "buy_zone";
  }

  if (trend === "bearish" && smc.displacement) {
    bias = "sell_zone";
  }

  return {
    bias
  };
}

module.exports = {
  getPremiumDiscount,
  generateExecutionZone
};
