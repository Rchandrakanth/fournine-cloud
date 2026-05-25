function calculateCVD(trades) {
  let buyVol = 0;
  let sellVol = 0;

  for (let t of trades) {
    if (t.isBuyerMaker) {
      sellVol += parseFloat(t.qty);
    } else {
      buyVol += parseFloat(t.qty);
    }
  }

  return {
    cvd: buyVol - sellVol,
    buyVol,
    sellVol
  };
}

// Simple absorption proxy (price moves but volume spikes with no movement)
function detectAbsorption(klines) {
  const last = klines.slice(-5);

  const volumes = last.map(k => parseFloat(k[5]));
  const closes = last.map(k => parseFloat(k[4]));

  const volSpike = Math.max(...volumes) > volumes.reduce((a,b)=>a+b)/volumes.length * 1.8;

  const flatPrice = Math.abs(closes[4] - closes[0]) / closes[0] < 0.001;

  return {
    absorption: volSpike && flatPrice
  };
}

// Iceberg proxy (repeated small trades but strong movement)
function detectIceberg(trades) {
  const last = trades.slice(-50);

  const smallTrades = last.filter(t => parseFloat(t.qty) < 1).length;

  return {
    icebergLikely: smallTrades > 30
  };
}

module.exports = {
  calculateCVD,
  detectAbsorption,
  detectIceberg
};
