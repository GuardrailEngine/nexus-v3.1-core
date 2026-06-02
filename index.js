// index.js - NEXUS PRO v4.0 Frontend Controller
import { analyze } from './engine/analyzer.js';

// ========== DOM Elements ==========
const pairTabs = document.querySelectorAll('.pair-tab');
const intervalBtns = document.querySelectorAll('.int-btn');
const balanceInput = document.getElementById('balanceInput');
const riskInput = document.getElementById('riskInput');
const refreshBtn = document.getElementById('refreshBtn');
const audioToggleBtn = document.getElementById('audioToggleBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportTxtBtn = document.getElementById('exportTxtBtn');
const copyBtn = document.getElementById('copyBtn');
const themeBtn = document.getElementById('themeBtn');
const livePriceEl = document.getElementById('livePriceEl');
const priceChangeSpan = document.getElementById('priceChange');
const bidPriceEl = document.getElementById('bidPriceEl');
const askPriceEl = document.getElementById('askPriceEl');
const volume24hEl = document.getElementById('volume24hEl');
const volBar = document.getElementById('volBar');
const priceSymbolSpan = document.getElementById('priceSymbol');
const pricePairSpan = document.getElementById('pricePair');
const signalNameSpan = document.getElementById('signalName');
const signalArSpan = document.getElementById('signalAr');
const confBar = document.getElementById('confBar');
const confPctSpan = document.getElementById('confPct');
const signalDescSpan = document.getElementById('signalDesc');
const slValSpan = document.getElementById('slVal');
const tpValSpan = document.getElementById('tpVal');
const posValSpan = document.getElementById('posVal');
const atrValSpan = document.getElementById('atrVal');
const signalTimeSpan = document.getElementById('signalTime');
const rsiValueSpan = document.getElementById('rsiValue');
const rsiNeedle = document.getElementById('rsiNeedle');
const rsiTrack = document.getElementById('rsiTrack');
const rsiValueDisplay = document.getElementById('rsiValueDisplay'); // قد يكون هناك عنصر آخر
const macdValSpan = document.getElementById('macdVal');
const macdSignalSpan = document.getElementById('macdSignal');
const macdHistSpan = document.getElementById('macdHist');
const bbUpperSpan = document.getElementById('bbUpper');
const bbMiddleSpan = document.getElementById('bbMiddle');
const bbLowerSpan = document.getElementById('bbLower');
const emaCrossSpan = document.getElementById('emaCross');
const candleCanvas = document.getElementById('candleCanvas');

// ========== State ==========
let currentCandles = [];
let currentPrice = 0;
let lastAnalysis = null;
let audioEnabled = false;
let audioInterval = null;
let liveUpdateInterval = null;
let symbol = 'BTCUSDT';      // default
let interval = '1h';         // default
let balance = 100;
let riskPercent = 2;
let isUpdating = false;

// Symbols mapping (symbol, display symbol, pair name)
const symbols = {
    BTCUSDT: { sym: '₿', name: 'BTC/USDT' },
    ETHUSDT: { sym: 'Ξ', name: 'ETH/USDT' },
    SOLUSDT: { sym: '◎', name: 'SOL/USDT' },
    BNBUSDT: { sym: '⬡', name: 'BNB/USDT' },
    PAXGUSDT: { sym: '🥇', name: 'PAXG/USDT' }
};

// ========== Helper Functions ==========
function updatePairUI() {
    const s = symbols[symbol];
    priceSymbolSpan.textContent = s.sym;
    pricePairSpan.textContent = s.name;
    document.querySelectorAll('.pair-tab').forEach(tab => {
        if (tab.dataset.pair === symbol) tab.classList.add('active');
        else tab.classList.remove('active');
    });
}

function updateIntervalUI() {
    document.querySelectorAll('.int-btn').forEach(btn => {
        if (btn.dataset.int === interval) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

function updateSettings() {
    // symbol is set via pair tabs
    // interval set via interval buttons
    balance = parseFloat(balanceInput.value) || 100;
    riskPercent = parseFloat(riskInput.value) || 2;
    // save to localStorage
    localStorage.setItem('nexus_symbol', symbol);
    localStorage.setItem('nexus_interval', interval);
    localStorage.setItem('nexus_balance', balance);
    localStorage.setItem('nexus_risk', riskPercent);
}

function loadSettings() {
    const savedSymbol = localStorage.getItem('nexus_symbol');
    if (savedSymbol && symbols[savedSymbol]) symbol = savedSymbol;
    const savedInterval = localStorage.getItem('nexus_interval');
    if (savedInterval) interval = savedInterval;
    balance = parseFloat(localStorage.getItem('nexus_balance')) || 100;
    riskPercent = parseFloat(localStorage.getItem('nexus_risk')) || 2;
    balanceInput.value = balance;
    riskInput.value = riskPercent;
    updatePairUI();
    updateIntervalUI();
}

// ========== Binance API ==========
async function fetchCandles(limit = 100) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
    }));
}

async function fetchTicker() {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ticker ${res.status}`);
    const data = await res.json();
    return {
        price: parseFloat(data.lastPrice),
        bid: data.bidPrice ? parseFloat(data.bidPrice) : null,
        ask: data.askPrice ? parseFloat(data.askPrice) : null,
        volume: parseFloat(data.volume),
        changePercent: parseFloat(data.priceChangePercent)
    };
}

// ========== Drawing ==========
function drawCandles() {
    if (!currentCandles.length) return;
    const ctx = candleCanvas.getContext('2d');
    const w = candleCanvas.clientWidth;
    const h = candleCanvas.clientHeight;
    candleCanvas.width = w;
    candleCanvas.height = h;
    const count = currentCandles.length;
    const candleWidth = Math.max(2, w / count * 0.7);
    const spacing = w / count * 0.3;
    const allPrices = currentCandles.flatMap(c => [c.high, c.low]);
    const maxPrice = Math.max(...allPrices);
    const minPrice = Math.min(...allPrices);
    const range = maxPrice - minPrice || 1;
    const yScale = (price) => h - ((price - minPrice) / range) * h;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#010a12';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < count; i++) {
        const c = currentCandles[i];
        const x = i * (candleWidth + spacing);
        const isGreen = c.close >= c.open;
        ctx.fillStyle = isGreen ? '#00ff88' : '#ff3366';
        const openY = yScale(c.open);
        const closeY = yScale(c.close);
        const highY = yScale(c.high);
        const lowY = yScale(c.low);
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.abs(closeY - openY);
        ctx.fillRect(x, bodyTop, candleWidth, Math.max(1, bodyHeight));
        ctx.strokeStyle = '#9ab0c0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + candleWidth/2, highY);
        ctx.lineTo(x + candleWidth/2, lowY);
        ctx.stroke();
    }
}

// ========== Update UI ==========
function updatePriceUI(ticker) {
    livePriceEl.innerText = `$${ticker.price.toFixed(2)}`;
    bidPriceEl.innerText = ticker.bid !== null ? `$${ticker.bid.toFixed(2)}` : '--';
    askPriceEl.innerText = ticker.ask !== null ? `$${ticker.ask.toFixed(2)}` : '--';
    volume24hEl.innerText = ticker.volume.toLocaleString();
    const changeClass = ticker.changePercent >= 0 ? 'up' : 'down';
    const changeSymbol = ticker.changePercent >= 0 ? '▲' : '▼';
    priceChangeSpan.innerHTML = `${changeSymbol} ${Math.abs(ticker.changePercent).toFixed(2)}%`;
    priceChangeSpan.className = `price-change ${changeClass}`;
    // volume bar (rough estimate: max volume known around 50k BTC, adjust)
    let volPercent = Math.min(100, (ticker.volume / 50000) * 100);
    if (symbol === 'ETHUSDT') volPercent = Math.min(100, (ticker.volume / 300000) * 100);
    if (symbol === 'SOLUSDT') volPercent = Math.min(100, (ticker.volume / 2000000) * 100);
    if (symbol === 'BNBUSDT') volPercent = Math.min(100, (ticker.volume / 100000) * 100);
    if (symbol === 'PAXGUSDT') volPercent = Math.min(100, (ticker.volume / 1000) * 100);
    volBar.style.width = `${volPercent}%`;
}

function updateSignalUI(analysis) {
    // Update signal card
    const signal = analysis.signal;
    let signalClass = 'neut';
    let signalText = 'NEUTRAL';
    let signalAr = 'محايد';
    if (signal.includes('BUY')) { signalClass = 'bull'; signalText = 'BUY'; signalAr = 'شراء'; }
    else if (signal.includes('SELL')) { signalClass = 'bear'; signalText = 'SELL'; signalAr = 'بيع'; }
    const card = document.getElementById('signalCard');
    card.className = `signal-card ${signalClass}`;
    signalNameSpan.textContent = signalText;
    signalArSpan.textContent = signalAr;
    // Confidence (score based)
    let conf = Math.min(100, Math.abs(analysis.score) * 10 + 30);
    confBar.style.width = `${conf}%`;
    confPctSpan.textContent = `${Math.round(conf)}%`;
    signalDescSpan.textContent = analysis.reason.substring(0, 140);
    // Metrics
    slValSpan.textContent = analysis.stopLoss ? `$${analysis.stopLoss.toFixed(2)}` : '--';
    tpValSpan.textContent = analysis.takeProfit ? `$${analysis.takeProfit.toFixed(2)}` : '--';
    posValSpan.textContent = analysis.positionSize;
    atrValSpan.textContent = `$${analysis.atr.toFixed(2)}`;
    // RSI
    const rsi = analysis.rsi;
    rsiValueSpan.textContent = rsi.toFixed(1);
    if (rsiValueDisplay) rsiValueDisplay.textContent = rsi.toFixed(1);
    const rsiLeftPercent = Math.min(100, Math.max(0, (rsi / 100) * 100));
    if (rsiNeedle && rsiTrack) {
        const trackRect = rsiTrack.getBoundingClientRect();
        const containerRect = rsiTrack.parentElement?.getBoundingClientRect();
        // simpler: set left percentage
        rsiNeedle.style.left = `${rsiLeftPercent}%`;
    }
    // MACD
    if (macdValSpan) macdValSpan.textContent = analysis.macd?.toFixed(4) || '--';
    if (macdSignalSpan) macdSignalSpan.textContent = analysis.macdSignal?.toFixed(4) || '--';
    if (macdHistSpan) macdHistSpan.textContent = analysis.macdHistogram?.toFixed(4) || '--';
    // Bollinger
    if (bbUpperSpan) bbUpperSpan.textContent = analysis.bbUpper ? `$${analysis.bbUpper.toFixed(2)}` : '--';
    if (bbMiddleSpan) bbMiddleSpan.textContent = analysis.bbUpper ? `$${((analysis.bbUpper + analysis.bbLower)/2).toFixed(2)}` : '--';
    if (bbLowerSpan) bbLowerSpan.textContent = analysis.bbLower ? `$${analysis.bbLower.toFixed(2)}` : '--';
    // EMA Crossover
    if (emaCrossSpan) {
        let crossText = analysis.emaCross || '--';
        if (crossText === 'ABOVE') crossText = 'EMA9 فوق EMA21 (صاعد)';
        else if (crossText === 'BELOW') crossText = 'EMA9 تحت EMA21 (هابط)';
        emaCrossSpan.textContent = crossText;
    }
    // Signal time
    const now = new Date();
    signalTimeSpan.textContent = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

// ========== Data Refresh ==========
async function refreshLiveData() {
    if (isUpdating) return;
    isUpdating = true;
    const oldPrice = currentPrice;
    try {
        updateSettings();
        const [candles, ticker] = await Promise.all([fetchCandles(100), fetchTicker()]);
        currentCandles = candles;
        currentPrice = ticker.price;
        drawCandles();
        updatePriceUI(ticker);
        const prices = currentCandles.map(c => c.close);
        const riskConfig = { balance, riskPercent, riskReward: 2 };
        const analysis = analyze(prices, currentPrice, symbol, currentCandles, riskConfig);
        lastAnalysis = analysis;
        updateSignalUI(analysis);
        // Price flash
        if (oldPrice && ticker.price !== oldPrice) {
            const priceEl = livePriceEl;
            priceEl.classList.add(ticker.price > oldPrice ? 'flash-up' : 'flash-dn');
            setTimeout(() => priceEl.classList.remove('flash-up', 'flash-dn'), 300);
        }
        if (audioEnabled && analysis.signal !== 'NEUTRAL') {
            speakRecommendation(analysis);
        }
    } catch (err) {
        console.error(err);
        livePriceEl.innerText = 'خطأ';
        document.getElementById('errorBanner')?.classList.add('show');
        setTimeout(() => document.getElementById('errorBanner')?.classList.remove('show'), 3000);
    } finally {
        isUpdating = false;
    }
}

// ========== Speech ==========
function speakRecommendation(analysis) {
    if (!audioEnabled) return;
    const msg = `توصية ${analysis.signal} لزوج ${analysis.asset} السعر ${analysis.price.toFixed(2)} دولار. وقف الخسارة ${analysis.stopLoss?.toFixed(2)} وجني الأرباح ${analysis.takeProfit?.toFixed(2)}. ${analysis.reason.substring(0, 120)}`;
    const utterance = new SpeechSynthesisUtterance(msg);
    utterance.lang = 'ar-SA';
    utterance.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
}

function startAudioLoop() {
    if (audioInterval) clearInterval(audioInterval);
    audioInterval = setInterval(() => {
        if (audioEnabled && lastAnalysis && lastAnalysis.signal !== 'NEUTRAL') {
            speakRecommendation(lastAnalysis);
        }
    }, 30000);
}

function toggleAudio() {
    audioEnabled = !audioEnabled;
    audioToggleBtn.textContent = audioEnabled ? "🔊" : "🔇";
    if (audioEnabled && !audioInterval) startAudioLoop();
    else if (!audioEnabled && audioInterval) {
        clearInterval(audioInterval);
        audioInterval = null;
    }
    if (audioEnabled && lastAnalysis && lastAnalysis.signal !== 'NEUTRAL') speakRecommendation(lastAnalysis);
}

// ========== Theme ==========
function toggleTheme() {
    const isDark = document.body.classList.contains('light');
    if (isDark) {
        document.body.classList.remove('light');
        document.body.classList.add('dark');
        themeBtn.textContent = '☀️';
        localStorage.setItem('nexus_theme', 'dark');
    } else {
        document.body.classList.remove('dark');
        document.body.classList.add('light');
        themeBtn.textContent = '🌙';
        localStorage.setItem('nexus_theme', 'light');
    }
}

function loadTheme() {
    const savedTheme = localStorage.getItem('nexus_theme');
    if (savedTheme === 'light') {
        document.body.classList.remove('dark');
        document.body.classList.add('light');
        themeBtn.textContent = '🌙';
    } else {
        document.body.classList.remove('light');
        document.body.classList.add('dark');
        themeBtn.textContent = '☀️';
    }
}

// ========== Auto Refresh Timer ==========
let autoRefreshInterval = null;
function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    refreshLiveData();
    autoRefreshInterval = setInterval(() => {
        refreshLiveData();
    }, 5000);
    const timerSpan = document.getElementById('refreshTimer');
    if (timerSpan) timerSpan.textContent = 'AUTO 5s';
}

// ========== Export ==========
async function exportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFont('helvetica');
    doc.text('NEXUS PRO v4.0 - Trading Signal Report', 20, 20);
    doc.text(`Pair: ${symbol}`, 20, 30);
    doc.text(`Price: $${currentPrice.toFixed(2)}`, 20, 40);
    if (lastAnalysis) {
        doc.text(`Signal: ${lastAnalysis.signal}`, 20, 50);
        doc.text(`RSI: ${lastAnalysis.rsi.toFixed(1)}`, 20, 60);
        doc.text(`Stop Loss: ${lastAnalysis.stopLoss?.toFixed(2) || 'N/A'}`, 20, 70);
        doc.text(`Take Profit: ${lastAnalysis.takeProfit?.toFixed(2) || 'N/A'}`, 20, 80);
        doc.text(`Position Size: ${lastAnalysis.positionSize}`, 20, 90);
        doc.text(`Reason: ${lastAnalysis.reason.substring(0, 200)}`, 20, 100);
    }
    doc.save(`nexus_signal_${symbol}_${Date.now()}.pdf`);
}

function exportToTxt() {
    let content = `NEXUS PRO v4.0 - Signal Report\n`;
    content += `========================\n`;
    content += `Pair: ${symbol}\n`;
    content += `Price: $${currentPrice.toFixed(2)}\n`;
    if (lastAnalysis) {
        content += `Signal: ${lastAnalysis.signal}\n`;
        content += `RSI: ${lastAnalysis.rsi.toFixed(1)}\n`;
        content += `Stop Loss: ${lastAnalysis.stopLoss?.toFixed(2) || 'N/A'}\n`;
        content += `Take Profit: ${lastAnalysis.takeProfit?.toFixed(2) || 'N/A'}\n`;
        content += `Position Size: ${lastAnalysis.positionSize}\n`;
        content += `ATR: $${lastAnalysis.atr.toFixed(2)}\n`;
        content += `Reason: ${lastAnalysis.reason}\n`;
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus_signal_${symbol}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function copyToClipboard() {
    let text = `NEXUS PRO Signal (${symbol}) - $${currentPrice.toFixed(2)} | `;
    if (lastAnalysis) {
        text += `${lastAnalysis.signal} | SL: ${lastAnalysis.stopLoss?.toFixed(2)} | TP: ${lastAnalysis.takeProfit?.toFixed(2)} | ${lastAnalysis.reason}`;
    }
    navigator.clipboard.writeText(text);
    const toast = document.createElement('div');
    toast.className = 'toast show';
    toast.textContent = '✅ تم نسخ التوصية!';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

// ========== Event Listeners ==========
pairTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        symbol = tab.dataset.pair;
        updatePairUI();
        updateSettings();
        refreshLiveData();
    });
});
intervalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        interval = btn.dataset.int;
        updateIntervalUI();
        updateSettings();
        refreshLiveData();
    });
});
refreshBtn.addEventListener('click', () => refreshLiveData());
audioToggleBtn.addEventListener('click', toggleAudio);
themeBtn.addEventListener('click', toggleTheme);
if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportToPDF);
if (exportTxtBtn) exportTxtBtn.addEventListener('click', exportToTxt);
if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
balanceInput.addEventListener('change', () => { updateSettings(); refreshLiveData(); });
riskInput.addEventListener('change', () => { updateSettings(); refreshLiveData(); });

// ========== Clock ==========
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ar-EG');
    const clockEl = document.getElementById('liveTime');
    if (clockEl) clockEl.textContent = timeStr;
}
setInterval(updateClock, 1000);
updateClock();

// ========== Initialize ==========
function init() {
    loadSettings();
    loadTheme();
    startAutoRefresh();
}
init();
