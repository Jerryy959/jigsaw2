# TypeScript + WebGL Jigsaw-like DOM Prototype

该原型按 Jigsaw DOM 的列逻辑组织（每行一个价格级别，支持高频刷新和滚动）：

1. 左侧蓝色买单柱（Bid Book）
2. 买方被动盘对应的卖方主动成交累计（SELL CUM）
3. 中间价格列（当前价格高亮，且上下 2 行联动高亮）
4. 卖方被动盘对应的买方主动成交累计（BUY CUM）
5. 右侧红色卖单柱（Ask Book）

## 支持功能

- 红蓝挂单柱（数量越大柱越长）
- Footprint 累计成交（买卖分列）
- 主动成交高亮动画（200~500ms 闪烁）
- 当前价格高亮 + 上下两行联动高亮
- 鼠标点击下单/撤单（同价同侧已有我的挂单则撤单）
- 我的挂单高亮 + 队列位置显示（#ahead+1）
- 高频 Mock 数据（70ms，可 burst）
- 鼠标滚轮上下滚动 price ladder
- 右上角“我的挂单”面板（多行展示 + 按钮撤单 + 下单手数调节，默认1手）
- 成交后弹出提示框（toast）显示已成交

## 运行

```bash
tsc
python3 -m http.server 5173
```

访问 <http://localhost:5173>

## 代码模块

- `src/OrderBook.ts`：盘口档位 + 成交累计 + 动画高亮时间戳
- `src/MyOrderManager.ts`：我的订单、撤单、queue ahead/remaining 更新
- `src/MockDataGenerator.ts`：可配置权重的 add/cancel/trade 随机流
- `src/MockMatchingEngine.ts`：模拟后端撮合服务（价格扫到挂单后按队列触发成交）
- `src/DOMRenderer.ts`：WebGL 绘制 + Canvas 文本层 + 点击/滚轮交互
- `src/main.ts`：启动、事件桥接、渲染循环
