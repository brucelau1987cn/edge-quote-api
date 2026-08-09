import { connect } from 'cloudflare:sockets';
import {
  buildBaoStockMessage,
  expectedBaoStockFrameLength,
  parseBaoStockResponseBytes,
  parseHistoryResponse,
} from '../../src/baostock.js';

const SEP = '\x01';
const enc = new TextEncoder();

async function readFrame(reader, timeoutMs = 10000) {
  const chunks = [];
  let size = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('baostock read timeout')), remaining)),
    ]);
    if (result.done) break;
    chunks.push(result.value);
    size += result.value.length;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const expected = expectedBaoStockFrameLength(bytes);
    if (expected === -1) throw new Error('invalid baostock frame');
    if (expected && size >= expected) return bytes.slice(0, expected);
  }
  throw new Error('truncated baostock frame');
}

async function sendAndRead(writer, reader, type, body) {
  await writer.write(enc.encode(buildBaoStockMessage(type, body)));
  return parseBaoStockResponseBytes(await readFrame(reader));
}

async function probe(symbol, requestedAdjust) {
  const socket = connect({ hostname: 'public-api.baostock.com', port: 10030 });
  await socket.opened;
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    const login = await sendAndRead(writer, reader, '00', ['login', 'anonymous', '123456', '0'].join(SEP));
    if (login.fields[0] !== '0') throw new Error(`login ${login.fields[0]}`);
    const userId = login.fields[3];
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 500 * 86400000).toISOString().slice(0, 10);
    const adjusts = requestedAdjust === 'all' ? ['none', 'qfq', 'hfq'] : [requestedAdjust];
    const results = {};
    for (const adjust of adjusts) {
      const flag = { none: '3', qfq: '2', hfq: '1' }[adjust];
      if (!flag) throw new Error('invalid adjust');
      const body = ['query_history_k_data_plus', userId, '1', '2000', symbol,
        'date,open,high,low,close,volume,amount,turn', start, end, 'd', flag].join(SEP);
      const response = await sendAndRead(writer, reader, '95', body);
      const rows = parseHistoryResponse(response, adjust);
      results[adjust] = { rows: rows.length, latest: rows.at(-1), first: rows[0] };
    }
    return { symbol, results };
  } finally {
    try { writer.releaseLock(); } catch {}
    try { reader.releaseLock(); } catch {}
    await socket.close();
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/resolve') {
      try {
        const response = await fetch('https://cloudflare-dns.com/dns-query?name=public-api.baostock.com&type=A', { headers: { accept: 'application/dns-json' } });
        return Response.json(await response.json());
      } catch (error) { return Response.json({ error: error.message }, { status: 502 }); }
    }
    try {
      const symbol = url.searchParams.get('symbol') || 'sh.600021';
      const adjust = url.searchParams.get('adjust') || 'all';
      return Response.json({ status: 'ok', ...(await probe(symbol, adjust)) });
    } catch (error) {
      return Response.json({ status: 'error', message: error.message }, { status: 502 });
    }
  },
};
