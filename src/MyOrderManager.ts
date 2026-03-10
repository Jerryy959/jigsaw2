import type { BookEvent, MyOrderState, Side } from './types.js';
import { OrderBook } from './OrderBook.js';

export class MyOrderManager {
  private readonly orders = new Map<string, MyOrderState>();

  constructor(private readonly orderBook: OrderBook) {}

  public placeOrder(side: Side, price: number, size = 1): MyOrderState {
    const ahead = this.orderBook.getSizeAt(price, side);
    const order: MyOrderState = {
      id: `${side}-${price}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      side,
      price,
      size,
      ahead,
    };
    this.orders.set(order.id, order);
    return order;
  }

  public onBookEvent(event: BookEvent): void {
    for (const order of this.orders.values()) {
      if (order.price !== event.price || order.side !== event.side) {
        continue;
      }

      if (event.type === 'trade' || event.type === 'cancel') {
        // 简化模型：成交/撤单优先减少排在我前面的队列。
        order.ahead = Math.max(0, order.ahead - event.size);
      }
    }
  }

  public getOrders(): MyOrderState[] {
    return [...this.orders.values()];
  }

  public getOrdersAt(price: number, side: Side): MyOrderState[] {
    return this.getOrders().filter((order) => order.price === price && order.side === side);
  }
}
