import type { BookEvent, BookLevel, DOMSnapshot, FootprintDisplayConfig, Side } from './types.js';

export class OrderBook {
  private readonly levels = new Map<number, BookLevel>();
  private readonly sessionTradedByPrice = new Map<number, { buy: number; sell: number }>();
  private currentPrice: number;
  private readonly tickDecimals: number;
  private displayConfig: FootprintDisplayConfig = {
    bucketSizeTicks: 1,
    timeWindowMs: 0,
    decayHalfLifeMs: 0,
  };

  constructor(
    private readonly centerPrice = 3856,
    private readonly tickSize = 0.25,
    private readonly depth = 140,
    private readonly randomSeededLiquidity = true
  ) {
    this.tickDecimals = this.resolveTickDecimals(tickSize);
    this.currentPrice = this.normalize(centerPrice);
    this.seed();
  }

  private resolveTickDecimals(tickSize: number): number {
    const normalizedTick = Number(tickSize.toString());
    if (!Number.isFinite(normalizedTick) || normalizedTick <= 0) {
      return 2;
    }
    const text = normalizedTick.toString();
    if (!text.includes('.')) {
      return 0;
    }
    return Math.min(8, text.split('.')[1].length);
  }

  private seed(): void {
    const half = Math.floor(this.depth / 2);
    for (let i = -half; i <= half; i++) {
      const price = this.normalize(this.centerPrice + i * this.tickSize);
      const distance = Math.max(1, Math.abs(i));
      const bidSize = this.randomSeededLiquidity
        ? i <= 0
          ? this.rand(80, 5000) / Math.sqrt(distance)
          : this.rand(5, 500)
        : 0;
      const askSize = this.randomSeededLiquidity
        ? i >= 0
          ? this.rand(80, 5000) / Math.sqrt(distance)
          : this.rand(5, 500)
        : 0;
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
    const rounded = Math.round(price / this.tickSize) * this.tickSize;
    return Number(rounded.toFixed(this.tickDecimals));
  }

  public formatPrice(price: number): string {
    return this.normalize(price).toFixed(this.tickDecimals);
  }

  public setCurrentPrice(price: number): void {
    if (!Number.isFinite(price)) {
      return;
    }
    const normalizedPrice = this.normalize(price);
    this.currentPrice = normalizedPrice;
    this.alignLevelsAroundCurrentPrice(normalizedPrice);
  }

  private alignLevelsAroundCurrentPrice(price: number): void {
    const now = Date.now();
    const keepDistance = this.tickSize * this.depth;
    const nextLevels = new Map<number, BookLevel>();

    for (const [levelPrice, level] of this.levels.entries()) {
      const hasActivity =
        level.bidSize > 0 ||
        level.askSize > 0 ||
        level.buyTraded > 0 ||
        level.sellTraded > 0 ||
        level.buyFlashUntil > now ||
        level.sellFlashUntil > now ||
        level.bidFlashUntil > now ||
        level.askFlashUntil > now;
      const closeToCurrent = Math.abs(levelPrice - price) <= keepDistance;
      if (hasActivity || closeToCurrent) {
        nextLevels.set(levelPrice, level);
      }
    }

    const half = Math.floor(this.depth / 2);
    for (let i = -half; i <= half; i += 1) {
      const levelPrice = this.normalize(price + i * this.tickSize);
      if (!nextLevels.has(levelPrice)) {
        nextLevels.set(levelPrice, this.createLevel(levelPrice));
      }
    }

    this.levels.clear();
    for (const [levelPrice, level] of nextLevels) {
      this.levels.set(levelPrice, level);
    }
  }

  public setFootprintDisplayConfig(config: Partial<FootprintDisplayConfig>): void {
    this.displayConfig = {
      bucketSizeTicks: Math.max(1, Math.floor(config.bucketSizeTicks ?? this.displayConfig.bucketSizeTicks)),
      timeWindowMs: Math.max(0, Math.floor(config.timeWindowMs ?? this.displayConfig.timeWindowMs)),
      decayHalfLifeMs: Math.max(0, Math.floor(config.decayHalfLifeMs ?? this.displayConfig.decayHalfLifeMs)),
    };
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

    const impactsLiquidity = event.impactsLiquidity ?? true;

    if (event.side === 'bid') {
      if (impactsLiquidity) {
        level.askSize = Math.max(0, level.askSize - event.size);
      }
      level.buyFlashUntil = now + flashMs;
      level.askFlashUntil = now + flashMs;
    } else {
      if (impactsLiquidity) {
        level.bidSize = Math.max(0, level.bidSize - event.size);
      }
      level.sellFlashUntil = now + flashMs;
      level.bidFlashUntil = now + flashMs;
    }

    this.recordSessionTrade(event.price, event.side, event.size);
  }

  private recordSessionTrade(price: number, side: Side, size: number): void {
    if (!Number.isFinite(size) || size <= 0) {
      return;
    }
    const normalizedPrice = this.normalize(price);
    const atPrice = this.sessionTradedByPrice.get(normalizedPrice) ?? { buy: 0, sell: 0 };
    if (side === 'bid') {
      atPrice.buy += size;
    } else {
      atPrice.sell += size;
    }
    this.sessionTradedByPrice.set(normalizedPrice, atPrice);
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

  private resolveBucketPrice(price: number): number {
    const bucketTickSize = this.tickSize * this.displayConfig.bucketSizeTicks;
    const bucketPrice = Math.round(price / bucketTickSize) * bucketTickSize;
    return Number(bucketPrice.toFixed(this.tickDecimals));
  }

  private projectTradeTotals(): Map<number, { buy: number; sell: number }> {
    const byBucket = new Map<number, { buy: number; sell: number }>();

    for (const [price, traded] of this.sessionTradedByPrice.entries()) {
      const bucketPrice = this.resolveBucketPrice(price);
      const bucket = byBucket.get(bucketPrice) ?? { buy: 0, sell: 0 };
      bucket.buy += traded.buy;
      bucket.sell += traded.sell;
      byBucket.set(bucketPrice, bucket);
    }

    return byBucket;
  }

  public getSnapshot(): DOMSnapshot {
    const projectedTrades = this.projectTradeTotals();

    const levels = [...this.levels.values()]
      .map((level) => {
        const bucketPrice = this.resolveBucketPrice(level.price);
        const bucket = projectedTrades.get(bucketPrice);
        return {
          ...level,
          buyTraded: bucket?.buy ?? 0,
          sellTraded: bucket?.sell ?? 0,
        };
      })
      .sort((a, b) => b.price - a.price);

    const bidCandidates = levels.filter((l) => l.bidSize > 0).map((l) => l.price);
    const askCandidates = levels.filter((l) => l.askSize > 0).map((l) => l.price);
    const bestBid = bidCandidates.length ? Math.max(...bidCandidates) : this.currentPrice;
    const bestAsk = askCandidates.length ? Math.min(...askCandidates) : this.currentPrice;

    // Session CUM is tracked per price level (or per selected price bucket).
    // Each row shows that row's own running total since page load, not a ladder-wise prefix/suffix sum.
    const maxBookSize = Math.max(1, ...levels.map((l) => Math.max(l.bidSize, l.askSize)));
    const maxTradeSize = Math.max(1, ...levels.map((l) => Math.max(l.buyTraded, l.sellTraded)));
    return { levels, bestBid, bestAsk, currentPrice: this.currentPrice, maxBookSize, maxTradeSize };
  }
}
