import { OrderBook } from './OrderBook.js';
import type { BookEvent, Side } from './types.js';

export class MockDataGenerator {
  private timer: number | null = null;

  constructor(
    private readonly orderBook: OrderBook,
    private readonly intervalMs: number,
    private readonly onEvent: (event: BookEvent) => void
  ) {}

  public start(): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = window.setInterval(() => {
      const event = this.createEvent();
      this.onEvent(event);
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private createEvent(): BookEvent {
    const prices = this.orderBook.getPriceRange();
    const price = prices[Math.floor(Math.random() * prices.length)];
    const side: Side = Math.random() > 0.5 ? 'bid' : 'ask';
    const roll = Math.random();
    const size = Math.floor(Math.random() * 18) + 1;

    if (roll < 0.45) {
      return { type: 'add', side, price, size };
    }

    if (roll < 0.75) {
      return { type: 'cancel', side, price, size };
    }

    return { type: 'trade', side, price, size };
  }
}
