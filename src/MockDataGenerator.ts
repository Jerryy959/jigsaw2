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
    if (this.timer) {
      return;
    }
    this.timer = window.setInterval(() => {
      const batch = this.nextBatch();
      for (const evt of batch) {
        this.onEvent(evt);
      }
    }, this.intervalMs);
  }

  private nextBatch(): BookEvent[] {
    const prices = this.orderBook.getPrices();
    const count = Math.random() < 0.2 ? 3 : 1;
    const out: BookEvent[] = [];

    for (let i = 0; i < count; i++) {
      const nearCenter = Math.floor(prices.length * (0.35 + Math.random() * 0.3));
      const noise = Math.floor(Math.random() * 12) - 6;
      const idx = Math.max(0, Math.min(prices.length - 1, nearCenter + noise));
      const price = prices[idx];
      const side: Side = Math.random() > 0.5 ? 'bid' : 'ask';
      const roll = Math.random();
      const size = Math.floor(Math.random() * 320) + 5;

      const type: BookEvent['type'] = roll < 0.45 ? 'add' : roll < 0.75 ? 'cancel' : 'trade';
      out.push({ type, side, price, size, timestamp: Date.now() });
    }

    return out;
  }
}
