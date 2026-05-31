// ============================================================
//  NEXUS MARKET LAB v3 — نسخة محسّنة للخطة المجانية
//  استهلاك أقل للذاكرة والمعالج، يعمل على Render Free Tier
// ============================================================

const WebSocket = require("ws");
const axios = require("axios");
require("dotenv").config();

const { analyze } = require("./engine/analyzer");

// ========== إعدادات منخفضة الاستهلاك ==========
const PORT = process.env.PORT || 3000;
const ASSETS = ["BTCUSDT", "ETHUSDT"];  // قللنا الأصول (أزلنا SOL مؤقتاً)
const TIMEFRAMES = ["15m", "1h"];       // قللنا الأطر الزمنية
const UPDATE_INTERVAL = 120000;          // تحديث كل دقيقتين (بدلاً من دقيقة)
const MAX_CANDLES = 100;                 // نحتفظ بآخر 100 شمعة فقط

const RISK_CONFIG = {
    balance: 10000,
    riskPercent: 2,
    riskReward: 2
};

// تخزين الشموع
let candlesStore = {};
ASSETS.forEach(asset => {
    candlesStore[asset] = {};
    TIMEFRAMES.forEach(tf => {
        candlesStore[asset][tf] = [];
    });
});

// WebSocket server للعملاء
const wss = new WebSocket.Server({ port: PORT });

// دالة جلب الشموع مع إعادة محاولة تلقائية
async function fetchCandles(symbol, interval, retries = 2) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${MAX_CANDLES}`;
        const response = await axios.get(url, { timeout: 10000 });
        return response.data.map(k => ({
            timestamp: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
    } catch (err) {
        if (retries > 0) {
            console.log(`⚠️ إعادة محاولة جلب ${symbol} ${interval}...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return fetchCandles(symbol, interval, retries - 1);
        }
        console.error(`❌ فشل جلب ${symbol} ${interval}:`, err.message);
        return [];
    }
}

// تحديث وتحليل وبث
async function updateAndBroadcast() {
    for (const asset of ASSETS) {
        for (const tf of TIMEFRAMES) {
            const candles = await fetchCandles(asset, tf);
            if (candles.length >= 30) {  // نحتاج 30 شمعة كحد أدنى (بدلاً من 50)
                candlesStore[asset][tf] = candles;
                const closes = candles.map(c => c.close);
                const currentPrice = candles[candles.length - 1].close;
                const analysis = analyze(closes, currentPrice, asset, candles, RISK_CONFIG);
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

// البث للعملاء المتصلين
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// جدولة التحديثات (لن تتراكم الطلبات إذا استغرق الجلب وقتاً أطول)
let isUpdating = false;
async function scheduledUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        await updateAndBroadcast();
    } catch (err) {
        console.error("خطأ في التحديث المجدول:", err.message);
    } finally {
        isUpdating = false;
    }
}

// بدء التحديث الدوري
setInterval(scheduledUpdate, UPDATE_INTERVAL);
scheduledUpdate(); // أول تحديث فور البدء

// WebSocket connection
wss.on("connection", (ws, req) => {
    console.log(`🔗 عميل جديد متصل: ${req.socket.remoteAddress}`);
    ws.send(JSON.stringify({ type: "welcome", message: "NEXUS MARKET LAB (Free Tier Optimized)" }));
});

console.log(`🚀 NEXUS MARKET LAB v3 (محسن) يعمل على المنفذ ${PORT}`);
console.log(`📊 الأصول: ${ASSETS.join(", ")} | الأطر: ${TIMEFRAMES.join(", ")}`);
console.log(`⏱️ تحديث كل ${UPDATE_INTERVAL/1000} ثانية`);
