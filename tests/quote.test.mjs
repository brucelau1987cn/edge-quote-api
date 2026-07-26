import assert from 'node:assert/strict';
import test from 'node:test';
import {
  onRequestGet,
  parseSymbol,
  fetchQuote,
  getXueqiuToken,
  clearQuoteCache,
  getQuoteCacheStats,
  resolveQuoteCacheTtlMs,
  QUOTE_CACHE_TTL_MS,
  QUOTE_CACHE_TTL_OPEN_MS,
  QUOTE_CACHE_TTL_CLOSED_MS,
  QUOTE_CACHE_TTL_WEEKEND_MS,
} from '../src/index.js';

test('parseSymbol auto-detects markets and maps to all three sources', () => {
  const p1 = parseSymbol('600021.SH');
  assert.equal(p1.tencent, 'sh600021');
  assert.equal(p1.sina, 'sh600021');
  assert.equal(p1.xueqiu, 'SH600021');

  const p2 = parseSymbol('AAPL.US');
  assert.equal(p2.tencent, 'usAAPL');
  assert.equal(p2.sina, 'gb_aapl');
  assert.equal(p2.xueqiu, 'AAPL');

  const p3 = parseSymbol('00700.HK');
  assert.equal(p3.tencent, 'hk00700');
  assert.equal(p3.sina, 'hk00700');
  assert.equal(p3.xueqiu, '00700');
});

test('onRequestGet returns JSON with mocked Tencent upstream', async () => {
  clearQuoteCache();
  const mockGbk = `v_sh600021="1~上海电力~600021~14.60~15.34~15.10~406482~155174~250958~14.60~5704~14.59~346~14.58~1476~14.57~761~14.56~1464~14.61~179~14.62~232~14.63~30~14.64~345~14.65~712~~20260724104135~-0.74~-4.82~15.11~14.60~14.60/406482/601828334~406482~60183~1.44~16.44~~15.11~14.60~3.32~411.99~411.99~2.08~16.87~13.81~1.14~8253~14.81~18.16~14.89~~~1.56~60182.8334~0.0000~0~   A~GP-A~-25.70~-2.08~2.53~7.26~2.35~31.41~8.89~4.29~-2.93~-15.36~2821875805~2821875805~73.37~-45.99~2821875805~~~61.50~-0.34~~CNY~0~___D__F__N~14.51~944~";`;
  const encoder = new TextEncoder();
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr.includes('xueqiu.com/about')) {
      return new Response('', { headers: { 'set-cookie': 'xq_a_token=mock_xq_token; path=/' } });
    }
    return new Response(encoder.encode(mockGbk), { status: 200 });
  };
  try {
    const req = new Request('https://example.com/api/public/v1/quote?symbol=600021&exchange=SSE');
    const res = await onRequestGet({ request: req });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'ok');
    assert.equal(data.quotes['600021'].price, 14.6);
    assert.equal(data.quotes['600021'].change_percent, -4.82);
    assert.equal(res.headers.get('x-quote-cache'), 'MISS');
    assert.equal(res.headers.get('x-quote-source'), 'tencent');
  } finally {
    globalThis.fetch = previous;
  }
});

test('onRequestGet short-caches identical batches and exposes HIT/MISS headers', async () => {
  clearQuoteCache();
  const mockGbk = `v_sh600021="1~上海电力~600021~14.60~15.34~15.10~406482~155174~250958~14.60~5704~14.59~346~14.58~1476~14.57~761~14.56~1464~14.61~179~14.62~232~14.63~30~14.64~345~14.65~712~~20260724104135~-0.74~-4.82~15.11~14.60~14.60/406482/601828334~406482~60183~1.44~16.44~~15.11~14.60~3.32~411.99~411.99~2.08~16.87~13.81~1.14~8253~14.81~18.16~14.89~~~1.56~60182.8334~0.0000~0~   A~GP-A~-25.70~-2.08~2.53~7.26~2.35~31.41~8.89~4.29~-2.93~-15.36~2821875805~2821875805~73.37~-45.99~2821875805~~~61.50~-0.34~~CNY~0~___D__F__N~14.51~944~";`;
  const encoder = new TextEncoder();
  let upstreamCalls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr.includes('xueqiu.com/about')) {
      return new Response('', { headers: { 'set-cookie': 'xq_a_token=mock_xq_token; path=/' } });
    }
    if (urlStr.includes('qt.gtimg.cn')) {
      upstreamCalls += 1;
      return new Response(encoder.encode(mockGbk), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const req1 = new Request('https://example.com/api/public/v1/quote?symbols=600021&exchange=SSE');
    const res1 = await onRequestGet({ request: req1 });
    const data1 = await res1.json();
    assert.equal(res1.headers.get('x-quote-cache'), 'MISS');
    assert.equal(res1.headers.get('x-quote-cache-layer'), 'none');
    assert.equal(data1.quotes['600021'].price, 14.6);

    const req2 = new Request('https://example.com/api/public/v1/quote?symbol=600021&exchange=SSE');
    const res2 = await onRequestGet({ request: req2 });
    const data2 = await res2.json();
    assert.equal(res2.headers.get('x-quote-cache'), 'HIT');
    assert.equal(res2.headers.get('x-quote-cache-layer'), 'memory');
    assert.equal(data2.quotes['600021'].price, 14.6);
    assert.equal(upstreamCalls, 1);

    const bypass = await onRequestGet({
      request: new Request('https://example.com/api/public/v1/quote?symbol=600021&exchange=SSE&nocache=1'),
    });
    assert.equal(bypass.headers.get('x-quote-cache'), 'BYPASS');
    assert.equal(upstreamCalls, 2);

    const stats = getQuoteCacheStats();
    assert.equal(stats.hit, 1);
    assert.ok(stats.miss >= 1);
    assert.ok(QUOTE_CACHE_TTL_MS >= 1000);
    assert.equal(stats.open_ttl_ms, QUOTE_CACHE_TTL_OPEN_MS);
    assert.ok(['open_cn', 'open_us', 'open_overlap', 'closed', 'weekend'].includes(stats.session));
    assert.ok(Number(res1.headers.get('x-quote-cache-ttl-ms')) >= QUOTE_CACHE_TTL_OPEN_MS);
    assert.ok(res1.headers.get('x-quote-cache-session'));
  } finally {
    globalThis.fetch = previous;
    clearQuoteCache();
  }
});

test('resolveQuoteCacheTtlMs uses short TTL in open sessions and longer when closed', () => {
  // Monday 10:00 Asia/Shanghai ≈ open CN
  const cnOpen = resolveQuoteCacheTtlMs(new Date('2026-07-27T02:00:00.000Z'));
  assert.equal(cnOpen.ttlMs, QUOTE_CACHE_TTL_OPEN_MS);
  assert.equal(cnOpen.session, 'open_cn');

  // Monday 22:00 Asia/Shanghai / 10:00 America/New_York ≈ open US
  const usOpen = resolveQuoteCacheTtlMs(new Date('2026-07-27T14:00:00.000Z'));
  assert.equal(usOpen.ttlMs, QUOTE_CACHE_TTL_OPEN_MS);
  assert.equal(usOpen.session, 'open_us');

  // Monday 12:00 Asia/Shanghai lunch / pre-US ≈ closed
  const closed = resolveQuoteCacheTtlMs(new Date('2026-07-27T04:00:00.000Z'));
  assert.equal(closed.ttlMs, QUOTE_CACHE_TTL_CLOSED_MS);
  assert.equal(closed.session, 'closed');

  // Saturday both weekend
  const weekend = resolveQuoteCacheTtlMs(new Date('2026-07-25T08:00:00.000Z'));
  assert.equal(weekend.ttlMs, QUOTE_CACHE_TTL_WEEKEND_MS);
  assert.equal(weekend.session, 'weekend');
  assert.ok(QUOTE_CACHE_TTL_WEEKEND_MS > QUOTE_CACHE_TTL_CLOSED_MS);
  assert.ok(QUOTE_CACHE_TTL_CLOSED_MS > QUOTE_CACHE_TTL_OPEN_MS);
});

test('onRequestGet uses caches.default as L2 when memory empty', async () => {
  clearQuoteCache();
  const mockGbk = `v_sh600021="1~上海电力~600021~14.60~15.34~15.10~406482~155174~250958~14.60~5704~14.59~346~14.58~1476~14.57~761~14.56~1464~14.61~179~14.62~232~14.63~30~14.64~345~14.65~712~~20260724104135~-0.74~-4.82~15.11~14.60~14.60/406482/601828334~406482~60183~1.44~16.44~~15.11~14.60~3.32~411.99~411.99~2.08~16.87~13.81~1.14~8253~14.81~18.16~14.89~~~1.56~60182.8334~0.0000~0~   A~GP-A~-25.70~-2.08~2.53~7.26~2.35~31.41~8.89~4.29~-2.93~-15.36~2821875805~2821875805~73.37~-45.99~2821875805~~~61.50~-0.34~~CNY~0~___D__F__N~14.51~944~";`;
  const encoder = new TextEncoder();
  let upstreamCalls = 0;
  const store = new Map();
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      async match(req) {
        const key = typeof req === 'string' ? req : req.url;
        return store.get(key) || undefined;
      },
      async put(req, res) {
        const key = typeof req === 'string' ? req : req.url;
        store.set(key, res.clone());
      },
    },
  };
  globalThis.fetch = async (url) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr.includes('xueqiu.com/about')) {
      return new Response('', { headers: { 'set-cookie': 'xq_a_token=mock_xq_token; path=/' } });
    }
    if (urlStr.includes('qt.gtimg.cn')) {
      upstreamCalls += 1;
      return new Response(encoder.encode(mockGbk), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const miss = await onRequestGet({
      request: new Request('https://example.com/api/public/v1/quote?symbol=600021&exchange=SSE'),
    });
    assert.equal(miss.headers.get('x-quote-cache'), 'MISS');
    assert.equal(upstreamCalls, 1);
    assert.ok(store.size >= 1);

    // drop L1 only — L2 edge should still hit
    clearQuoteCache();
    // restore edge store after clearQuoteCache (stats only; store is external)
    // store still populated
    const hit = await onRequestGet({
      request: new Request('https://example.com/api/public/v1/quote?symbol=600021&exchange=SSE'),
    });
    assert.equal(hit.headers.get('x-quote-cache'), 'HIT');
    assert.equal(hit.headers.get('x-quote-cache-layer'), 'edge');
    assert.equal(upstreamCalls, 1);
    const stats = getQuoteCacheStats();
    assert.equal(stats.edge_hit, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
    clearQuoteCache();
  }
});

// Live network tests are optional; skip when OFFLINE=1
const offline = process.env.OFFLINE === '1';

test('getXueqiuToken auto-fetches token from xueqiu.com', { skip: offline }, async () => {
  const token = await getXueqiuToken();
  assert.ok(token, 'Token should be auto fetched without user configuration');
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 5);
});

test('fetchQuote returns structured data and falls back gracefully', { skip: offline }, async () => {
  const result = await fetchQuote('600021.SH,00700.HK,AAPL.US,hf_CL');
  assert.equal(result.status, 'ok');
  assert.ok(['tencent', 'sina', 'xueqiu'].includes(result.source));
  assert.ok(result.quotes['600021']);
  assert.ok(result.quotes['00700']);
});


test('fetchQuote parses Sina continuous futures when Tencent empty', async () => {
  const mock = `var hq_str_nf_AU0="黄金连续,023000,887.000,893.080,885.360,0.000,887.500,887.780,887.780,0.000,885.840,5,3,153816.000,70579,沪,黄金,2026-07-25,1,,,,,,,,,889.362,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0";\nvar hq_str_nf_SC0="上海原油连续,023000,580.000,585.600,565.200,0.000,577.100,578.000,577.700,0.000,592.800,4,17,46925.000,121141,沪,上海原油,2026-07-25,1,,,,,,,,,575.582,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0,0.000,0";\n`;
  const encoder = new TextEncoder();
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr.includes('xueqiu.com/about')) return new Response('', { headers: { 'set-cookie': 'xq_a_token=mock; path=/' } });
    if (urlStr.includes('qt.gtimg.cn')) return new Response(encoder.encode('v_pv_none_match="1";'), { status: 200 });
    if (urlStr.includes('hq.sinajs.cn')) return new Response(encoder.encode(mock), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  try {
    const result = await fetchQuote('nf_AU0,nf_SC0');
    assert.equal(result.status, 'ok');
    assert.equal(result.source, 'sina');
    assert.equal(result.quotes.nf_AU0.price, 887.78);
    assert.equal(result.quotes.nf_SC0.price, 577.7);
  } finally {
    globalThis.fetch = previous;
  }
});
