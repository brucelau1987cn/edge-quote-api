# Edge Quote API (Cloudflare Workers / Pages Functions)

极速、零服务器依赖的股票与 ETF 实时行情代理 API，基于 Cloudflare Edge Serverless 架构。

## 🌟 特性
- ⚡ **全球边缘毫秒级响应**：运行在 Cloudflare Edge Function 节点。
- 📦 **支持单个与批量标的**：自动补全 `.SH` / `.SZ` 交易所后缀，最高支持单次 50 只标的。
- 🚀 **内置 5s 缓存与自动重试**：有效降低上游压力并加速客户端重复请求。
- 🔄 **支持多种输出格式**：包含最新价、开盘价、最高最低、昨收、涨跌幅、成交量及带 ISO 时区的时间戳。

## 🚀 部署方式

### 使用 Cloudflare Wrangler 部署为独立 Worker / Pages

```bash
# 安装依赖
npm install

# 本地调试
npx wrangler dev

# 部署至 Cloudflare Workers
npx wrangler deploy
```

## 📡 API 使用说明

### `GET /api/public/v1/quote`

#### 请求参数：
- `symbols` / `symbol`: 股票或 ETF 代码，支持逗号分隔批量传参（例如 `600021.SH,517520.SH,159915.SZ`）。
- `exchange`（可选）: 默认交易所（`SSE` 或 `SZSE`），当代码不带后缀时自动识别。

#### 响应示例：
```json
{
  "status": "ok",
  "count": 2,
  "quotes": {
    "600021": {
      "symbol": "600021",
      "sec_code": "sh600021",
      "name": "上海电力",
      "price": 14.21,
      "prev_close": 15.34,
      "open": 15.1,
      "high": 15.11,
      "low": 14.2,
      "change_amount": -1.13,
      "change_percent": -7.37,
      "volume_hands": 789177,
      "quote_time": "2026-07-24T16:14:56+08:00",
      "status": "ok"
    }
  }
}
```
