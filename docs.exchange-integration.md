# 交易所真实数据接入方案（以 Binance 为例）

本文档说明如何把当前 DOM 原型从 `MockDataGenerator` 切到真实交易所数据，并给出可扩展到多交易所/后端总线（Kafka）/持久化（TimescaleDB）的架构。

## 1. 当前项目已经具备的接入点

本次代码新增了统一数据源接口 `MarketDataSource`：

- `start()`：启动订阅
- `stop()`：停止订阅
- `getName()`：用于日志和监控

并提供了 `BinanceMarketDataSource`，把 Binance 的深度和逐笔成交流映射为内部统一事件 `BookEvent`（`add/cancel/trade`）。

## 2. 快速试用：直接连接 Binance 公共流

### 2.1 启动

```bash
npm run build
npm run serve
```

访问：

- Mock 模式：`http://localhost:5173`
- Binance 模式：`http://localhost:5173?source=binance`

### 2.2 映射逻辑（已实现）

- `symbol@depth@100ms`
  - 对同价位维护本地缓存 `depthState`
  - 新值 > 旧值 -> `add`
  - 新值 < 旧值 -> `cancel`
- `symbol@trade`
  - `m=true`（买方是挂单方）=> 主动卖 -> `side='ask'`
  - `m=false` => 主动买 -> `side='bid'`

> 说明：当前原型以“增量可视化”为主，因此采用“WebSocket 增量差分 + 本地状态”模式；如果你要做严格盘口一致性，需要加 REST 快照 + `U/u/pu` 序列校验（见第 5 节）。

## 3. 如果某交易所没有统一深度/成交接口怎么办

可以保留 `MarketDataSource` 不变，为该交易所写适配器，转换为内部 `BookEvent`：

```ts
class XxxExchangeSource implements MarketDataSource {
  start(): void {}
  stop(): void {}
  getName(): string { return 'xxx'; }
}
```

分三种情况处理：

1. **只有成交，无深度**：
   - 仅推 `trade`，盘口列可退化为最近一段时间估算流动性（或显示空）。
2. **只有快照，无增量**：
   - 周期拉取快照，和上一帧做 diff，生成 `add/cancel`。
3. **字段不标准**：
   - 在 adapter 内部做“side/price/size/time”标准化，外部模块不改。

## 4. 建议的生产级架构（可选）

当前前端直接连交易所适合 Demo；生产建议：

```text
[Exchange WS/REST]
       |
 [Ingest Adapter Service]  <-- 每个交易所一个插件
       |
   (Kafka topics)
       |
 [Normalizer / Sequencer]  <-- 序列校验、重放、补快照
       |
  +----+-------------------------+
  |                              |
[Realtime Gateway]         [Storage Writer]
  |                              |
(WebSocket to UI)         (TimescaleDB / ClickHouse)
```

### 为什么这样做

- **Kafka**：解耦采集、标准化、下游消费；支持回放。
- **TimescaleDB/ClickHouse**：
  - TimescaleDB 适合 SQL + 时序查询；
  - ClickHouse 适合超大吞吐分析。
- **前端只连你的 Gateway**：避免浏览器直接持有交易所耦合逻辑，便于统一鉴权、限流、观测。

## 5. 强一致盘口必须补齐的能力清单

以 Binance 为例：

1. 启动时先连 WS，缓存 depth update。
2. 拉 REST 快照（`lastUpdateId`）。
3. 丢弃 `u <= lastUpdateId` 的旧增量。
4. 找到第一条满足 `U <= lastUpdateId + 1 <= u` 的增量后再开始应用。
5. 运行中若发现序列断档，立即重建（回到步骤1）。

此外建议加入：

- reconnect + 指数退避；
- 心跳/超时监控；
- 消息延迟和丢包监控；
- 幂等处理（按 sequence 去重）；
- 灾备（双链路或多机房）。

## 6. 项目内下一步改造建议

1. 把 symbol/tickSize/source 放到 UI 配置面板，而非 query 参数硬编码。
2. 在 `types.ts` 增加 `sequence/exchange/sourceTs` 字段，支持诊断。
3. 增加后端 `gateway` 示例（Node.js）：
   - upstream: Binance + 其他交易所；
   - downstream: 浏览器统一消费你自己的 `BookEvent`。
4. 增加录制回放：把 `BookEvent` 写入文件或 Kafka，支持本地复盘。

---

如果你告诉我“要接哪个交易所（如 OKX、Bybit、Coinbase）”，我可以直接按它的官方字段把适配器补全，并给出该交易所对应的序列一致性处理细节。
