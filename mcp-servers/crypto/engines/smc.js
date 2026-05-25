function detectDisplacement(klines) {
  const last = klines.slice(-3);

  const ranges = last.map(k =>
    Math.abs(parseFloat(k[2]) - parseFloat(k[3]))
  );

  const avg = ranges.reduce((a,b)=>a+b)/ranges.length;

  const bigMove = ranges[2] > avg * 1.8;

  return {
    displacement: bigMove
  };
}

// Inducement = liquidity grab before reversal (simplified)
function detectInducement(highs, lows) {
  const lastHigh = Math.max(...highs.slice(-10));
  const lastLow = Math.min(...lows.slice(-10));

  const currentHigh = highs[highs.length - 1];
  const currentLow = lows[lows.length - 1];

  return {
    inducementHigh: currentHigh > lastHigh,
    inducementLow: currentLow < lastLow
  };
}

// Breaker block proxy (old order block broken and retested)
function detectBreakerBlock(closes) {
  const mid = Math.floor(closes.length / 2);

  const oldHigh = Math.max(...closes.slice(0, mid));

  const lastPrice = closes[closes.length - 1];

  return {
    breakerBlock: lastPrice > oldHigh
  };
}

module.exports = {
  detectDisplacement,
  detectInducement,
  detectBreakerBlock
};
