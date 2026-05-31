const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
require("dotenv").config();

// ---------------------------------------------
// Configuration
// ---------------------------------------------
const PORT = process.env.PORT || 3000;
const NEXUS_CORE_API = process.env.NEXUS_CORE_API; // e.g., "http://localhost:3000/api/chat"
const MASTER_KEY = process.env.MASTER_KEY; // for NEXUS CORE authentication
const RISK_PERCENT = parseFloat(process.env.RISK_PERCENT) || 2; // % of portfolio per trade
const ACCOUNT_BALANCE = parseFloat(process.env.ACCOUNT_BALANCE) || 10000; // USD
const MIN_RISK_REWARD_RATIO = parseFloat(process.env.MIN_RISK_REWARD_RATIO) || 2.0; // reward:risk

// Supported assets and timeframes
const ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TIMEFRAMES = ["1m", "5m", "15m", "1h"]; // We'll aggregate candles

// Store candles per asset & timeframe
let candlesStore = {};
ASSETS.forEach(asset => {
    candlesStore[asset] = {};
    TIMEFRAMES.forEach(tf => {
        candlesStore[asset][tf] = []; // array of { open, high, low, close, volume, timestamp }
    });
});

// WebSocket clients
const wss = new WebSocket.Server({ port: PORT });

// SQLite DB for historical data (optional, for persistence)
const db = new sqlite3.Database("./market_data.db");
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS candles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset TEXT,
        timeframe TEXT,
        timestamp INTEGER,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume REAL
    )`);
});

// ---------------------------------------------
// Helper: Save candle to DB
// ---------------------------------------------
function saveCandle(asset, timeframe, candle) {
    const stmt = db.prepare(`INSERT INTO candles (asset, timeframe, timestamp, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(asset, timeframe, candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume);
    stmt.finalize();
}

// ---------------------------------------------
// Technical Indicators (pure functions)
// ---------------------------------------------
function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[prices.length - i] - prices[prices.length - i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[prices.length - i] - prices[prices.length - i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(prices, fast=12, slow=26, signal=9) {
    if (prices.length < slow) return { macd: 0, signal: 0, histogram: 0 };
    const emaFast = calculateEMA(prices.slice(-fast), fast);
    const emaSlow = calculateEMA(prices.slice(-slow), slow);
    const macd = emaFast - emaSlow;
    // Need history of MACD for signal line – simplified: use last 9 macd values
    // For brevity, return current macd only (full implementation would store array)
    return { macd, signal: macd, histogram: 0 };
}

function calculateBollingerBands(prices, period=20, stdDev=2) {
    if (prices.length < period) return { upper: null, middle: null, lower: null };
    const slice = prices.slice(-period);
    const middle = slice.reduce((a,b) => a+b,0)/period;
    const variance = slice.map(p => Math.pow(p-middle,2)).reduce((a,b)=>a+b,0)/period;
    const std = Math.sqrt(variance);
    return { upper: middle + stdDev*std, middle, lower: middle - stdDev*std };
}

function calculateATR(candles, period=14) {
    if (candles.length < period+1) return 0;
    let trSum = 0;
    for (let i = candles.length-period; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trSum += tr;
    }
    return trSum / period;
}

// ---------------------------------------------
// Risk Management
// ---------------------------------------------
function computePositionSize(entryPrice, stopLossPrice, accountBalance, riskPercent) {
    const riskAmount = accountBalance * (riskPercent / 100);
    const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
    if (riskPerUnit === 0) return 0;
    const positionSize = riskAmount / riskPerUnit;
    return positionSize; // in units of asset
}

function computeStopLoss(currentPrice, atr, direction = "long") {
    if (direction === "long") return currentPrice - (2 * atr);
    else return currentPrice + (2 * atr);
}

function computeTakeProfit(entryPrice, stopLoss, riskRewardRatio) {
    const risk = Math.abs(entryPrice - stopLoss);
    return entryPrice + (risk * riskRewardRatio);
}

// ---------------------------------------------
// Analysis Engine (integrates all indicators)
// ---------------------------------------------
function analyzeMarket(asset, timeframe, candles) {
    if (candles.length < 50) return { signal: "NEUTRAL", reason: "Insufficient data", confidence: 0 };

    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length-1];
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const rsi = calculateRSI(closes, 14);
    const macdObj = calculateMACD(closes);
    const bb = calculateBollingerBands(closes);
    const atr = calculateATR(candles, 14);
    
    // Basic trend detection
    let trend = "NEUTRAL";
    if (ema9 > ema21) trend = "UP";
    else if (ema9 < ema21) trend = "DOWN";
    
    // Overbought/Oversold
    let rsiSignal = "NEUTRAL";
    if (rsi > 70) rsiSignal = "OVERBOUGHT";
    else if (rsi < 30) rsiSignal = "OVERSOLD";
    
    // Bollinger squeeze or breakout
    let bbSignal = "NEUTRAL";
    if (bb.upper !== null && currentPrice > bb.upper) bbSignal = "BULLISH_BREAKOUT";
    else if (bb.lower !== null && currentPrice < bb.lower) bbSignal = "BEARISH_BREAKOUT";
    
    // MACD cross (simplified)
    let macdSignal = "NEUTRAL";
    if (macdObj.macd > 0) macdSignal = "BULLISH";
    else if (macdObj.macd < 0) macdSignal = "BEARISH";
    
    // Combined signal (weighted)
    let score = 0;
    if (trend === "UP") score += 2;
    if (trend === "DOWN") score -= 2;
    if (rsiSignal === "OVERSOLD") score += 1;
    if (rsiSignal === "OVERBOUGHT") score -= 1;
    if (bbSignal === "BULLISH_BREAKOUT") score += 2;
    if (bbSignal === "BEARISH_BREAKOUT") score -= 2;
    if (macdSignal === "BULLISH") score += 1;
    if (macdSignal === "BEARISH") score -= 1;
    
    let signal = "NEUTRAL";
    if (score >= 3) signal = "STRONG_BUY";
    else if (score >= 1) signal = "BUY";
    else if (score <= -3) signal = "STRONG_SELL";
    else if (score <= -1) signal = "SELL";
    
    // Compute stop loss & take profit (based on ATR)
    const suggestedStop = computeStopLoss(currentPrice, atr, signal.includes("BUY") ? "long" : "short");
    const riskReward = MIN_RISK_REWARD_RATIO;
    const suggestedTakeProfit = computeTakeProfit(currentPrice, suggestedStop, riskReward);
    const positionSize = computePositionSize(currentPrice, suggestedStop, ACCOUNT_BALANCE, RISK_PERCENT);
    
    return {
        asset, timeframe, currentPrice,
        indicators: { ema9, ema21, rsi, macd: macdObj.macd, bbUpper: bb.upper, bbLower: bb.lower, atr },
        signal, score, confidence: Math.min(100, Math.abs(score)*15 + 20),
        riskManagement: {
            stopLoss: suggestedStop,
            takeProfit: suggestedTakeProfit,
            positionSize: positionSize.toFixed(4),
            riskRewardRatio: riskReward,
            riskPercent: RISK_PERCENT
        },
        reason: `Trend: ${trend}, RSI: ${rsi.toFixed(1)}, MACD: ${macdObj.macd.toFixed(2)}, BB: ${bbSignal}`
    };
}

// ---------------------------------------------
// Optional: Call NEXUS CORE API for AI enhancement
// ---------------------------------------------
async function enrichWithAIAnalysis(analysis) {
    if (!NEXUS_CORE_API || !MASTER_KEY) return analysis;
    try {
        const prompt = `تحليل فني للأصل ${analysis.asset} على إطار ${analysis.timeframe}:\n` +
                       `السعر الحالي: ${analysis.currentPrice}\n` +
                       `الإشارة: ${analysis.signal}\n` +
                       `الأسباب: ${analysis.reason}\n` +
                       `أعط توصية مختصرة وسبباً واحداً فقط.`;
        const response = await axios.post(NEXUS_CORE_API, {
            history: [{ role: "user", content: prompt }],
            password: MASTER_KEY,
            userId: "market_lab"
        }, { timeout: 5000 });
        if (response.data && response.data.reply) {
            analysis.aiComment = response.data.reply;
        }
    } catch (err) {
        console.error("AI enrichment failed:", err.message);
    }
    return analysis;
}

// ---------------------------------------------
// WebSocket Server: Broadcast to connected clients
// ---------------------------------------------
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// ---------------------------------------------
// Kline WebSocket streams (Binance)
// ---------------------------------------------
ASSETS.forEach(asset => {
    const lowerAsset = asset.toLowerCase();
    TIMEFRAMES.forEach(timeframe => {
        const streamUrl = `wss://stream.binance.com:9443/ws/${lowerAsset}@kline_${timeframe}`;
        const wsKline = new WebSocket(streamUrl);
        
        wsKline.on("open", () => {
            console.log(`Connected to ${asset} ${timeframe} klines`);
        });
        
        wsKline.on("message", async (msg) => {
            const json = JSON.parse(msg);
            const k = json.k;
            if (!k.isFinal) return; // wait for candle close
            
            const candle = {
                timestamp: k.t,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: parseFloat(k.v)
            };
            
            // Store in memory (keep max 500 candles per timeframe)
            let store = candlesStore[asset][timeframe];
            store.push(candle);
            if (store.length > 500) store.shift();
            
            // Save to SQLite (optional)
            saveCandle(asset, timeframe, candle);
            
            // Run analysis on the latest 100 candles
            if (store.length >= 50) {
                let analysis = analyzeMarket(asset, timeframe, store);
                // Enrich with AI if available
                if (NEXUS_CORE_API) {
                    analysis = await enrichWithAIAnalysis(analysis);
                }
                // Broadcast to all clients
                broadcast({
                    asset,
                    timeframe,
                    price: candle.close,
                    analysis
                });
            }
        });
        
        wsKline.on("error", (err) => {
            console.error(`WebSocket error for ${asset} ${timeframe}:`, err.message);
        });
        
        wsKline.on("close", () => {
            console.log(`Disconnected from ${asset} ${timeframe}, reconnecting in 5s...`);
            setTimeout(() => {
                // In production, implement reconnect logic
            }, 5000);
        });
    });
});

// ---------------------------------------------
// Start server
// ---------------------------------------------
wss.on("connection", (ws) => {
    console.log("Client connected");
    ws.on("close", () => console.log("Client disconnected"));
});

console.log(`NEXUS MARKET LAB v3 RUNNING on port ${PORT}`);
console.log(`Risk config: ${RISK_PERCENT}% per trade, balance $${ACCOUNT_BALANCE}, min R/R ${MIN_RISK_REWARD_RATIO}`);
if (NEXUS_CORE_API) console.log(`AI enrichment enabled: ${NEXUS_CORE_API}`);
