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

  assert.equal(parseSymbol('HSI.HK').tencent, 'hkHSI');
  assert.equal(parseSymbol('HSTECH.HK').tencent, 'hkHSTECH');
  assert.equal(parseSymbol('HSCI.HK').displayCode, 'HSCI');
  assert.equal(parseSymbol('INX.US').tencent, 'usINX');
  assert.equal(parseSymbol('IXIC.US').tencent, 'usIXIC');
  assert.equal(parseSymbol('DJI.US').tencent, 'usDJI');
  assert.equal(parseSymbol('DINIW').sina, 'DINIW');
  assert.equal(parseSymbol('DXY').displayCode, 'DINIW');
  assert.equal(parseSymbol('hf_CL').type, 'futures');
  // ChiNext / SZ bare codes must map to sz*, not sh*.
  assert.equal(parseSymbol('301511').tencent, 'sz301511');
  assert.equal(parseSymbol('000021').tencent, 'sz000021');
  assert.equal(parseSymbol('600021').tencent, 'sh600021');
});

test('fetchQuote fills dollar index from Sina DINIW when Tencent misses it', async () => {
  const tencent = 'v_hf_CL="82.73,4.38,82.65,82.66,83.30,79.92,10:17:05,79.26,80.04,0,1,1,2026-07-29,NY Crude";';
  const sina = 'var hq_str_DINIW="10:18:41,101.3585,101.3585,101.4203,1091,101.4108,101.4542,101.3451,101.3585,USD Index,2026-07-29";\n';
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = typeof url === 'string' ? url : url.url;
    if (value.includes('qt.gtimg.cn')) return new Response(new TextEncoder().encode(tencent), { status: 200 });
    if (value.includes('hq.sinajs.cn')) return new Response(new TextEncoder().encode(sina), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  try {
    const result = await fetchQuote('hf_CL,DINIW');
    assert.equal(result.status, 'ok');
    // Preferred continuous codes now come from Sina first.
    assert.equal(result.source, 'sina');
    assert.equal(result.quotes.DINIW.name, 'USD Index');
    assert.equal(result.quotes.DINIW.price, 101.3585);
    assert.equal(result.quotes.DINIW.change_percent, -0.05);
    assert.equal(result.quotes.DINIW.source, 'sina');
  } finally {
    globalThis.fetch = previous;
  }
});

test('fetchQuote prefers Sina for 24H continuous gold/silver/oil and parses hf layout', async () => {
  const sina = [
    'var hq_str_hf_XAU="4030.82,4028.420,4030.82,4031.17,4037.72,4010.24,11:08:00,4028.42,4028.97,0,0,0,2026-07-29,伦敦金（现货黄金）";',
    'var hq_str_hf_XAG="57.60,57.083,57.60,57.66,57.97,56.84,11:08:00,57.08,57.14,0,0,0,2026-07-29,伦敦银（现货白银）";',
    'var hq_str_hf_CL="82.571,,82.480,82.500,83.300,79.920,11:08:14,79.260,80.040,0,1,3,2026-07-29,纽约原油,0";',
    'var hq_str_DINIW="11:08:20,101.3400,101.3400,101.4203,1091,101.4108,101.4542,101.3344,101.3400,美元指数,2026-07-29";',
  ].join('\n');
  const previous = globalThis.fetch;
  let tencentCalls = 0;
  globalThis.fetch = async (url) => {
    const value = typeof url === 'string' ? url : url.url;
    if (value.includes('qt.gtimg.cn')) {
      tencentCalls += 1;
      return new Response(new TextEncoder().encode('v_pv_none_match="1";'), { status: 200 });
    }
    if (value.includes('hq.sinajs.cn')) return new Response(new TextEncoder().encode(sina), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  try {
    const result = await fetchQuote('hf_XAU,hf_XAG,hf_CL,DINIW');
    assert.equal(result.status, 'ok');
    assert.equal(result.source, 'sina');
    assert.equal(tencentCalls, 0);
    assert.equal(result.quotes.hf_XAU.price, 4030.82);
    assert.equal(result.quotes.hf_XAU.change_percent, 0.06);
    assert.equal(result.quotes.hf_XAU.source, 'sina');
    assert.equal(result.quotes.hf_XAG.price, 57.6);
    assert.equal(result.quotes.hf_XAG.change_percent, 0.91);
    assert.equal(result.quotes.hf_CL.price, 82.571);
    assert.equal(result.quotes.hf_CL.change_percent, 4.18);
    assert.equal(result.quotes.DINIW.price, 101.34);
    assert.equal(result.quotes.DINIW.source, 'sina');
  } finally {
    globalThis.fetch = previous;
  }
});

test('fetchQuote fills Hang Seng Composite Index from official dashboard', async () => {
  const tencent = `v_hkHSI="100~恒生指数~HSI~25092.740~24963.230~24993.770~5995512~0~0~25092.740~0~0~0~0~0~0~0~0~0~25092.740~0~0~0~0~0~0~0~0~0~0.0~2026/07/27 10:16:44~129.510~0.52~25097.820~24938.340";\nv_pv_none_match="1";`;
  const dashboard = {
    regions: [{ regionId: 'hongkong', dashboardList: [{
      indexName: 'Hang Seng Composite Index', indexCode: '00011.00', indexValue: '3688.34',
      changeValue: '+20.93', changePercentage: '+0.57', previousClose: '3667.41',
      lastUpdate: '2026-07-27 10:33:00', url: 'hsci',
    }] }],
  };
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = typeof url === 'string' ? url : url.url;
    if (value.includes('qt.gtimg.cn')) return new Response(new TextEncoder().encode(tencent), { status: 200 });
    if (value.includes('hsi.com.hk/data/eng/rt/dashboard.do')) return Response.json(dashboard);
    return new Response('{}', { status: 404 });
  };
  try {
    const result = await fetchQuote('HSI.HK,HSCI.HK');
    assert.equal(result.status, 'ok');
    assert.equal(result.quotes.HSI.price, 25092.74);
    assert.equal(result.quotes.HSCI.name, '恒生综合指数');
    assert.equal(result.quotes.HSCI.price, 3688.34);
    assert.equal(result.quotes.HSCI.change_percent, 0.57);
    assert.equal(result.count, 2);
  } finally {
    globalThis.fetch = previous;
  }
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
  assert.ok(['tencent', 'sina', 'xueqiu', 'mixed'].includes(result.source));
  assert.ok(result.quotes['600021']);
  assert.ok(result.quotes['00700']);
  assert.ok(result.quotes.hf_CL);
  assert.equal(result.quotes.hf_CL.source, 'sina');
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
