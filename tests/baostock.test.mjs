import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  BAOSTOCK_HEADER_LENGTH,
  buildBaoStockMessage,
  parseBaoStockResponseBytes,
  parseHistoryResponse,
} from '../src/baostock.js';

const SEP = '\x01';

function responseFrame(type, body, compressed = false) {
  const bodyBytes = compressed ? deflateSync(Buffer.from(body)) : Buffer.from(body);
  const header = `00.9.30${SEP}${type}${SEP}${String(bodyBytes.length).padStart(10, '0')}`;
  assert.equal(Buffer.byteLength(header), BAOSTOCK_HEADER_LENGTH);
  return Buffer.concat([Buffer.from(header), bodyBytes, Buffer.from(compressed ? '<![CDATA[]]>\n' : '\n')]);
}

test('buildBaoStockMessage matches the documented header/body/crc framing', () => {
  const body = ['login', 'anonymous', '123456', '0'].join(SEP);
  const message = buildBaoStockMessage('00', body);
  assert.match(message, /^00\.9\.30\x0100\x01\d{10}login\x01anonymous\x01123456\x010\x01\d+\n$/);
  assert.ok(message.includes(`${SEP}${String(Buffer.byteLength(body)).padStart(10, '0')}login`));
});

test('parseBaoStockResponseBytes handles plain login response and server patch version', async () => {
  const body = ['0', 'success', 'login', 'anonymous'].join(SEP);
  const frame = responseFrame('01', body);
  frame.set(Buffer.from('00.9.00'), 0);
  const parsed = await parseBaoStockResponseBytes(frame);
  assert.equal(parsed.type, '01');
  assert.deepEqual(parsed.fields, ['0', 'success', 'login', 'anonymous']);
});

test('parseBaoStockResponseBytes inflates compressed history response', async () => {
  const records = { record: [['2026-08-07', '14.7000', '14.8800', '14.5800', '14.8700', '36007451', '1.276000']] };
  const body = ['0', 'success', 'query_history_k_data_plus', 'anonymous', '1', '2000', JSON.stringify(records), 'sh.600021', 'date,open,high,low,close,volume,turn', '2026-08-07', '2026-08-07', 'd', '2'].join(SEP);
  const parsed = await parseBaoStockResponseBytes(responseFrame('96', body, true));
  const result = parseHistoryResponse(parsed, 'qfq');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    date: '2026-08-07', open: 14.7, high: 14.88, low: 14.58, close: 14.87,
    volume: 36007451, hsl: 1.276,
  });
});

test('parseHistoryResponse rejects provider errors and malformed rows', async () => {
  const errorBody = ['10004011', 'invalid code'].join(SEP);
  const parsedError = await parseBaoStockResponseBytes(responseFrame('96', errorBody, true));
  assert.throws(() => parseHistoryResponse(parsedError, ''), /baostock error/);

  const records = { record: [['2026-08-07', '14.7']] };
  const body = ['0', 'success', 'query_history_k_data_plus', 'anonymous', '1', '2000', JSON.stringify(records), 'sh.600021', 'date,open,high,low,close,volume,turn', '2026-08-07', '2026-08-07', 'd', '3'].join(SEP);
  const parsed = await parseBaoStockResponseBytes(responseFrame('96', body, true));
  assert.throws(() => parseHistoryResponse(parsed, ''), /invalid baostock row/);
});
