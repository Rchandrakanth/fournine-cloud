const axios = require("axios");

async function telegram(msg) {

  const url =
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`;

  await axios.post(url, {
    chat_id: process.env.TG_CHAT,
    text: msg
  });
}

function alert(message) {

  console.log("ALERT:", message);

  if (process.env.TG_TOKEN) {

    telegram(message);
  }
}

module.exports = {
  alert
};
