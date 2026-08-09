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
- A 股筹码分布 V2：不复权 / QFQ / HFQ、最近 90 个交易日序列、同口径昨日变化、严格校验与请求合并。

## 双入口导出（Workers + Pages）

`src/index.js` 同时导出：

- `onRequestGet({ request })` — Cloudflare **Pages Functions**
- `default.fetch(request)` — Cloudflare **Workers**

集成到 [etf-rotation-blog](https://github.com/brucelau1987cn/etf-rotation-blog) 时，在 blog 仓库执行：

```sh
npm run sync:quote
# 将本仓库 src/index.js / src/chip.js 同步到
# etf-rotation-blog/functions/api/public/v1/quote.js
# etf-rotation-blog/functions/api/public/v1/chip.js
# etf-rotation-blog/functions/api/public/v1/_chip.js
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
- **次路径**：`https://edge-quote-api.brucelau1987.workers.dev`（独立 Worker，已部署）
- 双活验证：`npm run verify:dual`
- 凭证约定（本机，不入库）：
  - Pages：`~/.hermes/credentials/cloudflare-pages.env`（`CLOUDFLARE_API_TOKEN`）
  - Workers：`~/.hermes/credentials/cloudflare-global.env`（`CLOUDFLARE_EMAIL` + `CLOUDFLARE_API_KEY`）

### 双活命令

```sh
# 验证 Pages 主路径 + Worker 次路径
npm run verify:dual

# 部署/更新独立 Worker，并验证双活
# 优先读取 ~/.hermes/credentials/cloudflare-global.env
npm run deploy:dual
```

Worker 认证任选其一：

1. **Global API Key**（本机已用于首次双活上线）  
   `CLOUDFLARE_EMAIL` + `CLOUDFLARE_API_KEY`
2. **API Token**（更推荐长期）：Account → **Workers Scripts → Edit**

标准发布链路（前端仍走 Pages 同源 quote）：

```sh
# edge-quote-api
OFFLINE=1 npm test
npm run deploy:dual
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

### `GET /api/public/v1/chip`

A 股筹码分布 V2。Worker 与 Pages 主接口使用同一源文件和响应契约：

- Worker：`https://edge-quote-api.brucelau1987.workers.dev/api/public/v1/chip`
- Pages：`https://etf.peekabo.cc/api/public/v1/chip`

参数：

- `symbol`：沪深六位 A 股代码，首期支持 `00` / `30` / `60` / `68` 开头。
- `adjust`：`""`（不复权）、`qfq`、`hfq`。
- `limit`：规范整数 `1–90`，默认 `90`；`01`、`1.0`、`1e0` 会被拒绝。
- `refresh=1` / `nocache=1`：跳过已完成缓存，相同在途计算继续合并；响应使用 `no-store`。

```bash
curl "https://edge-quote-api.brucelau1987.workers.dev/api/public/v1/chip?symbol=600021&adjust=qfq&limit=90"
curl "https://etf.peekabo.cc/api/public/v1/chip?symbol=600021&adjust=hfq&limit=1&refresh=1"
```

主要响应字段：

- `series`：最近 `limit` 个交易日，按时间升序。
- `latest` / `previous`：同一算法、同一复权口径的相邻交易日；`limit=1` 仍返回 `previous`。
- `profit_ratio_change_pp`：最新与昨日获利盘的百分点变化。
- `source` / `algorithm` / `assumptions`：数据源、算法和换手率假设。
- `x-chip-cache`：`MISS` / `HIT` / `BYPASS` / `COALESCED`。

## 筹码 V2 注意事项

- 腾讯路径用“每日成交量 ÷ 当前流通股本”估算历史换手率。股本变动期间可能产生偏差；响应中的 `assumptions.turnover_source` 会明确标注。
- 腾讯失败时才尝试东财 `push2his`；该上游在部分网络环境可能返回 HTTP 520。
- 错误响应经过脱敏并设置 `Cache-Control: no-store`，提供商细节只写入 Worker 结构化日志。
- `src/index.js` 与 `src/chip.js` 是唯一源。Pages 同步必须让 import 和 re-export 都指向 `./_chip.js`，避免 `chip.js` 路由自引用循环。
- `SI=F` / `GC=F` / `CL=F` 连续合约别名需在 quote、chip、kline 三个生成模块中保持一致。
- Worker 和 Pages 是两个独立部署目标。修改后分别部署，并对两个入口用相同参数比较状态码、JSON 字段和缓存头。
- Cloudflare 凭据只放在本机凭据文件或 CI Secret，严禁提交 Global API Key、API Token、邮箱密钥组合。

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
