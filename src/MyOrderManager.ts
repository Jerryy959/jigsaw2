import { OrderBook } from './OrderBook.js';
import type { BookEvent, MyOrder, Side } from './types.js';

export class MyOrderManager {
  private readonly orders = new Map<string, MyOrder>();

  constructor(private readonly orderBook: OrderBook) {}

  public placeOrder(side: Side, price: number, size: number): MyOrder {
    const aheadVolume = this.orderBook.getLiquidity(price, side);
    const order: MyOrder = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      side,
      price,
      size,
      remaining: size,
      aheadVolume,
      createdAt: Date.now(),
    };
    this.orders.set(order.id, order);
    return order;
  }

  public cancelTopOrderAt(price: number, side: Side): MyOrder | undefined {
    const top = this.getTopOrderAt(price, side);
    if (!top) {
      return undefined;
    }
    this.orders.delete(top.id);
    return top;
  }

  public onBookEvent(event: BookEvent): void {
    for (const order of this.orders.values()) {
      if (order.price !== event.price || order.remaining <= 0) {
        continue;
      }

      const queueChange = event.type === 'cancel' && event.side === order.side;
      const matchHappened =
        event.type === 'trade' &&
        ((order.side === 'bid' && event.side === 'ask') ||
          (order.side === 'ask' && event.side === 'bid'));

      if (!queueChange && !matchHappened) {
        continue;
      }

      const consumedAhead = Math.min(order.aheadVolume, event.size);
      order.aheadVolume -= consumedAhead;

      const impactOnMe = event.size - consumedAhead;
      if (impactOnMe > 0) {
        order.remaining = Math.max(0, order.remaining - impactOnMe);
      }
    }

    for (const [id, order] of this.orders.entries()) {
      if (order.remaining <= 0) {
        this.orders.delete(id);
      }
    }
  }

  public getOrders(): MyOrder[] {
    return [...this.orders.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  public getTopOrderAt(price: number, side: Side): MyOrder | undefined {
    return this.getOrders().find((o) => o.price === price && o.side === side);
  }
}
