import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../src/index.js';

const env = { THS_API_TOKEN: 'test-secret' };

function request(path, token = 'test-secret') {
  return new Request(`https://example.com${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

test('internal THS routes require bearer authentication', async () => {
  const response = await onRequestGet({
    request: request('/api/internal/v1/ths/mainflow?code=600021&market=17', ''),
    env,
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'UNAUTHORIZED');
});

test('internal THS kline validates code before upstream fetch', async () => {
  const response = await onRequestGet({
    request: request('/api/internal/v1/ths/kline?code=../../bad&period=2026'),
    env,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'BAD_REQUEST');
});

test('internal THS rejects non-GET methods and supports CORS preflight', async () => {
  const post = await onRequestGet({ request: new Request('https://example.com/api/internal/v1/ths/kline', { method: 'POST' }), env });
  assert.equal(post.status, 405);
  const options = await onRequestGet({ request: new Request('https://example.com/api/internal/v1/ths/kline', { method: 'OPTIONS' }), env });
  assert.equal(options.status, 204);
  assert.match(options.headers.get('access-control-allow-methods'), /GET/);
});

test('internal THS resolves A-share last kline to the current year', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/17_600021\/01\/2026\.js/);
    return new Response('callback({"name":"上海电力","data":"20260813,14.4,14.8,14.3,14.5,110,220,1.3,,,0"})');
  };
  try {
    const response = await onRequestGet({ request: request('/api/internal/v1/ths/kline?code=17_600021&period=last'), env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).count, 1);
  } finally { globalThis.fetch = previous; }
});

test('internal THS kline parses JSONP and exposes normalized records', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /d\.10jqka\.com\.cn\/v6\/line\/17_600021\/01\/2026\.js/);
    return new Response('callback({"name":"上海电力","data":"20260812,14.2,14.5,14.1,14.4,100,200,1.2,,,0;20260813,14.4,14.8,14.3,14.5,110,220,1.3,,,0"})');
  };
  try {
    const response = await onRequestGet({
      request: request('/api/internal/v1/ths/kline?code=17_600021&period=2026'),
      env,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.equal(body.records[1].close, 14.5);
    assert.equal(body.records[1].volume_hands, 110);
    assert.equal(body.records[1].turnover_percent, 1.3);
  } finally {
    globalThis.fetch = previous;
  }
});

test('internal THS chip-list returns latest summary and curve', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /chip_list\?chip_type=all/);
    return Response.json({ status_code: 0, data: { list: {
      20260813: { summary: { close_price: 14.5, average_cost: 15.1 }, curve_data: { list: [{ price: 14, jeton: 10 }] } },
    } } });
  };
  try {
    const response = await onRequestGet({
      request: request('/api/internal/v1/ths/chip-list?code=600021&market=17&days=90'), env,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.last_date, '20260813');
    assert.equal(body.curve.length, 1);
  } finally { globalThis.fetch = previous; }
});

test('internal THS mainflow normalizes cost and profit fields', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 0, data: {
    date: '2026-08-13', mainHoldCostAvgPrice: 13.25,
    mainHoldCostProfitRatio: 0.8123, closePrice: 14.5, new40: 1,
  } });
  try {
    const response = await onRequestGet({
      request: request('/api/internal/v1/ths/mainflow?code=600021&market=17'), env,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.main_cost, 13.25);
    assert.equal(body.main_profit_ratio, 81.23);
    assert.equal(body.main_avg_profit_pct, 9.43);
  } finally { globalThis.fetch = previous; }
});

test('internal THS preserves null mainflow fields as null', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 0, data: { mainHoldCostAvgPrice: null, mainHoldCostProfitRatio: '', closePrice: null } });
  try {
    const response = await onRequestGet({ request: request('/api/internal/v1/ths/mainflow?code=600021&market=17'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.main_cost, null);
    assert.equal(body.main_profit_ratio, null);
    assert.equal(body.close_price, null);
  } finally { globalThis.fetch = previous; }
});

test('internal THS capital-tab returns compact financing and block-trade data', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status_msg: 'ok',
    lhb: { date: '2026-08-01', recent_record_count: 1, net_inflow: '10' },
    rzlx: { date: '2026-08-13', recent_net_inflow: '2', net_inflow_list: { day_3: '3', day_5: '5' }, chart: [] },
    dzjy: { list: [{ date: '2026-08-12', premium_rate: '1.2' }], last_day: { date: '2026-08-12' } },
  });
  try {
    const response = await onRequestGet({
      request: request('/api/internal/v1/ths/capital-tab?code=600021'), env,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.rzlx.net_3d, '3');
    assert.equal(body.dzjy.list.length, 1);
  } finally { globalThis.fetch = previous; }
});
