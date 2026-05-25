function calculateRiskReward(
  entry,
  stoploss,
  target
) {

  const risk =
    Math.abs(entry - stoploss);

  const reward =
    Math.abs(target - entry);

  const rr =
    reward / risk;

  return {
    risk,
    reward,
    rr: rr.toFixed(2)
  };
}

function generateTradePlan(
  trend,
  lastPrice
) {

  let entry =
    lastPrice;

  let stoploss;
  let target;

  if (trend === "bullish") {

    stoploss =
      lastPrice * 0.995;

    target =
      lastPrice * 1.015;
  }

  if (trend === "bearish") {

    stoploss =
      lastPrice * 1.005;

    target =
      lastPrice * 0.985;
  }

  const rr =
    calculateRiskReward(
      entry,
      stoploss,
      target
    );

  return {

    entry:
      entry.toFixed(2),

    stoploss:
      stoploss.toFixed(2),

    target:
      target.toFixed(2),

    rr
  };
}

module.exports = {
  generateTradePlan
};
