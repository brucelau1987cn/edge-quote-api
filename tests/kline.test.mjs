import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeShanghaiMinuteKey,
  pickMinuteBar,
  fetchKline1m,
  onRequestGet,
  clearKlineCache,
} from '../src/index.js';

test('normalizeShanghaiMinuteKey accepts wall-clock and ISO/Z times', () => {
  assert.equal(normalizeShanghaiMinuteKey('2026-07-28 09:30:00'), '2026-07-28 09:30');
  assert.equal(normalizeShanghaiMinuteKey('2026-07-28T09:30:00'), '2026-07-28 09:30');
  assert.equal(normalizeShanghaiMinuteKey('202607281015'), '2026-07-28 10:15');
  // UTC 02:15 => Asia/Shanghai 10:15
  assert.equal(normalizeShanghaiMinuteKey('2026-07-28T02:15:07.359Z'), '2026-07-28 10:15');
});

test('pickMinuteBar returns exact or previous same-day bar', () => {
  const bars = [
    { minute: '2026-07-28 09:30', close: 10.1 },
    { minute: '2026-07-28 09:31', close: 10.2 },
    { minute: '2026-07-28 10:15', close: 11.5 },
    { minute: '2026-07-29 09:30', close: 12.0 },
  ];
  assert.equal(pickMinuteBar(bars, '2026-07-28 10:15').close, 11.5);
  assert.equal(pickMinuteBar(bars, '2026-07-28 10:16').close, 11.5);
  assert.equal(pickMinuteBar(bars, '2026-07-28 09:00'), null);
  assert.equal(pickMinuteBar(bars, '2026-07-29T01:30:00.000Z').close, 12.0); // 09:30 SH
});

test('fetchKline1m merges Sina OHLC over Tencent and picks fixed minute', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = typeof url === 'string' ? url : url.url;
    if (value.includes('quotes.sina.cn')) {
      return Response.json([
        { day: '2026-07-28 10:14:00', open: '69.80', high: '69.90', low: '69.70', close: '69.85', volume: '1000' },
        { day: '2026-07-28 10:15:00', open: '69.86', high: '70.00', low: '69.51', close: '69.51', volume: '1097' },
      ]);
    }
    if (value.includes('kline/mkline')) {
      return Response.json({
        code: 0,
        data: {
          sz301511: {
            m1: [['202607281015', '69.90', '69.60', '70.10', '69.50', '1000.00', {}, '1']],
          },
        },
      });
    }
    if (value.includes('minute/query')) {
      return Response.json({
        code: 0,
        data: {
          sz301511: {
            data: { data: ['1015 69.55 100 1'] },
          },
        },
      });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const result = await fetchKline1m('301511', { at: '2026-07-28 10:15:00', limit: 100 });
    assert.equal(result.status, 'ok');
    assert.equal(result.interval, '1m');
    assert.equal(result.symbol, '301511');
    assert.equal(result.at_minute, '2026-07-28 10:15');
    // Sina overwrites Tencent for same minute.
    assert.equal(result.bar.close, 69.51);
    assert.equal(result.bar.source, 'sina-m1');
    assert.ok(result.count >= 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test('onRequestGet serves /kline path with compact fixed-time payload', async () => {
  clearKlineCache();
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = typeof url === 'string' ? url : url.url;
    if (value.includes('quotes.sina.cn')) {
      return Response.json([
        { day: '2026-07-28 09:30:00', open: '71.70', high: '71.80', low: '71.60', close: '71.73', volume: '611' },
      ]);
    }
    if (value.includes('ifzq.gtimg.cn') || value.includes('web.ifzq.gtimg.cn')) {
      return Response.json({ code: 0, data: {} });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const req = new Request('https://example.com/api/public/v1/kline?symbol=301511&at=2026-07-28%2009:30:00&nocache=1');
    const res = await onRequestGet({ request: req });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'ok');
    assert.equal(data.bar.close, 71.73);
    assert.equal(data.at_minute, '2026-07-28 09:30');
    assert.equal(data.bars, undefined);
  } finally {
    globalThis.fetch = previous;
  }
});
