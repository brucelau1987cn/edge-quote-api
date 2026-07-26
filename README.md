# Edge Quote API (Cloudflare Workers / Pages Functions)

极速、零服务器依赖的**全市场（A股、港股、美股、内外盘期货）**实时行情代理 API，基于 Cloudflare Edge Serverless 架构。

## 特性
- 全球边缘毫秒级响应：运行在 Cloudflare Edge Function 节点。
- 支持全市场标的：
  - **A 股 / ETF**：`600021.SH` / `159915.SZ` 或纯代码 `600021`
  - **港股**：`00700.HK`、`hk00700` 或 5 位数字 `00700`
  - **美股**：`AAPL.US`、`usAAPL` 或纯英文 `AAPL`
  - **期货**：外盘（`hf_CL`）与内盘（`nf_AU0`）
- 单只与批量请求：逗号分隔，单次最高 50 只。
- 三源降级：腾讯 → 新浪 → 雪球（自动抓取访客 token）。
- 双层短缓存：L1 isolate 内存 Map + L2 `caches.default`（开市 4s / 休市 30s / 周末 60s）。
- 可观测响应头：`x-quote-cache` / `x-quote-cache-layer` / `x-quote-source`。
- 强制刷新：`?nocache=1` 或 `?refresh=1`。
- 5s CDN `cache-control` 与 CORS。

## 双入口导出（Workers + Pages）

`src/index.js` 同时导出：

- `onRequestGet({ request })` — Cloudflare **Pages Functions**
- `default.fetch(request)` — Cloudflare **Workers**

集成到 [etf-rotation-blog](https://github.com/brucelau1987cn/etf-rotation-blog) 时，在 blog 仓库执行：

```sh
npm run sync:quote
# 将本仓库 src/index.js 同步到
# etf-rotation-blog/functions/api/public/v1/quote.js
```

**本仓库是行情逻辑唯一源**。不要只在 blog 的 `functions/` 里改 quote 实现。

## 部署条件

1. Cloudflare 账号（免费额度可用）
2. Node.js 18+
3. 模式：

| 部署模式 | 适用场景 | 命令 / 路径 |
| :--- | :--- | :--- |
| Workers | 独立 API（可选双活） | `npm run deploy` / `npm run deploy:dual` |
| Pages Functions | **当前生产主路径** | 同步到 blog `functions/api/public/v1/quote.js` |

### 当前生产状态

- **主路径**：`https://etf.peekabo.cc/api/public/v1/quote`（blog Pages Functions）
- **次路径**：独立 Worker `edge-quote-api`（需 Workers 写权限 token）
- 本机 Pages token 可部署 Pages，但目前 **不能** 写 Workers services（`Authentication error [code: 10000]`）

### 双活命令

```sh
# 仅验证：Pages 主路径必测；若设置了 EDGE_QUOTE_WORKER_URL 再测 Worker
npm run verify:dual

# 尝试部署 Worker + 验证（需要 Workers Scripts:Edit token）
export CLOUDFLARE_API_TOKEN=...
npm run deploy:dual
```

Worker token 最小权限：

- Account → **Workers Scripts → Edit**
- Account → Account Settings → Read（推荐）
- User → Memberships → Read（推荐）

在 Worker 写权限补齐前，标准发布链路保持：

```sh
# edge-quote-api
OFFLINE=1 npm test
git push

# etf-rotation-blog
npm run sync:quote
npm run deploy:pages
npm run verify:pages
```

站点侧完整契约：  
[`docs/deploy-cache-probe-contract.md`](https://github.com/brucelau1987cn/etf-rotation-blog/blob/main/docs/deploy-cache-probe-contract.md)

## API

### `GET /api/public/v1/quote`

参数：
- `symbols` / `symbol`：逗号分隔代码
- `exchange`（可选）：默认 `SSE` / `SZSE`
- `nocache=1` / `refresh=1`（可选）：绕过短缓存

示例：

```bash
curl "https://<your-domain>/api/public/v1/quote?symbols=600021.SH,159915.SZ"
curl "https://<your-domain>/api/public/v1/quote?symbols=00700.HK,AAPL.US"
curl "https://<your-domain>/api/public/v1/quote?symbols=hf_CL,nf_AU0"
curl -I "https://<your-domain>/api/public/v1/quote?symbols=600021&exchange=SSE"
```

缓存响应头示例：

```http
x-quote-cache: HIT
x-quote-cache-layer: edge
x-quote-cache-age-ms: 812
x-quote-source: tencent
x-quote-cache-ttl-ms: 30000
x-quote-cache-session: closed
```

站点侧部署/探针契约见 blog 仓库：
[`docs/deploy-cache-probe-contract.md`](https://github.com/brucelau1987cn/etf-rotation-blog/blob/main/docs/deploy-cache-probe-contract.md)

响应：

```json
{
  "status": "ok",
  "source": "tencent",
  "count": 1,
  "quotes": {
    "600021": {
      "symbol": "600021",
      "sec_code": "sh600021",
      "name": "上海电力",
      "market": "A-SHARE",
      "price": 14.21,
      "prev_close": 15.34,
      "change_percent": -7.37,
      "quote_time": "2026-07-24T16:14:56+08:00",
      "status": "ok"
    }
  }
}
```

前端请用 blog 的 `normalizeQuotePayload` 统一转成 `{ ok, items }`，避免各页各自解析。

## 本地开发

```sh
npm install
npm test
npm run dev
npx wrangler login
npm run deploy
```

## License
MIT License
