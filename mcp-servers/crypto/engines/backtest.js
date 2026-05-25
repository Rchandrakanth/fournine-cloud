function runBacktest(klines, strategyFn) {

  const trades = [];

  let position = null;

  for (let i = 50; i < klines.length; i++) {

    const slice = klines.slice(0, i);

    const signal = strategyFn(slice);

    const price = parseFloat(klines[i][4]);

    // ENTRY
    if (!position && signal.entry) {

      position = {
        entry: price,
        type: signal.type,
        sl: signal.sl,
        tp: signal.tp
      };
    }

    // EXIT
    if (position) {

      if (
        position.type === "buy" &&
        (price >= position.tp || price <= position.sl)
      ) {

        trades.push({
          ...position,
          exit: price,
          result:
            price >= position.tp ? "win" : "loss"
        });

        position = null;
      }

      if (
        position.type === "sell" &&
        (price <= position.tp || price >= position.sl)
      ) {

        trades.push({
          ...position,
          exit: price,
          result:
            price <= position.tp ? "win" : "loss"
        });

        position = null;
      }
    }
  }

  return trades;
}

module.exports = {
  runBacktest
};
