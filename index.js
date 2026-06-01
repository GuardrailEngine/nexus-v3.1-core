// NEXUS v3.5 — Frontend Controller (ES Module version)
import { analyze } from './engine/analyzer.js';

let currentCandles = [];
let currentPrice = 0;
let lastAnalysis = null;
let audioEnabled = false;
let audioInterval = null;
let symbol = 'BTCUSDT';
let interval = '1h';
let balance = 10000;
let riskPercent = 2;

// عناصر DOM
const symbolSelect = document.getElementById('symbolSelect');
const intervalSelect = document.getElementById('intervalSelect');
const balanceInput = document.getElementById('balanceInput');
const riskInput = document.getElementById('riskInput');
const refreshBtn = document.getElementById('refreshBtn');
const audioToggleBtn = document.getElementById('audioToggleBtn');
const metricsPanel = document.getElementById('metricsPanel');
const candleCanvas = document.getElementById('candleCanvas');

// تحديث المتغيرات من واجهة المستخدم
function updateSettings() {
  symbol = symbolSelect.value;
  interval = intervalSelect.value;
  balance = parseFloat(balanceInput.value);
  riskPercent = parseFloat(riskInput.value);
}

// جلب بيانات الشموع من Binance
async function fetchCandles() {
  updateSettings();
  const limit = 100;
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Binance error');
    const candles = data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
    currentCandles = candles;
    currentPrice = candles[candles.length-1].close;
    drawCandles();
    runAnalysis();
  } catch (err) {
    console.error(err);
    metricsPanel.innerHTML = `<div class="card">❌ فشل جلب البيانات: ${err.message}</div>`;
  }
}

// رسم الشموع (بسيط باستخدام Canvas)
function drawCandles() {
  if (!currentCandles.length) return;
  const ctx = candleCanvas.getContext('2d');
  const w = candleCanvas.clientWidth;
  const h = candleCanvas.clientHeight;
  candleCanvas.width = w;
  candleCanvas.height = h;
  const count = currentCandles.length;
  const candleWidth = w / count * 0.8;
  const spacing = w / count * 0.2;
  const allPrices = currentCandles.flatMap(c => [c.high, c.low]);
  const maxPrice = Math.max(...allPrices);
  const minPrice = Math.min(...allPrices);
  const priceRange = maxPrice - minPrice;
  const yScale = (price) => h - ((price - minPrice) / priceRange) * h;

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#030a12';
  ctx.fillRect(0,0,w,h);
  for (let i=0; i<count; i++) {
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
    ctx.fillRect(x, bodyTop, candleWidth, bodyHeight || 1);
    ctx.strokeStyle = '#9ab0c0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + candleWidth/2, highY);
    ctx.lineTo(x + candleWidth/2, lowY);
    ctx.stroke();
  }
}

// تشغيل التحليل وعرض النتائج
async function runAnalysis() {
  if (!currentCandles.length) return;
  const prices = currentCandles.map(c => c.close);
  const riskConfig = { balance, riskPercent, riskReward: 2 };
  const analysis = analyze(prices, currentPrice, symbol, currentCandles, riskConfig);
  lastAnalysis = analysis;
  displayAnalysis(analysis);
  if (audioEnabled && analysis.signal !== 'NEUTRAL') {
    speakRecommendation(analysis);
  }
}

function displayAnalysis(analysis) {
  const signalClass = analysis.signal.includes('BUY') ? 'BUY' : (analysis.signal.includes('SELL') ? 'SELL' : 'NEUTRAL');
  const html = `
    <div class="card">
      <div class="card-label">السعر الحالي</div>
      <div class="card-value">$${analysis.price.toFixed(2)}</div>
    </div>
    <div class="card">
      <div class="card-label">التوصية</div>
      <div class="card-value signal ${signalClass}">${analysis.signal}</div>
      <div class="reason">${analysis.reason.substring(0,100)}...</div>
    </div>
    <div class="card">
      <div class="card-label">الاتجاه</div>
      <div class="card-value">${analysis.trend}</div>
    </div>
    <div class="card">
      <div class="card-label">RSI (14)</div>
      <div class="card-value">${analysis.rsi.toFixed(1)}</div>
    </div>
    <div class="card">
      <div class="card-label">ATR</div>
      <div class="card-value">$${analysis.atr.toFixed(2)}</div>
    </div>
    <div class="card">
      <div class="card-label">وقف الخسارة</div>
      <div class="card-value">${analysis.stopLoss ? '$'+analysis.stopLoss.toFixed(2) : '-'}</div>
    </div>
    <div class="card">
      <div class="card-label">جني الأرباح</div>
      <div class="card-value">${analysis.takeProfit ? '$'+analysis.takeProfit.toFixed(2) : '-'}</div>
    </div>
    <div class="card">
      <div class="card-label">حجم العقد</div>
      <div class="card-value">${analysis.positionSize}</div>
    </div>
  `;
  metricsPanel.innerHTML = html;
}

function speakRecommendation(analysis) {
  if (!audioEnabled) return;
  const msg = `توصية ${analysis.signal} لزوج ${analysis.asset} السعر ${analysis.price} دولار. وقف الخسارة ${analysis.stopLoss?.toFixed(2)} وجني الأرباح ${analysis.takeProfit?.toFixed(2)}. السبب: ${analysis.reason.substring(0,150)}`;
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

// أحداث
refreshBtn.addEventListener('click', () => fetchCandles());
audioToggleBtn.addEventListener('click', toggleAudio);
symbolSelect.addEventListener('change', () => fetchCandles());
intervalSelect.addEventListener('change', () => fetchCandles());
balanceInput.addEventListener('change', () => { updateSettings(); if(currentCandles.length) runAnalysis(); });
riskInput.addEventListener('change', () => { updateSettings(); if(currentCandles.length) runAnalysis(); });

// بدء التشغيل
fetchCandles();
startAudioLoop();
