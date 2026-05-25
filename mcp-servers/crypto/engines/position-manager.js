class PositionManager {

  constructor() {

    this.positions = [];
  }

  open(position) {

    this.positions.push({
      ...position,
      status: "open"
    });
  }

  close(index, exitPrice) {

    const pos =
      this.positions[index];

    if (!pos) return;

    pos.exit = exitPrice;

    pos.pnl =
      pos.side === "buy"
        ? exitPrice - pos.entry
        : pos.entry - exitPrice;

    pos.status = "closed";

    return pos;
  }

  active() {

    return this.positions.filter(
      p => p.status === "open"
    );
  }
}

module.exports = {
  PositionManager
};
