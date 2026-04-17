/**
 * ⚔️ NEXUS v3.1 CORE — INTEGRATED ENGINE
 * Architecture : Single-File / Zero External Dependencies (ws built-in polyfill)
 * Requires     : Node.js 18+  |  npm install ws
 * Identity     : Engineering Sovereignty
 *
 * Endpoints:
 *   GET  /              → Dashboard UI (self-contained HTML)
 *   GET  /api/metrics   → System + Market metrics (JSON)
 *   GET  /api/snapshot  → Latest analysis for all assets (JSON)
 *   WS   /feed          → Real-time price + analysis stream
 */

"use strict";

const http      = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const os        = require("os");

// ── CONFIG ───────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const START_TIME = Date.now();
let   totalRequests = 0;

// ── ANALYSIS ENGINE ──────────────────────────────────────────────────────────

function avg(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function stdDev(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

/**
 * Z-Score: how many standard deviations is the current price
 * from the rolling mean? > ±2.5 = exceptional move.
 */
function calcZScore(prices, window = 20) {
  if (prices.length < window) return 0;
  const slice = prices.slice(-window);
  const mean  = slice.reduce((a, b) => a + b, 0) / window;
  const std   = stdDev(slice);
  if (std === 0) return 0;
  return (prices[prices.length - 1] - mean) / std;
}

/**
 * Support / Resistance: detect local pivot highs/lows over last `lookback`
 * prices, then return the nearest level above (resistance) and below (support).
 */
function calcSR(prices, lookback = 60) {
  if (prices.length < lookback) return { support: null, resistance: null, levels: [] };
  const slice   = prices.slice(-lookback);
  const levels  = [];

  for (let i = 2; i < slice.length - 2; i++) {
    const v = slice[i];
    const isPeak   = v > slice[i-1] && v > slice[i-2] && v > slice[i+1] && v > slice[i+2];
    const isTrough = v < slice[i-1] && v < slice[i-2] && v < slice[i+1] && v < slice[i+2];
    if (isPeak || isTrough) levels.push(v);
  }

  const current    = prices[prices.length - 1];
  const above      = levels.filter(l => l > current).sort((a, b) => a - b);
  const below      = levels.filter(l => l < current).sort((a, b) => b - a);

  return {
    support    : below[0]  ?? null,
    resistance : above[0]  ?? null,
    levels,
  };
}

/**
 * Classify signal using Z-Score + S/R proximity (0.5% threshold).
 * Z-Score flags the energy; S/R decides the destination.
 */
function classifySignal(zscore, trend, sr, price) {
  const { support, resistance } = sr;
  const PROXIMITY = 0.005; // 0.5%
  const nearR = resistance && Math.abs(price - resistance) / price < PROXIMITY;
  const nearS = support    && Math.abs(price - support)    / price < PROXIMITY;

  if (zscore >  2.5 && nearR) return { label: "REVERSAL_SELL", priority: "HIGH",   color: "#ff4466" };
  if (zscore < -2.5 && nearS) return { label: "REVERSAL_BUY",  priority: "HIGH",   color: "#00ff9f" };
  if (zscore >  2.5)          return { label: "BREAKOUT_UP",   priority: "MEDIUM", color: "#00ccff" };
  if (zscore < -2.5)          return { label: "BREAKDOWN",     priority: "MEDIUM", color: "#ff8800" };
  if (trend === "BULLISH" && nearS) return { label: "BUY_ZONE",  priority: "MEDIUM", color: "#00ff9f" };
  if (trend === "BEARISH" && nearR) return { label: "SELL_ZONE", priority: "MEDIUM", color: "#ff4466" };
  return { label: "NEUTRAL", priority: "LOW", color: "#888888" };
}

function analyzeAsset(prices, price) {
  if (prices.length < 40) return { trend: "LOADING", signal: { label: "NONE", priority: "LOW" }, zscore: 0, sr: {} };

  const fast     = avg(prices, 10);
  const slow     = avg(prices, 30);
  const zscore   = calcZScore(prices, 20);
  const sr       = calcSR(prices, 60);
  const momentum = prices.length >= 6 ? price - prices[prices.length - 6] : 0;
  const vol      = stdDev(prices.slice(-20)) / (fast || 1);

  const trend  = fast > slow ? "BULLISH" : fast < slow ? "BEARISH" : "NEUTRAL";
  const signal = classifySignal(zscore, trend, sr, price);

  return {
    trend,
    zscore    : +zscore.toFixed(4),
    momentum  : +momentum.toFixed(4),
    volatility: +vol.toFixed(4),
    sr        : {
      support   : sr.support    !== null ? +sr.support.toFixed(2)    : null,
      resistance: sr.resistance !== null ? +sr.resistance.toFixed(2) : null,
    },
    signal,
    ma: { fast: fast !== null ? +fast.toFixed(2) : null, slow: slow !== null ? +slow.toFixed(2) : null },
  };
}

// ── STATE STORE ──────────────────────────────────────────────────────────────

const ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

const store = {
  prices   : { BTCUSDT: [], ETHUSDT: [], SOLUSDT: [] },
  latest   : { BTCUSDT: null, ETHUSDT: null, SOLUSDT: null },
  analysis : { BTCUSDT: null, ETHUSDT: null, SOLUSDT: null },
  alerts   : [],         // rolling last-100 alerts
  prevSignal: {},        // for de-dup alerts
};

function pushPrice(asset, price) {
  const arr = store.prices[asset];
  arr.push(price);
  if (arr.length > 500) arr.shift();

  store.latest[asset]   = price;
  store.analysis[asset] = analyzeAsset(arr, price);

  // Auto-alert on priority signal change
  const sig = store.analysis[asset].signal;
  if (sig.priority !== "LOW" && sig.label !== store.prevSignal[asset]) {
    store.prevSignal[asset] = sig.label;
    store.alerts.push({
      ts      : new Date().toISOString(),
      asset,
      label   : sig.label,
      priority: sig.priority,
      price   : +price.toFixed(2),
      zscore  : store.analysis[asset].zscore,
    });
    if (store.alerts.length > 100) store.alerts.shift();
  }
}

// ── BINANCE WEBSOCKET FEEDS ──────────────────────────────────────────────────

const RECONNECT_DELAY = 5000; // ms

function connectBinance(symbol) {
  const key = symbol.toUpperCase();
  const url = `wss://stream.binance.com:9443/ws/${symbol}@trade`;

  const connect = () => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) {
      console.warn(`[Binance] Cannot create WS for ${key}:`, e.message);
      setTimeout(connect, RECONNECT_DELAY);
      return;
    }

    ws.on("open",  () => console.log(`[Binance] ✓ Connected: ${key}`));
    ws.on("error", (e) => console.warn(`[Binance] ${key} error:`, e.message));

    ws.on("message", (raw) => {
      try {
        const { p } = JSON.parse(raw);
        const price = parseFloat(p);
        if (!isNaN(price)) pushPrice(key, price);
        broadcastFeed({ asset: key, price, analysis: store.analysis[key] });
      } catch (_) { /* ignore malformed frames */ }
    });

    ws.on("close", () => {
      console.warn(`[Binance] ✗ Disconnected: ${key} — retrying in ${RECONNECT_DELAY}ms`);
      setTimeout(connect, RECONNECT_DELAY);
    });
  };

  connect();
}

// ── HTTP SERVER ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  totalRequests++;
  const url = req.url.split("?")[0];

  // ── 1. Dashboard ──────────────────────────────────────────────────────────
  if (url === "/" || url === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(buildDashboardHTML());
  }

  // ── 2. System + Market Metrics ────────────────────────────────────────────
  if (url === "/api/metrics") {
    const uptime = (Date.now() - START_TIME) / 1000;
    const mem    = process.memoryUsage();

    const payload = {
      system : {
        name          : "NEXUS v3.1",
        status        : "STABLE",
        uptimeSeconds : Math.round(uptime),
        rps           : +(totalRequests / uptime).toFixed(2),
        totalRequests,
        heapUsedMB    : +(mem.heapUsed  / 1024 / 1024).toFixed(1),
        heapTotalMB   : +(mem.heapTotal / 1024 / 1024).toFixed(1),
        rssMB         : +(mem.rss       / 1024 / 1024).toFixed(1),
        cpuCores      : os.cpus().length,
        platform      : process.platform,
        nodeVersion   : process.version,
        loadAvg       : os.loadavg().map(v => +v.toFixed(2)),
      },
      market : {
        connectedFeeds : ASSETS.filter(a => store.latest[a] !== null).length,
        totalAlerts    : store.alerts.length,
        latestAlerts   : store.alerts.slice(-5).reverse(),
        snapshot       : Object.fromEntries(
          ASSETS.map(a => [a, {
            price   : store.latest[a],
            analysis: store.analysis[a],
          }])
        ),
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(payload, null, 2));
  }

  // ── 3. Full Asset Snapshot ────────────────────────────────────────────────
  if (url === "/api/snapshot") {
    const snapshot = Object.fromEntries(
      ASSETS.map(a => [a, { price: store.latest[a], analysis: store.analysis[a] }])
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(snapshot, null, 2));
  }

  // ── 4. Alert History ─────────────────────────────────────────────────────
  if (url === "/api/alerts") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify([...store.alerts].reverse(), null, 2));
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error    : "Endpoint Not Found",
    available: ["/", "/api/metrics", "/api/snapshot", "/api/alerts", "WS:/feed"],
  }));
});

// ── WEBSOCKET SERVER (client feed on /feed) ───────────────────────────────────

const wss = new WebSocketServer({ server, path: "/feed" });

wss.on("connection", (ws, req) => {
  console.log(`[Feed] Client connected: ${req.socket.remoteAddress}`);

  // Send current snapshot immediately on connect
  const snapshot = Object.fromEntries(
    ASSETS.map(a => [a, { price: store.latest[a], analysis: store.analysis[a] }])
  );
  ws.send(JSON.stringify({ type: "SNAPSHOT", data: snapshot }));

  ws.on("error", (e) => console.warn("[Feed] Client error:", e.message));
  ws.on("close", ()  => console.log("[Feed] Client disconnected"));
});

function broadcastFeed(payload) {
  const msg = JSON.stringify({ type: "TICK", data: payload });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ── SELF-CONTAINED DASHBOARD HTML ────────────────────────────────────────────
// Served at GET /  — connects to WS /feed automatically.
// All market engines re-implemented client-side for live chart rendering.

function buildDashboardHTML() {
  return /* html */`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NEXUS MARKET LAB v3.1</title>
<style>
  :root {
    --green  : #00ff9f;
    --red    : #ff4466;
    --blue   : #00ccff;
    --yellow : #ffcc00;
    --orange : #ff8800;
    --bg     : #020408;
    --bg1    : #020810;
    --bg2    : #010508;
    --border : #0a1a2a;
    --dim    : #334455;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--green);
    font-family: 'Courier New', monospace; font-size: 12px;
    min-height: 100vh;
  }

  /* ── Header ── */
  #header {
    border-bottom: 1px solid var(--border);
    padding: 10px 16px;
    display: flex; justify-content: space-between; align-items: center;
    background: linear-gradient(90deg, #020810 0%, var(--bg) 100%);
  }
  #header .title    { font-size: 13px; letter-spacing: 4px; }
  #header .subtitle { font-size: 9px; color: var(--dim); letter-spacing: 2px; margin-top: 2px; }
  #header .status   { font-size: 9px; display: flex; align-items: center; gap: 6px; }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--green); box-shadow: 0 0 6px var(--green);
    animation: blink 2s infinite;
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

  /* ── Asset tabs ── */
  #tabs { padding: 8px 16px; display: flex; gap: 4px; }
  .tab {
    background: transparent; color: var(--green);
    border: 1px solid var(--border); padding: 4px 14px;
    font-size: 10px; letter-spacing: 2px; cursor: pointer;
    font-family: inherit; transition: all .2s;
  }
  .tab.active { background: var(--green); color: #000; font-weight: bold; }

  /* ── Stat cards ── */
  #cards {
    padding: 0 16px 8px;
    display: grid; grid-template-columns: repeat(4,1fr); gap: 6px;
  }
  .card {
    border: 1px solid var(--border); padding: 8px; background: var(--bg1);
  }
  .card-label { font-size: 9px; color: var(--dim); letter-spacing: 2px; }
  .card-value { font-size: 16px; margin-top: 3px; }
  .card-sub   { font-size: 10px; color: var(--dim); margin-top: 2px; }

  /* ── Chart ── */
  #chart-wrap {
    margin: 0 16px; border: 1px solid var(--border);
    background: var(--bg2); position: relative;
  }
  canvas { display: block; width: 100%; height: 180px; }

  /* ── Z-Gauge ── */
  #zgauge {
    margin: 6px 16px; border: 1px solid var(--border);
    padding: 8px; background: var(--bg1);
  }
  .gauge-track {
    background: #0a0e14; border-radius: 2px; height: 6px;
    position: relative; margin: 6px 0 4px;
  }
  .gauge-center {
    position: absolute; left: 50%; top: 0; bottom: 0;
    width: 1px; background: #333;
  }
  .gauge-thumb {
    width: 10px; height: 10px; border-radius: 50%;
    position: absolute; top: -2px;
    transition: left .3s ease, background .3s ease;
  }
  .gauge-labels {
    display: flex; justify-content: space-between;
    font-size: 10px; color: var(--dim);
  }

  /* ── Alert Log ── */
  #alerts {
    margin: 6px 16px 16px; border: 1px solid #0a1a20;
    padding: 8px; max-height: 130px; overflow-y: auto;
  }
  .alert-row {
    display: flex; gap: 10px; padding: 3px 0;
    border-bottom: 1px solid #0a0e14; font-size: 10px;
  }
  .alert-ts   { color: #333; }
  .alert-asset{ color: var(--dim); }

  /* ── Metrics Panel ── */
  #metrics-panel {
    margin: 0 16px 16px; border: 1px solid var(--border);
    padding: 10px; background: var(--bg1);
  }
  .metrics-grid {
    display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-top: 8px;
  }
  .metric-item { font-size: 10px; }
  .metric-key  { color: var(--dim); }
  .metric-val  { color: var(--green); font-size: 12px; }

  /* ── Claude Panel ── */
  #claude-panel {
    margin: 6px 16px; border: 1px solid #0d2030;
    background: linear-gradient(135deg,#020a0f,#030d15);
    padding: 12px;
  }
  #claude-panel header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px;
  }
  #claude-panel .panel-title {
    display: flex; align-items: center; gap: 8px;
    color: var(--blue); font-size: 11px; letter-spacing: 2px;
  }
  #analyze-btn {
    background: transparent; border: 1px solid var(--blue);
    color: var(--blue); padding: 4px 12px;
    font-size: 10px; letter-spacing: 1px; cursor: pointer;
    font-family: inherit;
  }
  #analyze-btn:disabled { color: #333; border-color: #333; cursor: not-allowed; }
  #claude-output {
    color: #aac8d8; font-size: 12px; line-height: 1.7;
    white-space: pre-wrap; text-align: right; direction: rtl;
    border-top: 1px solid #0d2030; padding-top: 10px;
    min-height: 20px;
  }
  .loading-bars { display: flex; gap: 3px; justify-content: center; padding: 14px 0; }
  .bar {
    width: 3px; height: 20px; background: var(--blue); opacity: .7;
    animation: barBounce 1s ease-in-out infinite;
  }
  @keyframes barBounce { 0%,100%{transform:scaleY(.4)} 50%{transform:scaleY(1)} }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #0a0e14; }
  ::-webkit-scrollbar-thumb { background: #1a2a3a; }
</style>
</head>
<body>

<!-- Header -->
<div id="header">
  <div>
    <div class="title">NEXUS MARKET LAB</div>
    <div class="subtitle">v3.1 · Z-SCORE + S/R + LLM · ENGINEERING SOVEREIGNTY</div>
  </div>
  <div class="status">
    <div class="dot" id="conn-dot" style="background:#555;box-shadow:none"></div>
    <span id="conn-label" style="color:#555">CONNECTING...</span>
  </div>
</div>

<!-- Asset Tabs -->
<div id="tabs">
  <button class="tab active" onclick="selectAsset('BTCUSDT')">BTC</button>
  <button class="tab"        onclick="selectAsset('ETHUSDT')">ETH</button>
  <button class="tab"        onclick="selectAsset('SOLUSDT')">SOL</button>
</div>

<!-- Stat Cards -->
<div id="cards">
  <div class="card">
    <div class="card-label">PRICE</div>
    <div class="card-value" id="c-price">—</div>
    <div class="card-sub"   id="c-change">—</div>
  </div>
  <div class="card">
    <div class="card-label">TREND</div>
    <div class="card-value" id="c-trend" style="font-size:13px">LOADING</div>
    <div class="card-sub">MA10 / MA30</div>
  </div>
  <div class="card" id="card-signal">
    <div class="card-label">SIGNAL</div>
    <div class="card-value" id="c-signal" style="font-size:11px">—</div>
    <div class="card-sub"   id="c-priority">—</div>
  </div>
  <div class="card">
    <div class="card-label">S/R LEVELS</div>
    <div class="card-sub" id="c-resistance" style="color:#ff4466;font-size:11px;margin-top:4px">R: —</div>
    <div class="card-sub" id="c-support"    style="color:#00ff9f;font-size:11px;margin-top:2px">S: —</div>
  </div>
</div>

<!-- Chart -->
<div id="chart-wrap">
  <canvas id="chart" height="180"></canvas>
</div>

<!-- Z-Score Gauge -->
<div id="zgauge">
  <div style="font-size:9px;color:#445;letter-spacing:2px">Z-SCORE RADAR</div>
  <div class="gauge-track">
    <div class="gauge-center"></div>
    <div class="gauge-thumb" id="gauge-thumb" style="left:50%;background:#888"></div>
  </div>
  <div class="gauge-labels">
    <span>−3σ</span>
    <span>Z = <span id="z-val">0.00</span></span>
    <span>+3σ</span>
  </div>
  <div id="z-msg" style="font-size:10px;color:#445;margin-top:4px">Monitoring...</div>
</div>

<!-- Claude Panel -->
<div id="claude-panel">
  <header>
    <div class="panel-title">
      <div class="dot" style="background:var(--blue);box-shadow:0 0 8px var(--blue)"></div>
      CLAUDE STRATEGIC CONTEXT
    </div>
    <button id="analyze-btn" onclick="runClaudeAnalysis()">▶ ANALYZE</button>
  </header>
  <div id="claude-output" style="color:#333;font-style:italic;text-align:center">
    اضغط ANALYZE للحصول على رؤية استراتيجية
  </div>
</div>

<!-- Alert Log -->
<div id="alerts">
  <div style="font-size:9px;color:#445;letter-spacing:2px;margin-bottom:6px">ALERT LOG</div>
  <div id="alert-list" style="color:#333;font-size:11px">Monitoring...</div>
</div>

<!-- System Metrics -->
<div id="metrics-panel">
  <div style="font-size:9px;color:#445;letter-spacing:2px">SYSTEM METRICS</div>
  <div class="metrics-grid" id="metrics-grid">
    <div class="metric-item"><div class="metric-key">STATUS</div><div class="metric-val" id="m-status">—</div></div>
    <div class="metric-item"><div class="metric-key">UPTIME</div><div class="metric-val" id="m-uptime">—</div></div>
    <div class="metric-item"><div class="metric-key">RPS</div><div class="metric-val" id="m-rps">—</div></div>
    <div class="metric-item"><div class="metric-key">HEAP</div><div class="metric-val" id="m-heap">—</div></div>
    <div class="metric-item"><div class="metric-key">CPU CORES</div><div class="metric-val" id="m-cpu">—</div></div>
    <div class="metric-item"><div class="metric-key">LOAD AVG</div><div class="metric-val" id="m-load">—</div></div>
  </div>
</div>

<script>
// ── STATE ──────────────────────────────────────────────────────────────────
const state = {
  asset    : "BTCUSDT",
  prices   : { BTCUSDT: [], ETHUSDT: [], SOLUSDT: [] },
  latest   : { BTCUSDT: null, ETHUSDT: null, SOLUSDT: null },
  analysis : { BTCUSDT: null, ETHUSDT: null, SOLUSDT: null },
  alerts   : []
  prevSignal: {},
  lastAnalyzed: 0,
};

// ── WS FEED ────────────────────────────────────────────────────────────────
let ws;
function connectFeed() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(proto + "://" + location.host + "/feed");

  ws.onopen = () => {
    document.getElementById("conn-dot").style.cssText   = "background:var(--green);box-shadow:0 0 6px var(--green)";
    document.getElementById("conn-label").textContent   = "LIVE";
    document.getElementById("conn-label").style.color   = "var(--green)";
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "SNAPSHOT") {
      Object.entries(msg.data).forEach(([asset, d]) => {
        if (d.price) state.latest[asset] = d.price;
        if (d.analysis) state.analysis[asset] = d.analysis;
      });
      render();
    } else if (msg.type === "TICK") {
      const { asset, price, analysis } = msg.data;
      state.prices[asset].push(price);
      if (state.prices[asset].length > 200) state.prices[asset].shift();
      state.latest[asset]   = price;
      state.analysis[asset] = analysis;

      // local alert tracking
      if (analysis?.signal?.priority !== "LOW" &&
          analysis?.signal?.label !== state.prevSignal[asset]) {
        state.prevSignal[asset] = analysis.signal.label;
        state.alerts.push({
          ts    : new Date().toLocaleTimeString("en", { hour12: false }),
          asset,
          label : analysis.signal.label,
          color : analysis.signal.color,
          zscore: analysis.zscore,
          priority: analysis.signal.priority,
        });
        if (state.alerts.length > 100) state.alerts.shift();
        renderAlerts();
      }

      if (asset === state.asset) render();
    }
  };

  ws.onclose = () => {
    document.getElementById("conn-dot").style.cssText   = "background:#ff4466;box-shadow:0 0 6px #ff4466";
    document.getElementById("conn-label").textContent   = "RECONNECTING...";
    document.getElementById("conn-label").style.color   = "#ff4466";
    setTimeout(connectFeed, 3000);
  };

  ws.onerror = () => ws.close();
}

// ── RENDER ─────────────────────────────────────────────────────────────────
function selectAsset(a) {
  state.asset = a;
  document.querySelectorAll(".tab").forEach((t, i) => {
    t.classList.toggle("active", ["BTCUSDT","ETHUSDT","SOLUSDT"][i] === a);
  });
  render();
}

function fmtPrice(p, asset) {
  if (p === null) return "—";
  if (asset === "BTCUSDT") return p.toFixed(0);
  if (asset === "ETHUSDT") return p.toFixed(1);
  return p.toFixed(3);
}

function render() {
  const { asset } = state;
  const price    = state.latest[asset];
  const analysis = state.analysis[asset];
  const prices   = state.prices[asset];

  // Price card
  const $price = document.getElementById("c-price");
  $price.textContent = fmtPrice(price, asset);

  if (prices.length > 1) {
    const pct = ((price - prices[0]) / prices[0] * 100).toFixed(2);
    const up  = parseFloat(pct) >= 0;
    document.getElementById("c-change").textContent = (up ? "+" : "") + pct + "%";
    document.getElementById("c-change").style.color = up ? "var(--green)" : "var(--red)";
  }

  if (!analysis) return;

  // Trend
  const trendEl = document.getElementById("c-trend");
  trendEl.textContent = analysis.trend;
  trendEl.style.color = analysis.trend === "BULLISH" ? "var(--green)"
                      : analysis.trend === "BEARISH" ? "var(--red)" : "#888";

  // Signal
  const sig = analysis.signal;
  document.getElementById("c-signal").textContent = sig.label;
  document.getElementById("c-signal").style.color = sig.color;
  document.getElementById("c-priority").textContent = "● " + sig.priority;
  document.getElementById("c-priority").style.color =
    sig.priority === "HIGH" ? "var(--red)" : "#666";
  document.getElementById("card-signal").style.borderColor = sig.color + "44";

  // S/R
  const dp = asset === "BTCUSDT" ? 0 : asset === "ETHUSDT" ? 1 : 3;
  document.getElementById("c-resistance").textContent =
    "R: " + (analysis.sr?.resistance !== null ? (+analysis.sr.resistance).toFixed(dp) : "—");
  document.getElementById("c-support").textContent =
    "S: " + (analysis.sr?.support    !== null ? (+analysis.sr.support).toFixed(dp)    : "—");

  // Z-Gauge
  const z       = analysis.zscore ?? 0;
  const clamped = Math.max(-3, Math.min(3, z));
  const pct     = ((clamped + 3) / 6) * 100;
  const zColor  = Math.abs(z) > 2.5 ? "var(--red)" : Math.abs(z) > 1.5 ? "var(--yellow)" : "var(--green)";
  const thumb   = document.getElementById("gauge-thumb");
  thumb.style.left       = "calc(" + pct + "% - 5px)";
  thumb.style.background = zColor;
  thumb.style.boxShadow  = "0 0 6px " + zColor;
  document.getElementById("z-val").textContent  = z.toFixed(2);
  document.getElementById("z-val").style.color  = zColor;
  const zMsg = document.getElementById("z-msg");
  if (Math.abs(z) > 2.5) {
    zMsg.textContent  = "⚡ حركة استثنائية — تحقق من S/R فوراً";
    zMsg.style.color  = "var(--red)";
  } else if (Math.abs(z) > 1.5) {
    zMsg.textContent  = "⚠ ضغط متراكم — راقب المستويات";
    zMsg.style.color  = "var(--yellow)";
  } else {
    zMsg.textContent  = "✓ ضمن النطاق الاعتيادي";
    zMsg.style.color  = "#445";
  }

  // Chart
  drawChart(prices, analysis);
}

// ── CANVAS CHART ────────────────────────────────────────────────────────────
function drawChart(prices, analysis) {
  const canvas  = document.getElementById("chart");
  const ctx     = canvas.getContext("2d");
  canvas.width  = canvas.offsetWidth;
  canvas.height = 180;
  const W = canvas.width, H = canvas.height;

  if (prices.length < 2) return;
  const visible = prices.slice(-80);
  const min = Math.min(...visible) * 0.9995;
  const max = Math.max(...visible) * 1.0005;
  const range = max - min || 1;
  const xOf = (i) => (i / (visible.length - 1)) * W;
  const yOf = (p) => H - ((p - min) / range) * H;

  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = "rgba(0,255,159,.04)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    ctx.beginPath(); ctx.moveTo(0, g/4*H); ctx.lineTo(W, g/4*H); ctx.stroke();
  }

  // S/R lines
  const sr = analysis?.sr ?? {};
  const drawSRLine = (level, color, label, above) => {
    if (!level) return;
    const y = yOf(level);
    if (y < 0 || y > H) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.font = "10px 'Courier New'";
    ctx.fillText(label + " " + (+level).toFixed(0), W - 75, above ? y - 3 : y + 12);
  };
  drawSRLine(sr.resistance, "rgba(255,68,102,.7)",  "R", true);
  drawSRLine(sr.support,    "rgba(0,255,159,.7)",   "S", false);

  // Price line
  const z = analysis?.zscore ?? 0;
  const lineColor = Math.abs(z) > 2.5 ? "#ff4466" : Math.abs(z) > 1.5 ? "#ffcc00" : "#00ff9f";
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgba(0,255,159,.2)");
  grad.addColorStop(1, lineColor);
  ctx.beginPath();
  visible.forEach((p, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(p)) : ctx.lineTo(xOf(i), yOf(p)));
  ctx.strokeStyle = grad; ctx.lineWidth = 1.5; ctx.stroke();

  // Fill
  ctx.lineTo(xOf(visible.length-1), H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = "rgba(0,255,159,.03)"; ctx.fill();
}

// ── ALERT RENDER ────────────────────────────────────────────────────────────
function renderAlerts() {
  const el = document.getElementById("alert-list");
  if (state.alerts.length === 0) { el.textContent = "Monitoring..."; return; }
  el.innerHTML = [...state.alerts].reverse().slice(0, 20).map(a => \`
    <div class="alert-row">
      <span class="alert-ts">\${a.ts}</span>
      <span class="alert-asset">\${a.asset.replace("USDT","")}</span>
      <span style="color:\${a.color}">\${a.label}</span>
      <span style="color:#555">Z=\${a.zscore}</span>
    </div>\`).join("");
}

// ── METRICS POLL ────────────────────────────────────────────────────────────
async function pollMetrics() {
  try {
    const r = await fetch("/api/metrics");
    const d = await r.json();
    const s = d.system;
    const fmt = (sec) => sec > 3600
      ? (sec/3600).toFixed(1) + "h"
      : sec > 60 ? (sec/60).toFixed(0) + "m" : sec + "s";
    document.getElementById("m-status").textContent = s.status;
    document.getElementById("m-uptime").textContent = fmt(s.uptimeSeconds);
    document.getElementById("m-rps"   ).textContent = s.rps;
    document.getElementById("m-heap"  ).textContent = s.heapUsedMB + " MB";
    document.getElementById("m-cpu"   ).textContent = s.cpuCores + " cores";
    document.getElementById("m-load"  ).textContent = s.loadAvg[0];
  } catch (_) {}
}

// ── CLAUDE ANALYSIS ─────────────────────────────────────────────────────────
async function runClaudeAnalysis() {
  const now = Date.now();
  if (now - state.lastAnalyzed < 15000) return;
  state.lastAnalyzed = now;

  const { asset } = state;
  const price    = state.latest[asset];
  const analysis = state.analysis[asset];
  if (!analysis) return;

  const btn = document.getElementById("analyze-btn");
  const out = document.getElementById("claude-output");
  btn.disabled = true;
  btn.textContent = "ANALYZING...";
  out.innerHTML = \`<div class="loading-bars">\${[0,1,2,3,4].map(i =>
    \`<div class="bar" style="animation-delay:\${i*.1}s"></div>\`).join("")}</div>\`;

  const prompt = \`أنت محلل أسواق مالية محترف ومتخصص في التداول الكمي. قدم تحليلاً استراتيجياً موجزاً وحاداً (3-4 جمل فقط):

الأصل: \${asset}
السعر: \${price?.toFixed(2)}
Z-Score: \${analysis.zscore} (\${Math.abs(analysis.zscore) > 2.5 ? "⚡ استثنائي" : Math.abs(analysis.zscore) > 1.5 ? "⚠ قوي" : "✓ عادي"})
الاتجاه: \${analysis.trend} | الزخم: \${analysis.momentum}
إشارة النظام: \${analysis.signal?.label} (\${analysis.signal?.priority})
Support: \${analysis.sr?.support ?? "—"} | Resistance: \${analysis.sr?.resistance ?? "—"}

قدم:
1. قراءة Z-Score: ماذا تعني هذه الحركة؟
2. موقع السعر من S/R: أين نحن على الخارطة؟
3. السيناريو الأرجح
4. مستوى المخاطرة (منخفض/متوسط/عالٍ) مع سبب واحد

كن مباشراً، بلا مقدمات.\`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model     : "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages  : [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || "").join("");
    out.textContent = text || "لا يوجد رد";
    out.style.color = "#aac8d8";
  } catch (e) {
    out.textContent = "⚠️ خطأ في الاتصال بـ Claude API";
    out.style.color = "var(--red)";
  }

  btn.disabled    = false;
  btn.textContent = "▶ ANALYZE";
}

// ── BOOT ────────────────────────────────────────────────────────────────────
connectFeed();
setInterval(pollMetrics, 5000);
pollMetrics();
</script>
</body>
</html>`;
}
// ── BOOT ENGINE ──────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  const line = "═".repeat(52);
  console.log(`
  ╔${line}╗
  ║         ⚔️  NEXUS MARKET LAB v3.1 CORE               ║
  ║            ENGINEERING SOVEREIGNTY                    ║
  ╠${line}╣
  ║  Dashboard  → http://localhost:${PORT}                    ║
  ║  Metrics    → http://localhost:${PORT}/api/metrics        ║
  ║  Snapshot   → http://localhost:${PORT}/api/snapshot       ║
  ║  Alerts     → http://localhost:${PORT}/api/alerts         ║
  ║  Live Feed  → ws://localhost:${PORT}/feed                 ║
  ╚${line}╝`);

  // Connect to Binance after server is up
  ["btcusdt", "ethusdt", "solusdt"].forEach(connectBinance);
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
process.on("SIGINT",  () => { console.log("\n[NEXUS] Shutting down..."); server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
