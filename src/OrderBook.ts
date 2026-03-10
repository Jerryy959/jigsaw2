import type { BookEvent, BookLevel, DOMSnapshot, Side } from './types.js';

export class OrderBook {
  private readonly levels = new Map<number, BookLevel>();
  private currentPrice: number;

  constructor(
    private readonly centerPrice = 3856,
    private readonly tickSize = 0.25,
    private readonly depth = 140
  ) {
    this.currentPrice = centerPrice;
    this.seed();
  }

  private seed(): void {
    const half = Math.floor(this.depth / 2);
    for (let i = -half; i <= half; i++) {
      const price = this.normalize(this.centerPrice + i * this.tickSize);
      const distance = Math.max(1, Math.abs(i));
      const bidSize = i <= 0 ? this.rand(80, 5000) / Math.sqrt(distance) : this.rand(5, 500);
      const askSize = i >= 0 ? this.rand(80, 5000) / Math.sqrt(distance) : this.rand(5, 500);
      this.levels.set(price, this.createLevel(price, bidSize, askSize));
    }
  }

  private createLevel(price: number, bidSize = 0, askSize = 0): BookLevel {
    return {
      price,
      bidSize,
      askSize,
      buyTraded: 0,
      sellTraded: 0,
      buyFlashUntil: 0,
      sellFlashUntil: 0,
      bidFlashUntil: 0,
      askFlashUntil: 0,
    };
  }

  private rand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public normalize(price: number): number {
    return Number(price.toFixed(2));
  }

  private getOrCreate(price: number): BookLevel {
    const key = this.normalize(price);
    const l = this.levels.get(key);
    if (l) {
      return l;
    }
    const created = this.createLevel(key);
    this.levels.set(key, created);
    return created;
  }

  public applyEvent(event: BookEvent): void {
    const now = event.timestamp;
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

    // trade flashes 200-500ms
    const flashMs = 200 + Math.floor(Math.random() * 300);
    this.currentPrice = this.normalize(event.price);

    if (event.side === 'bid') {
      level.askSize = Math.max(0, level.askSize - event.size);
      level.buyTraded += event.size;
      level.buyFlashUntil = now + flashMs;
      level.askFlashUntil = now + flashMs;
    } else {
      level.bidSize = Math.max(0, level.bidSize - event.size);
      level.sellTraded += event.size;
      level.sellFlashUntil = now + flashMs;
      level.bidFlashUntil = now + flashMs;
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
    const bidCandidates = levels.filter((l) => l.bidSize > 0).map((l) => l.price);
    const askCandidates = levels.filter((l) => l.askSize > 0).map((l) => l.price);
    const bestBid = bidCandidates.length ? Math.max(...bidCandidates) : this.currentPrice;
    const bestAsk = askCandidates.length ? Math.min(...askCandidates) : this.currentPrice;
    const maxBookSize = Math.max(1, ...levels.map((l) => Math.max(l.bidSize, l.askSize)));
    const maxTradeSize = Math.max(1, ...levels.map((l) => Math.max(l.buyTraded, l.sellTraded)));
    return { levels, bestBid, bestAsk, currentPrice: this.currentPrice, maxBookSize, maxTradeSize };
  }
}
