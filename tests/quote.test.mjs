import assert from 'node:assert';
import { test } from 'node:test';
import { fetchQuote } from '../src/index.js';

test('fetchQuote returns structured quote data for valid symbol', async () => {
  const result = await fetchQuote('600021.SH');
  assert.strictEqual(result.status, 'ok');
  assert.ok(result.quotes['600021']);
  assert.strictEqual(result.quotes['600021'].symbol, '600021');
});

test('fetchQuote supports batch symbols', async () => {
  const result = await fetchQuote('600021.SH,159915.SZ');
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.count, 2);
  assert.ok(result.quotes['600021']);
  assert.ok(result.quotes['159915']);
});
