const fs = require("fs");

class TradeJournal {

  constructor(file = "trades.json") {

    this.file = file;
  }

  log(trade) {

    let data = [];

    if (fs.existsSync(this.file)) {

      data = JSON.parse(
        fs.readFileSync(this.file)
      );
    }

    data.push(trade);

    fs.writeFileSync(
      this.file,
      JSON.stringify(data, null, 2)
    );
  }
}

module.exports = {
  TradeJournal
};
