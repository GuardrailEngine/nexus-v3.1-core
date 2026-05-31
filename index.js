// ============================================================
//  NEXUS MARKET LAB v3 — WebSocket Server
//  بث تحليلات حية لـ BTC, ETH, SOL عبر مؤشرات متقدمة + إدارة مخاطر
// ============================================================

const WebSocket = require("ws");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
require("dotenv").config();

// استيراد محرك التحليل (يجب أن يكون في مجلد engine/analyzer.js)
const { analyze } = require("./engine/analyzer");

// ========== الإعدادات العامة ==========
const PORT = process.env.PORT || 3000;
const ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TIMEFRAMES = ["1m", "5m", "15m", "1h"];
// إعدادات المخاطرة الافتراضية (يمكن تعديلها)
const RISK_CONFIG = {
    balance: parseFloat(process.env.ACCOUNT_BALANCE) || 10000,
    riskPercent: parseFloat(process.env.RISK_PERCENT) || 2,
    riskReward: parseFloat(process.env.RISK_REWARD) || 2
};

// ========== تخزين البيانات ==========
// candlesStore[asset][timeframe] = مصفوفة من الشموع { timestamp, open, high, low, close, volume }
let candlesStore = {};
ASSETS.forEach(asset => {
    candlesStore[asset] = {};
    TIMEFRAMES.forEach(tf => {
        candlesStore[asset][tf] = [];
    });
});

// ========== WebSocket Server ==========
const wss = new WebSocket.Server({ port: PORT });

// الاتصال بـ Binance WebSocket لكل أصل وكل إطار زمني
ASSETS.forEach(asset => {
    const symbol = asset.toLowerCase();
    TIMEFRAMES.forEach(timeframe => {
        const streamUrl = `wss://stream.binance.com:9443/ws/${symbol}@kline_${timeframe}`;
        const wsStream = new WebSocket(streamUrl);

        wsStream.on("open", () => {
            console.log(`✅ متصل بـ ${asset} ${timeframe}`);
        });

        wsStream.on("message", async (data) => {
            const json = JSON.parse(data);
            const k = json.k;
            if (!k.isFinal) return;  // ننتظر إغلاق الشمعة فقط

            const candle = {
                timestamp: k.t,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: parseFloat(k.v)
            };

            // تخزين الشمعة
            const store = candlesStore[asset][timeframe];
            store.push(candle);
            if (store.length > 500) store.shift();

            // التحليل بعد أن يكون لدينا بيانات كافية (على الأقل 50 شمعة)
            if (store.length >= 50) {
                const closes = store.map(c => c.close);
                const currentPrice = candle.close;
                // استدعاء محرك التحليل مع تمرير الشموع الكاملة (لحساب ATR)
                const analysis = analyze(
                    closes,
                    currentPrice,
                    asset,
                    store,          // مصفوفة الشموع الكاملة
                    RISK_CONFIG
                );

                // إضافة معلومات إضافية للتوصية (مثل حجم العقد، وقف الخسارة، إلخ)
                const enrichedAnalysis = {
                    ...analysis,
                    timeframe,
                    timestamp: new Date().toISOString()
                };

                // بث التحليل لجميع عملاء WebSocket
                broadcast({
                    asset,
                    timeframe,
                    price: currentPrice,
                    analysis: enrichedAnalysis
                });
            }
        });

        wsStream.on("error", (err) => {
            console.error(`خطأ في WebSocket لـ ${asset} ${timeframe}:`, err.message);
        });

        wsStream.on("close", () => {
            console.log(`🔌 تم قطع الاتصال بـ ${asset} ${timeframe}، إعادة محاولة بعد 5 ثوان`);
            setTimeout(() => {
                // إعادة الاتصال (بسيطة)
                const newWs = new WebSocket(streamUrl);
                // يمكنك إعادة تعريف الأحداث، لكن للتبسيط نتركها
            }, 5000);
        });
    });
});

// دالة البث لجميع العملاء المتصلين
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// ========== إدارة الاتصالات ==========
wss.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔗 عميل جديد متصل: ${clientIp}`);

    // إرسال ترحيب أو إعدادات أولية (اختياري)
    ws.send(JSON.stringify({ type: "welcome", message: "مرحباً بك في NEXUS MARKET LAB v3" }));

    ws.on("close", () => {
        console.log(`❌ عميل قطع الاتصال: ${clientIp}`);
    });
});

// ========== بدء الخادم ==========
console.log(`🚀 NEXUS MARKET LAB v3 WebSocket يعمل على المنفذ ${PORT}`);
console.log(`📊 الأصول المدعومة: ${ASSETS.join(", ")}`);
console.log(`⏱️ الأطر الزمنية: ${TIMEFRAMES.join(", ")}`);
console.log(`💰 إعدادات المخاطرة: رصيد ${RISK_CONFIG.balance} دولار، مخاطرة ${RISK_CONFIG.riskPercent}%، نسبة ربح ${RISK_CONFIG.riskReward}:1`);
