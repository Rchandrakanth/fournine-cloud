class PaperAccount {

  constructor(balance = 1000) {

    this.balance = balance;
    this.trades = [];
  }

  executeTrade(trade) {
    const leverage = 5;
    const positionSize = (this.balance * leverage) / trade.entry;
    let pnl = 0;

    const exitPrice = trade.exitPrice || (trade.result === "win" ? trade.tp : trade.sl);

    if (trade.side === "BUY") {
      pnl = (exitPrice - trade.entry) * positionSize;
    } else if (trade.side === "SELL") {
      pnl = (trade.entry - exitPrice) * positionSize;
    }

    this.balance += pnl;

    this.trades.push({
      ...trade,
      exitPrice,
      pnl,
      balance: this.balance
    });
  }

  summary() {

    return {

      balance: this.balance,

      totalTrades:
        this.trades.length
    };
  }
}

module.exports = {
  PaperAccount
};
