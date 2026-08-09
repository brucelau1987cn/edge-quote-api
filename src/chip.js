/**
 * 东方财富筹码分布计算器 (CYQ Calculator)
 * 移植自 akshare stock_cyq_em
 * 数据源：腾讯 fqkline 日线（OHLCV）+ 腾讯行情流通股本（计算换手率）
 */

/**
 * 从腾讯获取日K线数据（OHLCV + 计算换手率）
 * 先通过 qt.gtimg.cn 获取流通股本，再从 fqkline 获取日线，计算 hsl
 */
async function fetchKlineFromTencent(symbol) {
  const secCode = symbol.startsWith('6') ? `sh${symbol}` : `sz${symbol}`;

  // 1. 获取流通股本（从实时行情）
  const quoteRes = await fetch(`https://qt.gtimg.cn/q=${secCode}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.qq.com/' },
  });
  if (!quoteRes.ok) throw new Error(`tencent quote HTTP ${quoteRes.status}`);
  const buf = await quoteRes.arrayBuffer();
  const dec = new TextDecoder('gbk');
  const quoteText = dec.decode(buf);
  const quoteParts = quoteText.split('~');
  const price = parseFloat(quoteParts[3]) || 0;
  const floatMv = parseFloat(quoteParts[44]) || 0; // 流通市值（亿）
  const floatShares = floatMv > 0 && price > 0 ? Math.round(floatMv * 1e8 / price / 100) : 0; // 流通股本（手）

  // 2. 获取日K线（fqkline）
  const url = `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${secCode},day,,,320,qfq`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.qq.com/' },
  });
  if (!res.ok) throw new Error(`tencent fqkline HTTP ${res.status}`);
  const data = await res.json();
  const kdata = data?.data?.[secCode]?.day || data?.data?.[secCode]?.qfqday;
  if (!kdata || !kdata.length) throw new Error('tencent fqkline empty');

  // 腾讯日K: [date, open, close, high, low, volume]
  return kdata.map((k) => {
    const vol = parseFloat(k[5]) || 0; // 成交量（手）
    return {
      date: k[0],
      open: parseFloat(k[1]),
      close: parseFloat(k[2]),
      high: parseFloat(k[3]),
      low: parseFloat(k[4]),
      volume: vol,
      hsl: floatShares > 0 ? Math.min(100, (vol / floatShares) * 100) : 0, // 换手率(%)
    };
  });
}

/**
 * 从 push2his 获取日K线数据（可能被限制，作为 fallback）
 */
async function fetchKlineFromPush2his(secid, adjust) {
  const adjustMap = { 'qfq': '1', 'hfq': '2', '': '0' };
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
  const params = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101',
    fqt: adjustMap[adjust] || '0',
    lmt: '210',
    end: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  });
  const res = await fetch(`${url}?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' },
  });
  if (!res.ok) throw new Error(`push2his HTTP ${res.status}`);
  const d = await res.json();
  if (d.rc !== 0 || !d.data?.klines) throw new Error(`push2his rc=${d.rc}`);
  return d.data.klines.map((line) => {
    const parts = line.split(',');
    return {
      date: parts[0], open: parseFloat(parts[1]), close: parseFloat(parts[2]),
      high: parseFloat(parts[3]), low: parseFloat(parts[4]),
      volume: parseFloat(parts[5]), hsl: parseFloat(parts[10]),
    };
  });
}

/**
 * 计算筹码分布（CYQ 算法）
 * 输入: 日K线数组 (open, close, high, low, hsl)
 * 输出: 最新日的获利比例、平均成本、90/70集中度、90/70成本区间
 */
function computeChipDistribution(klines) {
  const factor = 150;
  const range = 120;
  const index = klines.length - 1;
  if (klines.length === 0) return null;

  const start = Math.max(0, index - range + 1);
  const kdata = klines.slice(start, Math.max(1, index + 1));

  let maxprice = 0, minprice = 0;
  for (const k of kdata) {
    maxprice = !maxprice ? k.high : Math.max(maxprice, k.high);
    minprice = !minprice ? k.low : Math.min(minprice, k.low);
  }

  const accuracy = Math.max(0.01, (maxprice - minprice) / (factor - 1));
  const yrange = Array.from({ length: factor }, (_, i) => +(minprice + accuracy * i).toFixed(2));
  const xdata = new Array(factor).fill(0);

  for (const k of kdata) {
    const avg = (k.open + k.close + k.high + k.low) / 4;
    const turnoverRate = Math.min(1, (k.hsl || 0) / 100);
    const H = Math.floor((k.high - minprice) / accuracy);
    const L = Math.ceil((k.low - minprice) / accuracy);
    const GPoint = k.high === k.low
      ? [factor - 1, Math.floor((avg - minprice) / accuracy)]
      : [2 / (k.high - k.low), Math.floor((avg - minprice) / accuracy)];

    for (let n = 0; n < factor; n++) xdata[n] *= (1 - turnoverRate);

    if (k.high === k.low) {
      xdata[GPoint[1]] += GPoint[0] * turnoverRate / 2;
    } else {
      for (let j = L; j <= H; j++) {
        const curprice = minprice + accuracy * j;
        if (curprice <= avg) {
          xdata[j] += Math.abs(avg - k.low) < 1e-8
            ? GPoint[0] * turnoverRate
            : (curprice - k.low) / (avg - k.low) * GPoint[0] * turnoverRate;
        } else {
          xdata[j] += Math.abs(k.high - avg) < 1e-8
            ? GPoint[0] * turnoverRate
            : (k.high - curprice) / (k.high - avg) * GPoint[0] * turnoverRate;
        }
      }
    }
  }

  const currentprice = kdata[kdata.length - 1].close;
  let totalChips = 0;
  for (let i = 0; i < factor; i++) totalChips += xdata[i];

  function getCostByChip(chip) {
    let sum = 0;
    for (let i = 0; i < factor; i++) {
      sum += xdata[i];
      if (sum > chip) return minprice + i * accuracy;
    }
    return minprice + (factor - 1) * accuracy;
  }

  let below = 0;
  for (let i = 0; i < factor; i++) {
    if (currentprice >= minprice + i * accuracy) below += xdata[i];
  }
  const benefitPart = totalChips === 0 ? 0 : below / totalChips;
  const avgCost = getCostByChip(totalChips * 0.5);

  function computePercentChips(percent) {
    const ps = [(1 - percent) / 2, (1 + percent) / 2];
    const pr = [getCostByChip(totalChips * ps[0]), getCostByChip(totalChips * ps[1])];
    return {
      priceRange: [+pr[0].toFixed(2), +pr[1].toFixed(2)],
      concentration: pr[0] + pr[1] === 0 ? 0 : (pr[1] - pr[0]) / (pr[0] + pr[1]),
    };
  }

  const pct90 = computePercentChips(0.9);
  const pct70 = computePercentChips(0.7);

  return {
    benefitPart: +(benefitPart * 100).toFixed(2), // 转为百分比
    avgCost: +avgCost.toFixed(2),
    avgCostPct: +((avgCost - currentprice) / currentprice * 100).toFixed(2), // 平均成本相对现价偏离
    pct90: {
      low: pct90.priceRange[0],
      high: pct90.priceRange[1],
      concentration: +(pct90.concentration * 100).toFixed(2),
    },
    pct70: {
      low: pct70.priceRange[0],
      high: pct70.priceRange[1],
      concentration: +(pct70.concentration * 100).toFixed(2),
    },
  };
}

export { fetchKlineFromTencent, fetchKlineFromPush2his, computeChipDistribution };