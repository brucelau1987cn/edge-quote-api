import assert from 'node:assert';
import { test } from 'node:test';
import { fetchQuote, getXueqiuToken, parseSymbol } from '../src/index.js';

test('parseSymbol auto-detects markets and maps to all three sources', () => {
  const p1 = parseSymbol('600021.SH');
  assert.strictEqual(p1.tencent, 'sh600021');
  assert.strictEqual(p1.sina, 'sh600021');
  assert.strictEqual(p1.xueqiu, 'SH600021');

  const p2 = parseSymbol('AAPL.US');
  assert.strictEqual(p2.tencent, 'usAAPL');
  assert.strictEqual(p2.sina, 'gb_aapl');
  assert.strictEqual(p2.xueqiu, 'AAPL');

  const p3 = parseSymbol('00700.HK');
  assert.strictEqual(p3.tencent, 'hk00700');
  assert.strictEqual(p3.sina, 'hk00700');
  assert.strictEqual(p3.xueqiu, '00700');
});

test('getXueqiuToken auto-fetches token from xueqiu.com', async () => {
  const token = await getXueqiuToken();
  assert.ok(token, 'Token should be auto fetched without user configuration');
  assert.strictEqual(typeof token, 'string');
  assert.ok(token.length > 5);
});

test('fetchQuote returns structured data and falls back gracefully', async () => {
  const result = await fetchQuote('600021.SH,00700.HK,AAPL.US,hf_CL');
  assert.strictEqual(result.status, 'ok');
  assert.ok(['tencent', 'sina', 'xueqiu'].includes(result.source));
  assert.ok(result.quotes['600021']);
  assert.ok(result.quotes['00700']);
});
