function analyzeVolume(klines) {

  const volumes =
    klines.map(k =>
      parseFloat(k[5])
    );

  const avgVolume =
    volumes.reduce((a, b) => a + b, 0)
    / volumes.length;

  const currentVolume =
    volumes[volumes.length - 1];

  const volumeSpike =
    currentVolume >
    avgVolume * 1.5;

  return {

    avgVolume:
      avgVolume.toFixed(2),

    currentVolume:
      currentVolume.toFixed(2),

    volumeSpike
  };
}

function volumeDelta(
  buyVolume,
  sellVolume
) {

  const delta =
    buyVolume - sellVolume;

  return {

    buyVolume,
    sellVolume,
    delta
  };
}

module.exports = {
  analyzeVolume,
  volumeDelta
};
