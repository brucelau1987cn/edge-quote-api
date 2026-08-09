import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeChipDistributionSeries,
  fetchKlineFromTencent,
  onRequestGet,
  clearChipCache,
  parseSymbol,
} from '../src/index.js';

const GOLDEN_ROWS = [
  { date: '2026-08-03', open: 14.60, close: 14.72, high: 14.85, low: 14.55, hsl: 1.2 },
  { date: '2026-08-04', open: 14.75, close: 14.90, high: 14.95, low: 14.68, hsl: 1.5 },
  { date: '2026-08-05', open: 14.88, close: 14.65, high: 14.92, low: 14.58, hsl: 1.1 },
  { date: '2026-08-06', open: 14.60, close: 14.77, high: 14.82, low: 14.52, hsl: 0.9 },
  { date: '2026-08-07', open: 14.70, close: 14.87, high: 14.88, low: 14.58, hsl: 1.28 },
];

function quoteResponse({ price = 10, floatMv = 100 } = {}) {
  const parts = new Array(50).fill('0');
  parts[3] = String(price);
  parts[44] = String(floatMv);
  return new Response(`v_sh600021="${parts.join('~')}";`);
}

function tencentKlineResponse(key, rows) {
  return Response.json({ code: 0, data: { sh600021: { [key]: rows } } });
}

test('Tencent kline maps empty, qfq and hfq to their real endpoint and response key', async () => {
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    seen.push(value);
    if (value.includes('qt.gtimg.cn')) return quoteResponse();
    if (value.includes('/appstock/app/kline/kline')) {
      return tencentKlineResponse('day', [['2026-08-07', '10', '11', '12', '9', '1000']]);
    }
    if (value.includes(',qfq')) {
      return tencentKlineResponse('qfqday', [['2026-08-07', '20', '21', '22', '19', '1000']]);
    }
    if (value.includes(',hfq')) {
      return tencentKlineResponse('hfqday', [['2026-08-07', '30', '31', '32', '29', '1000']]);
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const none = await fetchKlineFromTencent('600021', '');
    const qfq = await fetchKlineFromTencent('600021', 'qfq');
    const hfq = await fetchKlineFromTencent('600021', 'hfq');
    assert.equal(none[0].close, 11);
    assert.equal(qfq[0].close, 21);
    assert.equal(hfq[0].close, 31);
    assert.ok(seen.some((url) => url.includes('/appstock/app/kline/kline')));
    assert.ok(seen.some((url) => url.includes(',qfq')));
    assert.ok(seen.some((url) => url.includes(',hfq')));
  } finally {
    globalThis.fetch = previous;
  }
});

test('chip route rejects unsupported adjustment before upstream fetch', async () => {
  clearChipCache();
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}'); };
  try {
    const res = await onRequestGet({ request: new Request('https://example.com/api/public/v1/chip?symbol=600021&adjust=bad') });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.message, 'invalid adjust');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test('AkShare golden fixture matches the latest CYQ fields', () => {
  const series = computeChipDistributionSeries(GOLDEN_ROWS, 90);
  assert.equal(series.length, 5);
  assert.deepEqual(series.at(-1), {
    date: '2026-08-07',
    profit_ratio_pct: 95.37,
    average_cost: 14.74,
    average_cost_deviation_pct: -0.87,
    cost_90_low: 14.61,
    cost_90_high: 14.87,
    concentration_90_pct: 0.88,
    cost_70_low: 14.65,
    cost_70_high: 14.83,
    concentration_70_pct: 0.61,
  });
});

test('series returns latest 90 chronological rows and adjacent same-calculator change', async () => {
  clearChipCache();
  const rows = Array.from({ length: 100 }, (_, index) => [
    `2026-${String(index + 1).padStart(3, '0')}`,
    '10', String(10 + index / 100), '11', '9', '1000',
  ]);
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('qt.gtimg.cn')) return quoteResponse();
    if (value.includes(',qfq')) return tencentKlineResponse('qfqday', rows);
    return new Response('{}', { status: 404 });
  };
  try {
    const res = await onRequestGet({ request: new Request('https://example.com/api/public/v1/chip?symbol=600021&adjust=qfq&limit=90&refresh=1') });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.series.length, 90);
    assert.equal(body.latest.date, body.series.at(-1).date);
    assert.equal(body.previous.date, body.series.at(-2).date);
    assert.equal(body.profit_ratio_change_pp, +(body.latest.profit_ratio_pct - body.previous.profit_ratio_pct).toFixed(2));
  } finally {
    globalThis.fetch = previous;
  }
});

test('chip route validates A-share symbol before upstream fetch', async () => {
  clearChipCache();
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}'); };
  try {
    for (const symbol of ['abc', '00700', '830001', '600021,000001']) {
      const res = await onRequestGet({ request: new Request(`https://example.com/api/public/v1/chip?symbol=${encodeURIComponent(symbol)}`) });
      assert.equal(res.status, 400);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test('missing circulating shares returns sanitized no-store error', async () => {
  clearChipCache();
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('qt.gtimg.cn')) return quoteResponse({ floatMv: 0 });
    if (value.includes('/appstock/app/kline/kline')) {
      return tencentKlineResponse('day', [['2026-08-07', '10', '11', '12', '9', '1000']]);
    }
    return new Response('{}', { status: 520 });
  };
  try {
    const res = await onRequestGet({ request: new Request('https://example.com/api/public/v1/chip?symbol=600021') });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.message, 'chip data unavailable');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-chip-error'), null);
  } finally {
    globalThis.fetch = previous;
  }
});

test('chip cache coalesces concurrent requests and refresh bypasses stored result', async () => {
  clearChipCache();
  const previous = globalThis.fetch;
  let klineCalls = 0;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('qt.gtimg.cn')) return quoteResponse();
    if (value.includes(',qfq')) {
      klineCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return tencentKlineResponse('qfqday', GOLDEN_ROWS.map((r) => [r.date, r.open, r.close, r.high, r.low, '1000']));
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const request = () => onRequestGet({ request: new Request('https://example.com/api/public/v1/chip?symbol=600021&adjust=qfq') });
    const [a, b] = await Promise.all([request(), request()]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(klineCalls, 1);
    const hit = await request();
    assert.equal(hit.headers.get('x-chip-cache'), 'HIT');
    assert.equal(klineCalls, 1);
    const refreshed = await onRequestGet({ request: new Request('https://example.com/api/public/v1/chip?symbol=600021&adjust=qfq&refresh=1') });
    assert.equal(refreshed.status, 200);
    assert.equal(klineCalls, 2);
  } finally {
    globalThis.fetch = previous;
  }
});

test('Yahoo continuous aliases remain available in the shared parser', () => {
  assert.equal(parseSymbol('SI=F').tencent, 'hf_XAG');
  assert.equal(parseSymbol('GC=F').tencent, 'hf_XAU');
  assert.equal(parseSymbol('CL=F').tencent, 'hf_CL');
});

test('AkShare total-zero semantics return zero costs', () => {
  const series = computeChipDistributionSeries([
    { date: '2026-08-07', open: 10, close: 10, high: 10, low: 10, hsl: 0 },
  ], 90);
  assert.deepEqual(series[0], {
    date: '2026-08-07', profit_ratio_pct: 0, average_cost: 0,
    average_cost_deviation_pct: -100, cost_90_low: 0, cost_90_high: 0,
    concentration_90_pct: 0, cost_70_low: 0, cost_70_high: 0,
    concentration_70_pct: 0,
  });
});

test('limit one still returns adjacent previous and same-calculator change', async () => {
  clearChipCache();
  const rows = GOLDEN_ROWS.map((r) => [r.date, r.open, r.close, r.high, r.low, '1000']);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('qt.gtimg.cn')) return quoteResponse();
    if (value.includes(',qfq')) return tencentKlineResponse('qfqday', rows);
    return new Response('{}', { status: 404 });
  };
  try {
    const res = await onRequestGet({ request: new Request('https://example.com/api/public/v1/chip?symbol=600021&adjust=qfq&limit=1&refresh=1') });
    const body = await res.json();
    assert.equal(body.series.length, 1);
    assert.equal(body.latest.date, '2026-08-07');
    assert.equal(body.previous.date, '2026-08-06');
    assert.equal(typeof body.profit_ratio_change_pp, 'number');
  } finally { globalThis.fetch = previousFetch; }
});

test('limit requires a canonical integer token', async () => {
  for (const limit of ['1.0', '01', '1e0', '90.0']) {
    const res = await onRequestGet({ request: new Request(`https://example.com/api/public/v1/chip?symbol=600021&limit=${limit}`) });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('concurrent refresh requests bypass stored data and still coalesce in-flight work', async () => {
  clearChipCache();
  const previous = globalThis.fetch;
  let klineCalls = 0;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('qt.gtimg.cn')) return quoteResponse();
    if (value.includes(',qfq')) {
      klineCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return tencentKlineResponse('qfqday', GOLDEN_ROWS.map((r) => [r.date, r.open, r.close, r.high, r.low, '1000']));
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const request = () => onRequestGet({ request: new Request('https://example.com/api/public/v1/chip?symbol=600021&adjust=qfq&refresh=1') });
    const [a, b] = await Promise.all([request(), request()]);
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(klineCalls, 1);
    assert.deepEqual(new Set([a.headers.get('x-chip-cache'), b.headers.get('x-chip-cache')]), new Set(['BYPASS', 'COALESCED']));
    assert.equal(a.headers.get('cache-control'), 'no-store');
    assert.equal(b.headers.get('cache-control'), 'no-store');
  } finally { globalThis.fetch = previous; }
});
