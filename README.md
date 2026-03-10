# Jigsaw-like DOM Prototype

一个可直接在现代浏览器中运行的 TypeScript + WebGL 交易面板原型，目标是接近 Jigsaw 的 DOM 呈现方式：

- 红蓝挂单柱（左右盘口深度）
- Footprint（中间成交量列与 Delta 高亮）
- 高频 Mock 订单流（增/撤/成交）
- 我的挂单高亮与队列排名
- 鼠标点击价格行下单模拟

## 运行

```bash
tsc
python3 -m http.server 5173
```

访问 <http://localhost:5173>

## 模块

- `src/OrderBook.ts`: 盘口状态 + 成交累计
- `src/MockDataGenerator.ts`: 高频事件流（80ms，支持批量爆发）
- `src/MyOrderManager.ts`: 我的订单与 queue ahead/remaining 更新
- `src/DOMRenderer.ts`: WebGL 绘制柱图、热区，Canvas 文本层/点击交互
- `src/main.ts`: 启动、连接模块、渲染循环
