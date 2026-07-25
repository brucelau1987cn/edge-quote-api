# Edge Quote API (Cloudflare Workers / Pages Functions)

极速、零服务器依赖的**全市场（A股、港股、美股、内外盘期货）**实时行情代理 API，基于 Cloudflare Edge Serverless 架构。

## 🌟 特性
- ⚡ **全球边缘毫秒级响应**：运行在 Cloudflare Edge Function 节点。
- 🌏 **支持全市场标的**：
  - **A 股 / ETF**：支持 `600021.SH` / `159915.SZ` 或纯代码 `600021` 自动识别
  - **港股**：支持 `00700.HK`、`hk00700` 或 5 位数字 `00700` 自动识别
  - **美股**：支持 `AAPL.US`、`usAAPL` 或纯英文 `AAPL` 自动识别
  - **期货**：外盘期货（如 `hf_CL` 原油、`hf_GC` 黄金）、内盘期货（如 `nf_AU0` 沪金主连）
- 📦 **支持单只与批量请求**：支持逗号分隔批量传参，单次最高可查 50 只标的。
- 🚀 **内置 5s 边缘缓存与 CORS 跨域支持**：原生支持网页端直接 Fetch 调用。

---

## 📡 API 参数与使用说明

### `GET /api/public/v1/quote`

#### 1. 请求参数
- `symbols` / `symbol`: 标的代码（支持逗号分隔批量查询）
- `exchange`（可选）: 默认交易所（`SSE` / `SZSE`）

#### 2. 调用示例

```bash
# 1. 查 A 股与 ETF
curl "https://<your-worker>.workers.dev/api/public/v1/quote?symbols=600021.SH,159915.SZ"

# 2. 查港股与美股
curl "https://<your-worker>.workers.dev/api/public/v1/quote?symbols=00700.HK,AAPL.US"

# 3. 查外盘期货 (WTI原油) 与内盘黄金
curl "https://<your-worker>.workers.dev/api/public/v1/quote?symbols=hf_CL,nf_AU0"

# 4. 全市场跨品类混合查询
curl "https://<your-worker>.workers.dev/api/public/v1/quote?symbols=600021,00700,AAPL,hf_CL"
```

#### 3. 响应 JSON 示例
```json
{
  "status": "ok",
  "count": 3,
  "quotes": {
    "600021": {
      "symbol": "600021",
      "sec_code": "sh600021",
      "name": "上海电力",
      "market": "A-SHARE",
      "price": 14.21,
      "prev_close": 15.34,
      "open": 15.1,
      "high": 15.11,
      "low": 14.2,
      "change_amount": -1.13,
      "change_percent": -7.37,
      "quote_time": "2026-07-24T16:14:56+08:00",
      "status": "ok"
    },
    "00700": {
      "symbol": "00700",
      "sec_code": "hk00700",
      "name": "腾讯控股",
      "market": "HK-SHARE",
      "price": 434.6,
      "prev_close": 445.2,
      "change_percent": -2.38,
      "quote_time": "2026-07-24T16:08:10+08:00",
      "status": "ok"
    },
    "hf_CL": {
      "symbol": "hf_CL",
      "sec_code": "hf_CL",
      "name": "纽约原油",
      "market": "FUTURES",
      "price": 90.72,
      "prev_close": 92.55,
      "change_percent": -1.98,
      "quote_time": "2026-07-25T04:59:58+08:00",
      "status": "ok"
    }
  }
}
```

---

## 🛠️ 本地开发与部署

```bash
# 1. 克隆项目与安装依赖
git clone https://github.com/brucelau1987cn/edge-quote-api.git
cd edge-quote-api
npm install

# 2. 运行单元测试
npm test

# 3. 本地启动 Wrangler 调试
npm run dev

# 4. 部署至 Cloudflare Workers
npm run deploy
```

## 📄 License
MIT License
