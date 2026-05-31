// ============================================================
//  NEXUS MARKET LAB v3 — Server with REST API polling
//  بسبب خطأ 451 من Binance WebSocket، نستخدم REST API بدلاً منه
// ============================================================

const WebSocket = require("ws");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const { analyze } = require("./engine/analyzer");

// ========== الإعدادات العامة ==========
const PORT = process.env.PORT || 3000;
const ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TIMEFRAMES = ["1m", "5m", "15m", "1h"];
const RISK_CONFIG = {
    balance: parseFloat(process.env.ACCOUNT_BALANCE) || 10000,
    riskPercent: parseFloat(process.env.RISK_PERCENT) || 2,
    riskReward: parseFloat(process.env.RISK_REWARD) || 2
};

// تخزين الشموع لكل أصل وإطار زمني
let candlesStore = {};
ASSETS.forEach(asset => {
    candlesStore[asset] = {};
    TIMEFRAMES.forEach(tf => {
        candlesStore[asset][tf] = [];
    });
});

// WebSocket server for clients
const wss = new WebSocket.Server({ port: PORT });

// دالة جلب الشموع من Binance REST API
async function fetchCandles(symbol, interval, limit = 100) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await axios.get(url);
        return response.data.map(k => ({
            timestamp: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
    } catch (err) {
        console.error(`خطأ في جلب ${symbol} ${interval}:`, err.message);
        return [];
    }
}

// تحديث بيانات كل أصل وإطار زمني
async function updateAllData() {
    for (const asset of ASSETS) {
        for (const tf of TIMEFRAMES) {
            const candles = await fetchCandles(asset, tf, 200);
            if (candles.length) {
                candlesStore[asset][tf] = candles;
                // بعد التحديث، نقوم بالتحليل ونبث البيانات
                if (candles.length >= 50) {
                    const closes = candles.map(c => c.close);
                    const currentPrice = candles[candles.length - 1].close;
                    const analysis = analyze(
                        closes,
                        currentPrice,
                        asset,
                        candles,
                        RISK_CONFIG
                    );
                    const enriched = { ...analysis, timeframe: tf, timestamp: new Date().toISOString() };
                    broadcast({
                        asset,
                        timeframe: tf,
                        price: currentPrice,
                        analysis: enriched
                    });
                }
            }
        }
    }
}

// دالة البث
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// جلب البيانات كل 60 ثانية (أو حسب الحاجة)
setInterval(() => {
    updateAllData();
}, 60000); // كل دقيقة

// تشغيل أول جلب فور البدء
updateAllData();

// WebSocket connection
wss.on("connection", (ws, req) => {
    console.log(`🔗 عميل جديد متصل: ${req.socket.remoteAddress}`);
    ws.send(JSON.stringify({ type: "welcome", message: "مرحباً بك في NEXUS MARKET LAB v3 (REST mode)" }));
});

console.log(`🚀 NEXUS MARKET LAB v3 (REST mode) يعمل على المنفذ ${PORT}`);
console.log(`📊 الأصول المدعومة: ${ASSETS.join(", ")}`);
console.log(`⏱️ الأطر الزمنية: ${TIMEFRAMES.join(", ")}`);
console.log(`💰 إعدادات المخاطرة: رصيد ${RISK_CONFIG.balance} دولار، مخاطرة ${RISK_CONFIG.riskPercent}%، نسبة ربح ${RISK_CONFIG.riskReward}:1`);
