const axios = require("axios");

// TELEGRAM ALERT
async function sendTelegram(message) {

  const TOKEN = process.env.TG_TOKEN;
  const CHAT_ID = process.env.TG_CHAT;

  const url =
    `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  await axios.post(url, {
    chat_id: CHAT_ID,
    text: message
  });
}

// DISCORD ALERT
async function sendDiscord(webhook, message) {

  await axios.post(webhook, {
    content: message
  });
}

module.exports = {
  sendTelegram,
  sendDiscord
};
