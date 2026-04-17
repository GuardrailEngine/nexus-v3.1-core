const WebSocket = require("ws");
const { analyze } = require("./engine/analyzer");

const wss = new WebSocket.Server({ port: 3000 });

const assets = {
  BTCUSDT: [],
  ETHUSDT: [],
  SOLUSDT: []
};

const symbols = ["btcusdt", "ethusdt", "solusdt"];

symbols.forEach((sym) => {
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/ws/${sym}@trade`
  );

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    const price = parseFloat(data.p);
    const key = sym.toUpperCase();

    if (!assets[key]) assets[key] = [];

    assets[key].push(price);
    if (assets[key].length > 500) assets[key].shift();

    const analysis = analyze(assets[key], price, key);

    broadcast({
      asset: key,
      price,
      analysis
    });
  });
});

function broadcast(data) {
  wss.clients.forEach((c) => {
    if (c.readyState === 1) {
      c.send(JSON.stringify(data));
    }
  });
}

console.log("NEXUS MARKET LAB v2 RUNNING on port 3000");
