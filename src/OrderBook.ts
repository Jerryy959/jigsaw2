import type { BookEvent, BookLevel, DOMSnapshot, Side } from './types.js';

export class OrderBook {
  private readonly levels = new Map<number, BookLevel>();

  constructor(
    private readonly centerPrice = 3856,
    private readonly tickSize = 0.25,
    private readonly depth = 70
  ) {
    this.seed();
  }

  private seed(): void {
    const half = Math.floor(this.depth / 2);
    for (let i = -half; i <= half; i++) {
      const price = this.normalize(this.centerPrice + i * this.tickSize);
      const distance = Math.max(1, Math.abs(i));
      const bidSize = i <= 0 ? this.rand(120, 7000) / Math.sqrt(distance + 0.2) : this.rand(20, 800);
      const askSize = i >= 0 ? this.rand(120, 7000) / Math.sqrt(distance + 0.2) : this.rand(20, 800);
      this.levels.set(price, {
        price,
        bidSize,
        askSize,
        buyTraded: 0,
        sellTraded: 0,
      });
    }
  }

  private rand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private normalize(price: number): number {
    return Number(price.toFixed(2));
  }

  private getOrCreate(price: number): BookLevel {
    const key = this.normalize(price);
    const existing = this.levels.get(key);
    if (existing) {
      return existing;
    }
    const created: BookLevel = {
      price: key,
      bidSize: 0,
      askSize: 0,
      buyTraded: 0,
      sellTraded: 0,
    };
    this.levels.set(key, created);
    return created;
  }

  public applyEvent(event: BookEvent): void {
    const level = this.getOrCreate(event.price);

    if (event.type === 'add') {
      if (event.side === 'bid') {
        level.bidSize += event.size;
      } else {
        level.askSize += event.size;
      }
      return;
    }

    if (event.type === 'cancel') {
      if (event.side === 'bid') {
        level.bidSize = Math.max(0, level.bidSize - event.size);
      } else {
        level.askSize = Math.max(0, level.askSize - event.size);
      }
      return;
    }

    // trade: side=bid means aggressive buy hitting ask; side=ask means aggressive sell hitting bid.
    if (event.side === 'bid') {
      level.askSize = Math.max(0, level.askSize - event.size);
      level.buyTraded += event.size;
    } else {
      level.bidSize = Math.max(0, level.bidSize - event.size);
      level.sellTraded += event.size;
    }
  }

  public getLiquidity(price: number, side: Side): number {
    const level = this.levels.get(this.normalize(price));
    if (!level) {
      return 0;
    }
    return side === 'bid' ? level.bidSize : level.askSize;
  }

  public getPrices(): number[] {
    return [...this.levels.keys()].sort((a, b) => a - b);
  }

  public getSnapshot(): DOMSnapshot {
    const levels = [...this.levels.values()].sort((a, b) => b.price - a.price);
    const bestBid = Math.max(...levels.filter((l) => l.bidSize > 0).map((l) => l.price));
    const bestAsk = Math.min(...levels.filter((l) => l.askSize > 0).map((l) => l.price));
    const maxBookSize = Math.max(1, ...levels.map((l) => Math.max(l.bidSize, l.askSize)));
    const maxTradeSize = Math.max(1, ...levels.map((l) => Math.max(l.buyTraded, l.sellTraded, Math.abs(l.buyTraded - l.sellTraded))));
    return { levels, bestBid, bestAsk, maxBookSize, maxTradeSize };
  }
}
