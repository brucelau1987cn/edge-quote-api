import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet, parseSymbol, fetchQuote, getXueqiuToken } from '../src/index.js';

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
  } finally {
    globalThis.fetch = previous;
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
