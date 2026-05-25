function detectEqualHighs(highs, tolerance = 0.001) {

  const equalHighs = [];

  for (let i = 1; i < highs.length; i++) {

    const diff =
      Math.abs(highs[i] - highs[i - 1]);

    if (
      diff / highs[i] < tolerance
    ) {

      equalHighs.push({
        level: highs[i],
        index: i
      });
    }
  }

  return equalHighs.slice(-5);
}

function detectEqualLows(lows, tolerance = 0.001) {

  const equalLows = [];

  for (let i = 1; i < lows.length; i++) {

    const diff =
      Math.abs(lows[i] - lows[i - 1]);

    if (
      diff / lows[i] < tolerance
    ) {

      equalLows.push({
        level: lows[i],
        index: i
      });
    }
  }

  return equalLows.slice(-5);
}

function detectLiquiditySweep(
  highs,
  lows
) {

  const recentHigh =
    Math.max(...highs.slice(-20, -1));

  const recentLow =
    Math.min(...lows.slice(-20, -1));

  const lastHigh =
    highs[highs.length - 1];

  const lastLow =
    lows[lows.length - 1];

  return {

    sweepHigh:
      lastHigh > recentHigh,

    sweepLow:
      lastLow < recentLow
  };
}

module.exports = {
  detectEqualHighs,
  detectEqualLows,
  detectLiquiditySweep
};
