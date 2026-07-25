/**
 * Cloudflare Worker / Pages Function - Edge Stock Quote API
 * 单个/批量代理解析股票与 ETF 极速行情接口，带 Cloudflare Edge 5s 缓存
 */

export async function fetchQuote(symbolsStr, defaultExchange = 'SSE') {
  const items = (symbolsStr || '600021').split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);

  if (items.length === 0) {
    return { status: 'error', message: 'no symbols provided' };
  }

  const secCodes = items.map(item => {
    const parts = item.split('.');
    const code = parts[0];
    let ex = parts[1]?.toUpperCase();
    if (!ex) ex = defaultExchange === 'SZSE' || code.startsWith('159') || code.startsWith('300') || code.startsWith('00') ? 'SZ' : 'SH';
    return ex === 'SZ' || ex === 'SZSE' ? `sz${code}` : `sh${code}`;
  });

  const upstreamUrl = `https://qt.gtimg.cn/q=${secCodes.join(',')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      'Referer': 'https://finance.qq.com/',
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  if (!upstreamRes.ok) {
    throw new Error(`upstream HTTP ${upstreamRes.status}`);
  }

  const buffer = await upstreamRes.arrayBuffer();
  const decoder = new TextDecoder('gbk');
  const text = decoder.decode(buffer);

  const quotes = {};
  const lines = text.split(';');

  for (const line of lines) {
    const match = line.match(/v_(s[hz]\d+)="([^"]+)"/);
    if (!match) continue;

    const secKey = match[1];
    const parts = match[2].split('~');
    if (parts.length < 35) continue;

    const name = parts[1] || '';
    const code = parts[2] || secKey.slice(2);
    const currentPrice = parseFloat(parts[3]) || 0;
    const prevClose = parseFloat(parts[4]) || 0;
    const openPrice = parseFloat(parts[5]) || 0;
    const volume = parseInt(parts[6], 10) || 0;
    const changeAmount = parseFloat(parts[31]) || (currentPrice - prevClose);
    const changePercent = parseFloat(parts[32]) || 0;
    const highPrice = parseFloat(parts[33]) || 0;
    const lowPrice = parseFloat(parts[34]) || 0;
    const rawTime = parts[30] || '';

    let quoteTime = new Date().toISOString();
    if (rawTime && rawTime.length === 14) {
      quoteTime = `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)}T${rawTime.slice(8, 10)}:${rawTime.slice(10, 12)}:${rawTime.slice(12, 14)}+08:00`;
    }

    quotes[code] = {
      symbol: code,
      sec_code: secKey,
      name,
      price: currentPrice,
      prev_close: prevClose,
      open: openPrice,
      high: highPrice,
      low: lowPrice,
      change_amount: parseFloat(changeAmount.toFixed(3)),
      change_percent: parseFloat(changePercent.toFixed(2)),
      volume_hands: volume,
      quote_time: quoteTime,
      status: 'ok',
    };
  }

  return {
    status: 'ok',
    count: Object.keys(quotes).length,
    quotes,
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const symbols = url.searchParams.get('symbols') || url.searchParams.get('symbol') || '600021';
    const exchange = (url.searchParams.get('exchange') || 'SSE').toUpperCase();

    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=15',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    };

    try {
      const data = await fetchQuote(symbols, exchange);
      return new Response(JSON.stringify(data), {
        status: data.status === 'ok' ? 200 : 400,
        headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ status: 'error', message: err.message || 'internal error' }), {
        status: 500,
        headers,
      });
    }
  },
};
