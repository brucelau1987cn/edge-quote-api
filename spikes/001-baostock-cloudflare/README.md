# BaoStock TCP on Cloudflare

## Verdict: VALIDATED

Cloudflare Workers/Pages Functions can connect directly to `public-api.baostock.com:10030` with `cloudflare:sockets`, perform anonymous login, decode zlib responses, and query unadjusted/QFQ/HFQ daily bars with daily turnover.

## Production evidence

- Spike Worker: `baostock-tcp-spike.brucelau1987.workers.dev`
- Tested symbol: `sh.600021`
- All three modes returned 333 rows through one TCP session.
- Latest date: `2026-08-07`
- Daily turnover: `1.276%`

## Recommendation

Use Tencent as the primary chip source and BaoStock TCP as the Cloudflare-native fallback. Keep provider-specific source and turnover assumptions explicit in the response. No local or Tianyi HTTP proxy is required.
