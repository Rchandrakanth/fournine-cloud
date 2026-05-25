function calculateMetrics(trades) {

  const wins =
    trades.filter(t => t.result === "win").length;

  const losses =
    trades.filter(t => t.result === "loss").length;

  const winrate =
    wins / trades.length;

  const profits =
    trades.map(t =>
      (t.tp - t.entry)
    );

  const avgWin =
    profits.reduce((a,b)=>a+b,0) / profits.length;

  const sharpeLike =
    avgWin / (losses || 1);

  const totalReturn =
    profits.reduce((a,b)=>a+b,0);

  return {

    totalTrades: trades.length,

    wins,

    losses,

    winrate: (winrate * 100).toFixed(2) + "%",

    avgWin: avgWin.toFixed(4),

    sharpeLike: sharpeLike.toFixed(4),

    totalReturn: totalReturn.toFixed(4)
  };
}

module.exports = {
  calculateMetrics
};
