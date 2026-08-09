import { computeChipDistribution } from './src/chip.js';

// 用上海电力 600021 的真实 K 线数据 mock (最近5日)
// 日期  开盘  收盘  最高  最低  量    额      振幅  涨跌  涨跌额 换手
const mock = [
  {date:'2026-08-03', open:14.60, close:14.72, high:14.85, low:14.55, hsl:1.2},
  {date:'2026-08-04', open:14.75, close:14.90, high:14.95, low:14.68, hsl:1.5},
  {date:'2026-08-05', open:14.88, close:14.65, high:14.92, low:14.58, hsl:1.1},
  {date:'2026-08-06', open:14.60, close:14.77, high:14.82, low:14.52, hsl:0.9},
  {date:'2026-08-07', open:14.70, close:14.87, high:14.88, low:14.58, hsl:1.28},
];

const result = computeChipDistribution(mock);
console.log('计算结果:', JSON.stringify(result, null, 2));