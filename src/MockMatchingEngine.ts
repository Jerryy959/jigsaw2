import { MyOrderManager } from './MyOrderManager.js';
import { OrderBook } from './OrderBook.js';
import type { BookEvent, Side } from './types.js';

/**
 * 模拟后端撮合服务：当市场价格扫到我的挂单价格时，按队列触发成交事件。
 * 该模块不直接修改订单簿，而是通过 emit 回调“推送”撮合成交事件。
 */
export class MockMatchingEngine {
  private lastTradePrice: number;

  constructor(
    private readonly orderBook: OrderBook,
    private readonly myOrders: MyOrderManager,
    private readonly emit: (event: BookEvent) => void
  ) {
    this.lastTradePrice = this.orderBook.getSnapshot().currentPrice;
  }

  public onMarketEvent(event: BookEvent): void {
    if (event.type !== 'trade') {
      return;
    }

    const prev = this.lastTradePrice;
    const curr = this.orderBook.normalize(event.price);
    this.lastTradePrice = curr;

    const orders = this.myOrders.getOrders();
    for (const order of orders) {
      if (order.remaining <= 0) {
        continue;
      }

      const swept =
        order.side === 'bid'
          ? prev >= order.price && curr <= order.price
          : prev <= order.price && curr >= order.price;
      const touched = curr === order.price;

      if (!swept && !touched) {
        continue;
      }

      const aggressor: Side = order.side === 'bid' ? 'ask' : 'bid';
      const queuePlusMine = Math.max(1, order.aheadVolume + order.remaining);
      const chunk = Math.max(1, Math.floor(queuePlusMine * (0.25 + Math.random() * 0.45)));

      this.emit({
        type: 'trade',
        side: aggressor,
        price: order.price,
        size: chunk,
        timestamp: Date.now(),
      });
    }
  }
}
