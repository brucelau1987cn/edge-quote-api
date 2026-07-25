import assert from 'node:assert';
import { test } from 'node:test';
import { fetchQuote, parseSymbol } from '../src/index.js';

test('parseSymbol auto-detects markets correctly', () => {
  assert.deepStrictEqual(parseSymbol('600021.SH'), { secCode: 'sh600021', displayCode: '600021', type: 'a' });
  assert.deepStrictEqual(parseSymbol('159915.SZ'), { secCode: 'sz159915', displayCode: '159915', type: 'a' });
  assert.deepStrictEqual(parseSymbol('00700.HK'), { secCode: 'hk00700', displayCode: '00700', type: 'hk' });
  assert.deepStrictEqual(parseSymbol('AAPL.US'), { secCode: 'usAAPL', displayCode: 'AAPL', type: 'us' });
  assert.deepStrictEqual(parseSymbol('AAPL'), { secCode: 'usAAPL', displayCode: 'AAPL', type: 'us' });
  assert.deepStrictEqual(parseSymbol('hf_CL'), { secCode: 'hf_CL', displayCode: 'hf_CL', type: 'futures' });
});

test('fetchQuote returns multi-market quote data', async () => {
  const result = await fetchQuote('600021.SH,00700.HK,AAPL.US,hf_CL');
  assert.strictEqual(result.status, 'ok');
  assert.ok(result.quotes['600021']);
  assert.ok(result.quotes['00700']);
  assert.ok(result.quotes['AAPL.OQ'] || result.quotes['AAPL'] || result.quotes['usAAPL']);
  assert.ok(result.quotes['hf_CL']);
});
