function getSession() {

  const utcHour =
    new Date().getUTCHours();

  if (
    utcHour >= 0 &&
    utcHour < 7
  ) {
    return "Asia";
  }

  if (
    utcHour >= 7 &&
    utcHour < 13
  ) {
    return "London";
  }

  if (
    utcHour >= 13 &&
    utcHour < 22
  ) {
    return "NewYork";
  }

  return "AfterHours";
}

function isKillzone() {

  const utcHour =
    new Date().getUTCHours();

  return (
    (utcHour >= 7 && utcHour <= 10) ||
    (utcHour >= 13 && utcHour <= 16)
  );
}

module.exports = {
  getSession,
  isKillzone
};
