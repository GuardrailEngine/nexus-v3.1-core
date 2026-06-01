// engine/analyzer.js
// NEXUS v3.5 — Market analysis engine (ES Module)

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod + signalPeriod) return null;
  const emaFast = calcEMA(prices, fastPeriod);
  const emaSlow = calcEMA(prices, slowPeriod);
  if (emaFast === null || emaSlow === null) return null;
  const macdLine = emaFast - emaSlow;
  const macdValues = [];
  for (let i = prices.length - signalPeriod; i < prices.length; i++) {
    const f = calcEMA(prices.slice(0, i + 1), fastPeriod);
    const s = calcEMA(prices.slice(0, i + 1), slowPeriod);
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
    const hl = high - low;
    const hc = Math.abs(high - prevClose);
    const lc = Math.abs(low - prevClose);
    tr.push(Math.max(hl, hc, lc));
  }
  if (tr.length === 0) return null;
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
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

function computePositionSize(entryPrice, stopLossPrice, accountBalance = 10000, riskPercent = 2) {
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

export function analyze(prices, currentPrice, asset, candles = null, riskConfig = {}) {
  const accountBalance = riskConfig.balance || 10000;
  const riskPercent = riskConfig.riskPercent || 2;
  const riskRewardRatio = riskConfig.riskReward || 2;

  const ema9 = calcEMA(prices, 9);
  const ema21 = calcEMA(prices, 21);
  const ema50 = calcEMA(prices, 50);
  const rsi = calcRSI(prices, 14);
  const macdObj = calcMACD(prices);
  const bb = calcBollingerBands(prices, 20, 2);
  const { support, resistance } = findSupportResistance(prices, 20);

  let atr = null;
  if (candles && candles.length >= 10) {
    atr = calcATR(candles, 14);
  }

  let trend = "NEUTRAL";
  if (ema9 && ema21 && ema50) {
    if (ema9 > ema21 && ema21 > ema50) trend = "UP";
    else if (ema9 < ema21 && ema21 < ema50) trend = "DOWN";
    else if (ema9 > ema21) trend = "WEAK_UP";
    else trend = "WEAK_DOWN";
  }

  let score = 0;
  if (rsi !== null) {
    if (rsi < 30) score += 2;
    else if (rsi < 45) score += 1;
    else if (rsi > 70) score -= 2;
    else if (rsi > 55) score -= 1;
  }
  if (ema9 && ema21) {
    if (ema9 > ema21) score += 1;
    else score -= 1;
  }
  if (bb) {
    if (currentPrice < bb.lower) score += 2;
    else if (currentPrice > bb.upper) score -= 2;
  }
  if (macdObj) {
    if (macdObj.macd > 0) score += 1;
    else score -= 1;
    if (macdObj.histogram > 0) score += 0.5;
    else score -= 0.5;
  }
  if (support && currentPrice < support * 1.02) score += 1;
  if (resistance && currentPrice > resistance * 0.98) score -= 1;

  let signal = "NEUTRAL";
  if (score >= 4) signal = "STRONG_BUY";
  else if (score >= 2) signal = "BUY";
  else if (score <= -4) signal = "STRONG_SELL";
  else if (score <= -2) signal = "SELL";

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

  let reason = "";
  if (signal.includes("BUY")) {
    reason = `مؤشرات إيجابية: RSI ${rsi?.toFixed(1)}، EMAs صاعدة، ${bb && currentPrice < bb.lower ? 'السعر تحت Bollinger Lower' : ''} ${macdObj && macdObj.macd > 0 ? 'MACD إيجابي' : ''}`;
  } else if (signal.includes("SELL")) {
    reason = `مؤشرات سلبية: RSI ${rsi?.toFixed(1)}، EMAs هابطة، ${bb && currentPrice > bb.upper ? 'السعر فوق Bollinger Upper' : ''} ${macdObj && macdObj.macd < 0 ? 'MACD سلبي' : ''}`;
  } else {
    reason = `السوق في حالة تجميع. الدعم $${support?.toFixed(2)}، المقاومة $${resistance?.toFixed(2)}. انتظر كسر واضح.`;
  }

  return {
    asset,
    price: currentPrice,
    signal,
    trend,
    rsi: rsi !== null ? rsi : 50,
    atr: atr !== null ? atr : 0,
    macd: macdObj ? macdObj.macd : 0,
    macdSignal: macdObj ? macdObj.signal : 0,
    macdHistogram: macdObj ? macdObj.histogram : 0,
    bbUpper: bb ? bb.upper : null,
    bbLower: bb ? bb.lower : null,
    support,
    resistance,
    score,
    entry: currentPrice,
    stopLoss,
    takeProfit,
    positionSize: positionSize ? positionSize.toFixed(4) : "0",
    reason
  };
      }
