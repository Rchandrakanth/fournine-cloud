function detectFVG(klines) {

  const fvgs = [];

  for (let i = 2; i < klines.length; i++) {

    const prevHigh =
      parseFloat(klines[i - 2][2]);

    const prevLow =
      parseFloat(klines[i - 2][3]);

    const currentHigh =
      parseFloat(klines[i][2]);

    const currentLow =
      parseFloat(klines[i][3]);

    // bullish FVG
    if (currentLow > prevHigh) {

      fvgs.push({
        type: "bullish",
        top: currentLow,
        bottom: prevHigh
      });
    }

    // bearish FVG
    if (currentHigh < prevLow) {

      fvgs.push({
        type: "bearish",
        top: prevLow,
        bottom: currentHigh
      });
    }
  }

  return fvgs.slice(-3);
}

module.exports = {
  detectFVG
};
