import { OrderBook } from './OrderBook.js';
import type { MarketDataSource } from './MarketDataSource.js';
import type { BookEvent, MockConfig, Side } from './types.js';

export class MockDataGenerator implements MarketDataSource {
  private timer: number | null = null;

  constructor(
    private readonly orderBook: OrderBook,
    private readonly intervalMs: number,
    private readonly onEvent: (event: BookEvent) => void,
    private readonly config: MockConfig = {
      addWeight: 0.45,
      cancelWeight: 0.25,
      tradeWeight: 0.3,
      burstChance: 0.25,
    }
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = window.setInterval(() => {
      const events = this.nextBatch();
      for (const event of events) {
        this.onEvent(event);
      }
    }, this.intervalMs);
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }
    window.clearInterval(this.timer);
    this.timer = null;
  }

  public getName(): string {
    return 'mock';
  }

  private pickType(): BookEvent['type'] {
    const total = this.config.addWeight + this.config.cancelWeight + this.config.tradeWeight;
    const r = Math.random() * total;
    if (r < this.config.addWeight) {
      return 'add';
    }
    if (r < this.config.addWeight + this.config.cancelWeight) {
      return 'cancel';
    }
    return 'trade';
  }

  private nextBatch(): BookEvent[] {
    const prices = this.orderBook.getPrices();
    const center = Math.floor(prices.length / 2);
    const count = Math.random() < this.config.burstChance ? 2 + Math.floor(Math.random() * 3) : 1;
    const out: BookEvent[] = [];

    for (let i = 0; i < count; i++) {
      const distance = Math.floor((Math.random() - 0.5) * 16);
      const idx = Math.max(0, Math.min(prices.length - 1, center + distance));
      const price = prices[idx];
      const side: Side = Math.random() > 0.5 ? 'bid' : 'ask';
      const type = this.pickType();
      const base = type === 'trade' ? 200 : 140;
      const size = 1 + Math.floor(Math.random() * base);
      out.push({ type, side, price, size, timestamp: Date.now() });
    }

    return out;
  }
}
