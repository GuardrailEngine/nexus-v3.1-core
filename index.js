// ===================== NEXUS PRO v4.1 - Enhanced Frontend (All-in-One) =====================
// (بدون الحاجة إلى analyzer.js – كل التحليل مدمج هنا)

// =========================== المؤشرات الأساسية ===========================
function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcStochasticRSI(prices, rsiPeriod = 14, stochPeriod = 14) {
  // حساب RSI لقيم كافية
  const rsiValues = [];
  for (let i = rsiPeriod; i < prices.length; i++) {
    const rsi = calcRSI(prices.slice(0, i + 1), rsiPeriod);
    if (rsi !== null) rsiValues.push(rsi);
  }
  if (rsiValues.length < stochPeriod) return null;
  const lastRSIs = rsiValues.slice(-stochPeriod);
  const max = Math.max(...lastRSIs);
  const min = Math.min(...lastRSIs);
  const current = rsiValues[rsiValues.length - 1];
  const stoch = (current - min) / (max - min) * 100;
  return Math.min(100, Math.max(0, stoch));
}

function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return null;
  const emaFast = calcEMA(prices, fast);
  const emaSlow = calcEMA(prices, slow);
  if (emaFast === null || emaSlow === null) return null;
  const macdLine = emaFast - emaSlow;
  const macdValues = [];
  for (let i = prices.length - signal; i < prices.length; i++) {
    const f = calcEMA(prices.slice(0, i + 1), fast);
    const s = calcEMA(prices.slice(0, i + 1), slow);
    if (f !== null && s !== null) macdValues.push(f - s);
  }
  const signalLine = macdValues.length ? macdValues.reduce((a, b) => a + b, 0) / macdValues.length : macdLine;
  const histogram = macdLine - signalLine;
  return { macd: macdLine, signal: signalLine, histogram };
}

function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) atr = (atr * (period - 1) + tr[i]) / period;
  return atr;
}

function calcBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + stdDev * std, middle, lower: middle - stdDev * std };
}

function findSupportResistance(prices, lookback = 20) {
  if (prices.length < lookback) return { support: null, resistance: null };
  const slice = prices.slice(-lookback);
  return { support: Math.min(...slice), resistance: Math.max(...slice) };
}

function computePositionSize(entryPrice, stopLossPrice, accountBalance = 100, riskPercent = 2) {
  const riskAmount = accountBalance * (riskPercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  if (riskPerUnit === 0) return 0;
  return riskAmount / riskPerUnit;
}

function computeStopLoss(currentPrice, atr, direction = "long", multiplier = 2) {
  if (direction === "long") return currentPrice - (multiplier * atr);
  else return currentPrice + (multiplier * atr);
}

function computeTakeProfit(entryPrice, stopLoss, riskRewardRatio = 2, direction = "long") {
  const risk = Math.abs(entryPrice - stopLoss);
  if (direction === "long") return entryPrice + (risk * riskRewardRatio);
  else return entryPrice - (risk * riskRewardRatio);
}

function detectEMACrossover(prices, fast = 9, slow = 21) {
  const emaFast = calcEMA(prices, fast);
  const emaSlow = calcEMA(prices, slow);
  if (!emaFast || !emaSlow) return null;
  const prevFast = calcEMA(prices.slice(0, -1), fast);
  const prevSlow = calcEMA(prices.slice(0, -1), slow);
  if (prevFast === null || prevSlow === null) return null;
  if (emaFast > emaSlow && prevFast <= prevSlow) return "Golden Cross (↑)";
  if (emaFast < emaSlow && prevFast >= prevSlow) return "Death Cross (↓)";
  return emaFast > emaSlow ? "EMA9 فوق EMA21" : "EMA9 تحت EMA21";
}

// ================== التحليل المتقدم ==================
function advancedAnalysis(prices, currentPrice, asset, candles = null, riskConfig = {}) {
  const accountBalance = riskConfig.balance || 100;
  const riskPercent = riskConfig.riskPercent || 2;
  const riskRewardRatio = riskConfig.riskReward || 2;

  // حساب المؤشرات
  const rsi = calcRSI(prices, 14);
  const macd = calcMACD(prices);
  const bb = calcBollingerBands(prices, 20, 2);
  const stochRSI = calcStochasticRSI(prices, 14, 14);
  const ema9 = calcEMA(prices, 9);
  const ema21 = calcEMA(prices, 21);
  const ema50 = calcEMA(prices, 50);
  const { support, resistance } = findSupportResistance(prices, 20);
  let atr = null;
  if (candles && candles.length >= 10) atr = calcATR(candles, 14);
  
  // حجم التداول (إذا توفرت الشموع)
  let volumeSMA = null, lastVolume = null, volumeRatio = null;
  if (candles && candles.length >= 20) {
    const volumes = candles.map(c => c.volume);
    volumeSMA = calcSMA(volumes, 20);
    lastVolume = volumes[volumes.length - 1];
    if (volumeSMA && lastVolume) volumeRatio = lastVolume / volumeSMA;
  }

  // نظام التسجيل
  let score = 0;
  let details = [];

  // 1. RSI
  if (rsi !== null) {
    if (rsi < 30) { score += 3; details.push("RSI شديد البيع"); }
    else if (rsi < 40) { score += 1; details.push("RSI بيع خفيف"); }
    else if (rsi > 70) { score -= 3; details.push("RSI شديد الشراء"); }
    else if (rsi > 60) { score -= 1; details.push("RSI شراء خفيف"); }
  }

  // 2. MACD
  if (macd) {
    if (macd.macd > 0 && macd.histogram > 0) { score += 2; details.push("MACD إيجابي وقوي"); }
    else if (macd.macd > 0) { score += 1; details.push("MACD إيجابي"); }
    else if (macd.macd < 0 && macd.histogram < 0) { score -= 2; details.push("MACD سلبي وقوي"); }
    else if (macd.macd < 0) { score -= 1; details.push("MACD سلبي"); }
  }

  // 3. Bollinger Bands
  if (bb) {
    if (currentPrice < bb.lower) { score += 2; details.push("السعر تحت Bollinger Lower (ذروة بيع)"); }
    else if (currentPrice > bb.upper) { score -= 2; details.push("السعر فوق Bollinger Upper (ذروة شراء)"); }
    else if (currentPrice < bb.lower + (bb.upper - bb.lower) * 0.2) { score += 1; details.push("قرب من Bollinger Lower"); }
    else if (currentPrice > bb.upper - (bb.upper - bb.lower) * 0.2) { score -= 1; details.push("قرب من Bollinger Upper"); }
  }

  // 4. EMAs
  if (ema9 && ema21 && ema50) {
    if (ema9 > ema21 && ema21 > ema50) { score += 2; details.push("ترتيب EMAs صاعد"); }
    else if (ema9 < ema21 && ema21 < ema50) { score -= 2; details.push("ترتيب EMAs هابط"); }
    else if (ema9 > ema21) { score += 1; details.push("EMA9 فوق EMA21"); }
    else if (ema9 < ema21) { score -= 1; details.push("EMA9 تحت EMA21"); }
  }

  // 5. Stochastic RSI
  if (stochRSI !== null) {
    if (stochRSI < 20) { score += 2; details.push("StochRSI في منطقة ذروة البيع"); }
    else if (stochRSI > 80) { score -= 2; details.push("StochRSI في منطقة ذروة الشراء"); }
    else if (stochRSI < 30) { score += 1; details.push("StochRSI منخفض"); }
    else if (stochRSI > 70) { score -= 1; details.push("StochRSI مرتفع"); }
  }

  // 6. الدعم والمقاومة
  if (support && currentPrice < support * 1.02) { score += 1; details.push("قرب مستوى دعم"); }
  if (resistance && currentPrice > resistance * 0.98) { score -= 1; details.push("قرب مستوى مقاومة"); }

  // 7. حجم التداول (تأكيد)
  if (volumeRatio !== null) {
    if (volumeRatio > 1.5) {
      if (score > 0) score += 1; else if (score < 0) score -= 1;
      details.push(`حجم تداول مرتفع (${Math.round((volumeRatio-1)*100)}%)`);
    } else if (volumeRatio < 0.6) {
      if (score > 0) score -= 0.5; else if (score < 0) score += 0.5;
      details.push("حجم تداول منخفض");
    }
  }

  // تحديد الإشارة
  let signal = "NEUTRAL";
  if (score >= 4) signal = "STRONG_BUY";
  else if (score >= 2) signal = "BUY";
  else if (score <= -4) signal = "STRONG_SELL";
  else if (score <= -2) signal = "SELL";

  // اتجاه السوق
  let trend = "NEUTRAL";
  if (ema9 && ema21 && ema50) {
    if (ema9 > ema21 && ema21 > ema50) trend = "UP";
    else if (ema9 < ema21 && ema21 < ema50) trend = "DOWN";
    else if (ema9 > ema21) trend = "WEAK_UP";
    else trend = "WEAK_DOWN";
  }

  // وقف الخسارة وجني الأرباح
  let stopLoss = null, takeProfit = null, positionSize = null;
  const direction = signal.includes("BUY") ? "long" : (signal.includes("SELL") ? "short" : "neutral");
  if (direction !== "neutral" && atr && atr > 0) {
    stopLoss = computeStopLoss(currentPrice, atr, direction, 2);
    takeProfit = computeTakeProfit(currentPrice, stopLoss, riskRewardRatio, direction);
    positionSize = computePositionSize(currentPrice, stopLoss, accountBalance, riskPercent);
  } else if (direction !== "neutral") {
    const stopPercent = direction === "long" ? 0.98 : 1.02;
    const takePercent = direction === "long" ? 1.04 : 0.96;
    stopLoss = currentPrice * stopPercent;
    takeProfit = currentPrice * takePercent;
    positionSize = computePositionSize(currentPrice, stopLoss, accountBalance, riskPercent);
  }

  // توليد سبب التوصية (بالعربية)
  let reason = "";
  if (signal.includes("BUY")) {
    reason = `مؤشرات إيجابية: RSI ${rsi?.toFixed(1)} (منطقة بيعية), `;
    if (stochRSI !== null) reason += `StochRSI ${stochRSI.toFixed(0)}, `;
    reason += `وتقاطع EMAs صاعد. ${details.slice(0,2).join("، ")}`;
  } else if (signal.includes("SELL")) {
    reason = `مؤشرات سلبية: RSI ${rsi?.toFixed(1)} (منطقة شرائية), `;
    if (stochRSI !== null) reason += `StochRSI ${stochRSI.toFixed(0)}, `;
    reason += `وتقاطع EMAs هابط. ${details.slice(0,2).join("، ")}`;
  } else {
    reason = `السوق في حالة تجميع. RSI ${rsi?.toFixed(1)}، انتظر كسر واضح للدعم (${support?.toFixed(2)}) أو المقاومة (${resistance?.toFixed(2)}).`;
  }

  const emaCross = detectEMACrossover(prices, 9, 21);

  return {
    asset,
    price: currentPrice,
    signal,
    trend,
    rsi: rsi !== null ? rsi : 50,
    atr: atr !== null ? atr : 0,
    macd: macd ? macd.macd : 0,
    macdSignal: macd ? macd.signal : 0,
    macdHistogram: macd ? macd.histogram : 0,
    bbUpper: bb ? bb.upper : null,
    bbLower: bb ? bb.lower : null,
    stochRSI: stochRSI,
    support,
    resistance,
    score,
    stopLoss,
    takeProfit,
    positionSize: positionSize ? positionSize.toFixed(4) : "0",
    reason,
    emaCross,
    ema9,
    ema21,
    volumeRatio
  };
}


// ===================== باقي الكود (DOM, UI, API, الأحداث) =====================
// (جميع المتغيرات والدوال التالية هي نفسها الموجودة في index.js الأصلي، مع تعديل استدعاء analyze إلى advancedAnalysis)

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
const rsiValueDisplay = document.getElementById('rsiValueDisplay');
const macdValSpan = document.getElementById('macdVal');
const macdSignalSpan = document.getElementById('macdSignal');
const macdHistSpan = document.getElementById('macdHist');
const bbUpperSpan = document.getElementById('bbUpper');
const bbMiddleSpan = document.getElementById('bbMiddle');
const bbLowerSpan = document.getElementById('bbLower');
const emaCrossSpan = document.getElementById('emaCross');
const candleCanvas = document.getElementById('candleCanvas');

let currentCandles = [];
let currentPrice = 0;
let lastAnalysis = null;
let audioEnabled = false;
let audioInterval = null;
let liveUpdateInterval = null;
let symbol = 'BTCUSDT';
let interval = '1h';
let balance = 100;
let riskPercent = 2;
let isUpdating = false;

const symbols = {
  BTCUSDT: { sym: '₿', name: 'BTC/USDT' },
  ETHUSDT: { sym: 'Ξ', name: 'ETH/USDT' },
  SOLUSDT: { sym: '◎', name: 'SOL/USDT' },
  BNBUSDT: { sym: '⬡', name: 'BNB/USDT' },
  PAXGUSDT: { sym: '🥇', name: 'PAXG/USDT' }
};

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
  balance = parseFloat(balanceInput.value) || 100;
  riskPercent = parseFloat(riskInput.value) || 2;
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
    ctx.moveTo(x + candleWidth / 2, highY);
    ctx.lineTo(x + candleWidth / 2, lowY);
    ctx.stroke();
  }
}

function updatePriceUI(ticker) {
  livePriceEl.innerText = `$${ticker.price.toFixed(2)}`;
  bidPriceEl.innerText = ticker.bid !== null ? `$${ticker.bid.toFixed(2)}` : '--';
  askPriceEl.innerText = ticker.ask !== null ? `$${ticker.ask.toFixed(2)}` : '--';
  volume24hEl.innerText = ticker.volume.toLocaleString();
  const changeClass = ticker.changePercent >= 0 ? 'up' : 'down';
  const changeSymbol = ticker.changePercent >= 0 ? '▲' : '▼';
  priceChangeSpan.innerHTML = `${changeSymbol} ${Math.abs(ticker.changePercent).toFixed(2)}%`;
  priceChangeSpan.className = `price-change ${changeClass}`;
  let volPercent = Math.min(100, (ticker.volume / 50000) * 100);
  if (symbol === 'ETHUSDT') volPercent = Math.min(100, (ticker.volume / 300000) * 100);
  if (symbol === 'SOLUSDT') volPercent = Math.min(100, (ticker.volume / 2000000) * 100);
  if (symbol === 'BNBUSDT') volPercent = Math.min(100, (ticker.volume / 100000) * 100);
  if (symbol === 'PAXGUSDT') volPercent = Math.min(100, (ticker.volume / 1000) * 100);
  volBar.style.width = `${volPercent}%`;
}

function updateSignalUI(analysis) {
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
  let conf = Math.min(100, Math.abs(analysis.score) * 10 + 30);
  confBar.style.width = `${conf}%`;
  confPctSpan.textContent = `${Math.round(conf)}%`;
  signalDescSpan.textContent = analysis.reason.substring(0, 140);
  slValSpan.textContent = analysis.stopLoss ? `$${analysis.stopLoss.toFixed(2)}` : '--';
  tpValSpan.textContent = analysis.takeProfit ? `$${analysis.takeProfit.toFixed(2)}` : '--';
  posValSpan.textContent = analysis.positionSize;
  atrValSpan.textContent = `$${analysis.atr.toFixed(2)}`;
  const rsi = analysis.rsi;
  rsiValueSpan.textContent = rsi.toFixed(1);
  if (rsiValueDisplay) rsiValueDisplay.textContent = rsi.toFixed(1);
  const rsiLeftPercent = Math.min(100, Math.max(0, (rsi / 100) * 100));
  if (rsiNeedle && rsiTrack) rsiNeedle.style.left = `${rsiLeftPercent}%`;
  if (macdValSpan) macdValSpan.textContent = analysis.macd?.toFixed(4) || '--';
  if (macdSignalSpan) macdSignalSpan.textContent = analysis.macdSignal?.toFixed(4) || '--';
  if (macdHistSpan) macdHistSpan.textContent = analysis.macdHistogram?.toFixed(4) || '--';
  if (bbUpperSpan) bbUpperSpan.textContent = analysis.bbUpper ? `$${analysis.bbUpper.toFixed(2)}` : '--';
  if (bbMiddleSpan) bbMiddleSpan.textContent = analysis.bbUpper ? `$${((analysis.bbUpper + analysis.bbLower) / 2).toFixed(2)}` : '--';
  if (bbLowerSpan) bbLowerSpan.textContent = analysis.bbLower ? `$${analysis.bbLower.toFixed(2)}` : '--';
  if (emaCrossSpan) {
    let crossText = analysis.emaCross || '--';
    if (crossText === 'ABOVE') crossText = 'EMA9 فوق EMA21 (صاعد)';
    else if (crossText === 'BELOW') crossText = 'EMA9 تحت EMA21 (هابط)';
    emaCrossSpan.textContent = crossText;
  }
    
  const now = new Date();
  signalTimeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

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
    // استدعاء التحليل المتقدم بدلاً من old analyze
    const analysis = advancedAnalysis(prices, currentPrice, symbol, currentCandles, riskConfig);
    lastAnalysis = analysis;
    updateSignalUI(analysis);
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

async function exportToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont('helvetica');
  doc.text('NEXUS PRO v4.1 - Enhanced Signal Report', 20, 20);
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
  let content = `NEXUS PRO v4.1 - Signal Report\n`;
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

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ar-EG');
  const clockEl = document.getElementById('liveTime');
  if (clockEl) clockEl.textContent = timeStr;
}
setInterval(updateClock, 1000);
updateClock();

function init() {
  loadSettings();
  loadTheme();
  startAutoRefresh();
}
init();

  
