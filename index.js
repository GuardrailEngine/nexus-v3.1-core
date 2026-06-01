// NEXUS v3.5 PRO — Live Market Analysis
import { analyze } from './engine/analyzer.js';

// === عناصر DOM ===
const symbolSelect = document.getElementById('symbolSelect');
const intervalSelect = document.getElementById('intervalSelect');
const balanceInput = document.getElementById('balanceInput');
const riskInput = document.getElementById('riskInput');
const refreshBtn = document.getElementById('refreshBtn');
const audioToggleBtn = document.getElementById('audioToggleBtn');
const livePriceEl = document.getElementById('livePrice');
const priceChangeEl = document.getElementById('priceChange');
const bidPriceEl = document.getElementById('bidPrice');
const askPriceEl = document.getElementById('askPrice');
const volume24hEl = document.getElementById('volume24h');
const analysisGrid = document.getElementById('analysisGrid');
const candleCanvas = document.getElementById('candleCanvas');

// === حالة التطبيق ===
let currentCandles = [];
let currentPrice = 0;
let lastAnalysis = null;
let audioEnabled = false;
let audioInterval = null;
let liveUpdateInterval = null;
let symbol = 'BTCUSDT';
let interval = '1h';
let balance = 10000;
let riskPercent = 2;
let isUpdating = false;

// === تحديث الإعدادات ===
function updateSettings() {
  symbol = symbolSelect.value;
  interval = intervalSelect.value;
  balance = parseFloat(balanceInput.value);
  riskPercent = parseFloat(riskInput.value);
}

// === جلب البيانات من Binance ===
async function fetchCandles(limit = 100) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Binance error');
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
  const data = await res.json();
  return {
    price: parseFloat(data.lastPrice),
    bid: parseFloat(data.bidPrice),
    ask: parseFloat(data.askPrice),
    volume: parseFloat(data.volume),
    changePercent: parseFloat(data.priceChangePercent)
  };
}

// === رسم الشموع ===
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
  const range = maxPrice - minPrice;
  const yScale = (price) => h - ((price - minPrice) / range) * h;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#010a12';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < count; i++) {
    const c = currentCandles[i];
    const x = i * (candleWidth + spacing);
    const isGreen = c.close >= c.open;
    ctx.fillStyle = isGreen ? '#00e676' : '#ff3d5a';
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

// === عرض التحليل ===
function displayAnalysis(analysis) {
  const signalClass = analysis.signal.includes('BUY') ? 'BUY' : (analysis.signal.includes('SELL') ? 'SELL' : 'NEUTRAL');
  analysisGrid.innerHTML = `
    <div class="analysis-card glass">
      <div class="stat-label">التوصية</div>
      <div class="signal-badge ${signalClass}">${analysis.signal}</div>
      <div class="reason" style="font-size:0.8rem; color:#9ab0c0;">${analysis.reason.substring(0, 120)}...</div>
    </div>
    <div class="analysis-card glass">
      <div class="stat-label">الاتجاه</div>
      <div class="stat-value">${analysis.trend}</div>
      <div class="stat-label" style="margin-top:12px;">RSI (14)</div>
      <div class="stat-value">${analysis.rsi.toFixed(1)}</div>
    </div>
    <div class="analysis-card glass">
      <div class="stat-label">وقف الخسارة</div>
      <div class="stat-value">${analysis.stopLoss ? '$'+analysis.stopLoss.toFixed(2) : '-'}</div>
      <div class="stat-label" style="margin-top:12px;">جني الأرباح</div>
      <div class="stat-value">${analysis.takeProfit ? '$'+analysis.takeProfit.toFixed(2) : '-'}</div>
    </div>
    <div class="analysis-card glass">
      <div class="stat-label">حجم العقد</div>
      <div class="stat-value">${analysis.positionSize}</div>
      <div class="stat-label" style="margin-top:12px;">ATR</div>
      <div class="stat-value">$${analysis.atr.toFixed(2)}</div>
    </div>
  `;
}

// === تحديث البيانات الحية ===
async function refreshLiveData() {
  if (isUpdating) return;
  isUpdating = true;
  try {
    updateSettings();
    const [candles, ticker] = await Promise.all([fetchCandles(100), fetchTicker()]);
    currentCandles = candles;
    currentPrice = ticker.price;
    drawCandles();

    // تحديث الأرقام الحية
    livePriceEl.innerText = `$${ticker.price.toFixed(2)}`;
    bidPriceEl.innerText = `$${ticker.bid.toFixed(2)}`;
    askPriceEl.innerText = `$${ticker.ask.toFixed(2)}`;
    volume24hEl.innerText = ticker.volume.toLocaleString();
    const changeClass = ticker.changePercent >= 0 ? 'positive' : 'negative';
    const changeSymbol = ticker.changePercent >= 0 ? '▲' : '▼';
    priceChangeEl.innerHTML = `<span class="${changeClass}">${changeSymbol} ${Math.abs(ticker.changePercent).toFixed(2)}%</span>`;

    // تحليل جديد
    const prices = currentCandles.map(c => c.close);
    const riskConfig = { balance, riskPercent, riskReward: 2 };
    const analysis = analyze(prices, currentPrice, symbol, currentCandles, riskConfig);
    lastAnalysis = analysis;
    displayAnalysis(analysis);

    // صوت عند تغيير الإشارة (يمكن مقارنتها مع الإشارة السابقة، لكن هنا نبسطها)
    if (audioEnabled && analysis.signal !== 'NEUTRAL') {
      speakRecommendation(analysis);
    }
  } catch (err) {
    console.error(err);
    livePriceEl.innerText = 'خطأ';
  } finally {
    isUpdating = false;
  }
}

// === صوت التوصية ===
function speakRecommendation(analysis) {
  if (!audioEnabled) return;
  const msg = `توصية ${analysis.signal} لزوج ${analysis.asset} السعر ${analysis.price.toFixed(2)} دولار. وقف الخسارة ${analysis.stopLoss?.toFixed(2)} وجني الأرباح ${analysis.takeProfit?.toFixed(2)}. ${analysis.reason.substring(0, 100)}`;
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
  audioToggleBtn.textContent = audioEnabled ? "🔊 إيقاف الصوت" : "🔇 تشغيل الصوت";
  if (audioEnabled && !audioInterval) startAudioLoop();
  else if (!audioEnabled && audioInterval) {
    clearInterval(audioInterval);
    audioInterval = null;
  }
  if (audioEnabled && lastAnalysis && lastAnalysis.signal !== 'NEUTRAL') speakRecommendation(lastAnalysis);
}

// === تحديث تلقائي كل 5 ثوانٍ ===
function startLiveUpdates() {
  if (liveUpdateInterval) clearInterval(liveUpdateInterval);
  refreshLiveData();
  liveUpdateInterval = setInterval(() => {
    refreshLiveData();
  }, 5000);
}

// === ربط الأحداث ===
refreshBtn.addEventListener('click', () => refreshLiveData());
audioToggleBtn.addEventListener('click', toggleAudio);
symbolSelect.addEventListener('change', () => { refreshLiveData(); });
intervalSelect.addEventListener('change', () => { refreshLiveData(); });
balanceInput.addEventListener('change', () => { updateSettings(); if(currentCandles.length) refreshLiveData(); });
riskInput.addEventListener('change', () => { updateSettings(); if(currentCandles.length) refreshLiveData(); });

// === الساعة الحية ===
function updateClock() {
  const now = new Date();
  document.getElementById('liveTime').innerText = now.toLocaleTimeString('ar-EG');
}
setInterval(updateClock, 1000);
updateClock();

// === بدء التشغيل ===
startLiveUpdates();
