# jigsaw2 - TypeScript + WebGL 交易面板原型

该项目是一个可在现代浏览器直接运行的前端交易面板原型，使用：

- **TypeScript**（源码位于 `src/`）
- **WebGL + Canvas 2D 双层渲染**（WebGL 画柱图/热力块，2D 画文本与交互标签）
- **HTML + Canvas** 容器
- **Mock 数据流**（定时器模拟订单增、撤、成交）

## 快速运行

1. 编译 TypeScript：

```bash
tsc
```

2. 启动静态服务：

```bash
python3 -m http.server 5173
```

3. 打开浏览器访问：

`http://localhost:5173`

## 功能

- 红蓝挂单面板（Bid/Ask Size 条形可视化）
- Footprint Delta 热力显示（买卖成交差值）
- 我的挂单高亮 + 队列排名 (`MyBid #N` / `MyAsk #N`)
- 点击价格行左半区（Bid）/右半区（Ask）下单模拟
- 高频数据更新（默认 80ms）与 `requestAnimationFrame` 渲染循环分离

## 模块结构

- `src/OrderBook.ts`：订单簿 + 成交量统计
- `src/MyOrderManager.ts`：我的订单与队列排名维护
- `src/MockDataGenerator.ts`：Mock 订单流事件生成
- `src/DOMRenderer.ts`：WebGL 图形渲染 + Canvas 文本层
- `src/main.ts`：应用初始化与主循环
