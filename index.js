// ╔════════════════════════════════════════════════════╗
// ║               NEXUS v3.1 CORE                      ║
// ║        Single-File · Zero Dependencies             ║
// ╚════════════════════════════════════════════════════╝

const http = require("http");
const os = require("os");

// ── CONFIG ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const WORKERS = os.cpus().length;

// ── METRICS ──────────────────────────────────────────
let totalRequests = 0;
let startTime = Date.now();

// ── CORE ENGINE ──────────────────────────────────────
const server = http.createServer((req, res) => {
  totalRequests++;

  // Simple routing
  if (req.url === "/") {
    return respond(res, 200, {
      system: "NEXUS v3.1",
      status: "running",
      uptime: getUptime(),
    });
  }

  if (req.url === "/metrics") {
    return respond(res, 200, {
      totalRequests,
      uptime: getUptime(),
      reqPerSec: calculateRPS(),
      memory: process.memoryUsage(),
    });
  }

  if (req.url === "/health") {
    return respond(res, 200, { status: "OK" });
  }

  return respond(res, 404, { error: "Not Found" });
});

// ── HELPERS ──────────────────────────────────────────
function respond(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function getUptime() {
  return ((Date.now() - startTime) / 1000).toFixed(2) + "s";
}

function calculateRPS() {
  const seconds = (Date.now() - startTime) / 1000;
  return (totalRequests / seconds).toFixed(2);
}

// ── START SERVER ─────────────────────────────────────
server.listen(PORT, () => {
  console.log(`⚔️ NEXUS v3.1 running on port ${PORT}`);
  console.log(`🚀 Workers: ${WORKERS}`);
});
