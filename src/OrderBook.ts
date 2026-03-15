import type { BookEvent, BookLevel, DOMSnapshot, FootprintDisplayConfig, Side } from './types.js';

export class OrderBook {
  private readonly levels = new Map<number, BookLevel>();
  private readonly sessionTradedByPrice = new Map<number, { buy: number; sell: number }>();
  private currentPrice: number;
  private readonly tickDecimals: number;
  private displayConfig: FootprintDisplayConfig = { bucketSizeTicks: 1, timeWindowMs: 0, decayHalfLifeMs: 0 };

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
    if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
    const text = tickSize.toString();
    const dot = text.indexOf('.');
    return dot < 0 ? 0 : Math.min(8, text.length - dot - 1);
  }

  private seed(): void {
    const half = Math.floor(this.depth / 2);
    for (let i = -half; i <= half; i++) {
      const price = this.normalize(this.centerPrice + i * this.tickSize);
      const dist = Math.max(1, Math.abs(i));
      const bidSize = this.randomSeededLiquidity ? (i <= 0 ? this.rand(80, 5000) / Math.sqrt(dist) : this.rand(5, 500)) : 0;
      const askSize = this.randomSeededLiquidity ? (i >= 0 ? this.rand(80, 5000) / Math.sqrt(dist) : this.rand(5, 500)) : 0;
      this.levels.set(price, this.createLevel(price, bidSize, askSize));
    }
  }

  private createLevel(price: number, bidSize = 0, askSize = 0): BookLevel {
    return { price, bidSize, askSize, buyTraded: 0, sellTraded: 0, buyFlashUntil: 0, sellFlashUntil: 0, bidFlashUntil: 0, askFlashUntil: 0 };
  }

  private rand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public normalize(price: number): number {
    return Number((Math.round(price / this.tickSize) * this.tickSize).toFixed(this.tickDecimals));
  }

  public formatPrice(price: number): string {
    return this.normalize(price).toFixed(this.tickDecimals);
  }

  public setCurrentPrice(price: number): void {
    if (!Number.isFinite(price)) return;
    const p = this.normalize(price);
    this.currentPrice = p;
    this.alignLevelsAroundCurrentPrice(p);
  }

  private alignLevelsAroundCurrentPrice(price: number): void {
    const now = Date.now();
    const keepDistance = this.tickSize * this.depth;
    const half = Math.floor(this.depth / 2);

    // Prune levels that are too far away and have no activity
    for (const [levelPrice, level] of this.levels.entries()) {
      const tooFar = Math.abs(levelPrice - price) > keepDistance;
      if (!tooFar) continue;
      const hasActivity =
        level.bidSize > 0 || level.askSize > 0 ||
        level.buyTraded > 0 || level.sellTraded > 0 ||
        level.buyFlashUntil > now || level.sellFlashUntil > now ||
        level.bidFlashUntil > now || level.askFlashUntil > now;
      if (!hasActivity) this.levels.delete(levelPrice);
    }

    // Ensure the visible window around the new price has entries
    for (let i = -half; i <= half; i++) {
      const levelPrice = this.normalize(price + i * this.tickSize);
      if (!this.levels.has(levelPrice)) {
        this.levels.set(levelPrice, this.createLevel(levelPrice));
      }
    }
  }

  public setFootprintDisplayConfig(config: Partial<FootprintDisplayConfig>): void {
    this.displayConfig = {
      bucketSizeTicks: Math.max(1, Math.floor(config.bucketSizeTicks ?? this.displayConfig.bucketSizeTicks)),
      timeWindowMs:    Math.max(0, Math.floor(config.timeWindowMs    ?? this.displayConfig.timeWindowMs)),
      decayHalfLifeMs: Math.max(0, Math.floor(config.decayHalfLifeMs ?? this.displayConfig.decayHalfLifeMs)),
    };
  }

  private getOrCreate(price: number): BookLevel {
    const key = this.normalize(price);
    const existing = this.levels.get(key);
    if (existing) return existing;
    const created = this.createLevel(key);
    this.levels.set(key, created);
    return created;
  }

  public applyEvent(event: BookEvent): void {
    const level = this.getOrCreate(event.price);

    if (event.type === 'add') {
      if (event.side === 'bid') level.bidSize += event.size;
      else                      level.askSize += event.size;
      return;
    }

    if (event.type === 'cancel') {
      if (event.side === 'bid') level.bidSize = Math.max(0, level.bidSize - event.size);
      else                      level.askSize = Math.max(0, level.askSize - event.size);
      return;
    }

    // trade
    const flashMs = 200 + Math.floor(Math.random() * 300);
    this.currentPrice = this.normalize(event.price);
    const impacts = event.impactsLiquidity ?? true;

    if (event.side === 'bid') {
      if (impacts) level.askSize = Math.max(0, level.askSize - event.size);
      level.buyFlashUntil = event.timestamp + flashMs;
      level.askFlashUntil = event.timestamp + flashMs;
    } else {
      if (impacts) level.bidSize = Math.max(0, level.bidSize - event.size);
      level.sellFlashUntil = event.timestamp + flashMs;
      level.bidFlashUntil  = event.timestamp + flashMs;
    }

    this.recordSessionTrade(event.price, event.side, event.size);
  }

  private recordSessionTrade(price: number, side: Side, size: number): void {
    if (!Number.isFinite(size) || size <= 0) return;
    const key = this.normalize(price);
    const entry = this.sessionTradedByPrice.get(key) ?? { buy: 0, sell: 0 };
    if (side === 'bid') entry.buy += size;
    else                entry.sell += size;
    this.sessionTradedByPrice.set(key, entry);
  }

  public getLiquidity(price: number, side: Side): number {
    const level = this.levels.get(this.normalize(price));
    if (!level) return 0;
    return side === 'bid' ? level.bidSize : level.askSize;
  }

  public getPrices(): number[] {
    return [...this.levels.keys()].sort((a, b) => a - b);
  }

  private resolveBucketPrice(price: number): number {
    const bucketSize = this.tickSize * this.displayConfig.bucketSizeTicks;
    return Number((Math.round(price / bucketSize) * bucketSize).toFixed(this.tickDecimals));
  }

  private projectTradeTotals(): Map<number, { buy: number; sell: number }> {
    const byBucket = new Map<number, { buy: number; sell: number }>();
    for (const [price, traded] of this.sessionTradedByPrice.entries()) {
      const key = this.resolveBucketPrice(price);
      const bucket = byBucket.get(key) ?? { buy: 0, sell: 0 };
      bucket.buy += traded.buy;
      bucket.sell += traded.sell;
      byBucket.set(key, bucket);
    }
    return byBucket;
  }

  public getSnapshot(): DOMSnapshot {
    const projectedTrades = this.projectTradeTotals();

    const levels = [...this.levels.values()]
      .map((level) => {
        const bucket = projectedTrades.get(this.resolveBucketPrice(level.price));
        return { ...level, buyTraded: bucket?.buy ?? 0, sellTraded: bucket?.sell ?? 0 };
      })
      .sort((a, b) => b.price - a.price);

    // levels is sorted descending: first bidSize>0 is bestBid, last askSize>0 is bestAsk
    const bestBid = levels.find(l => l.bidSize > 0)?.price ?? this.currentPrice;
    let bestAsk = this.currentPrice;
    for (let i = levels.length - 1; i >= 0; i--) {
      if (levels[i].askSize > 0) { bestAsk = levels[i].price; break; }
    }

    const maxBookSize  = Math.max(1, ...levels.map(l => Math.max(l.bidSize,    l.askSize)));
    const maxTradeSize = Math.max(1, ...levels.map(l => Math.max(l.buyTraded,  l.sellTraded)));

    return { levels, bestBid, bestAsk, currentPrice: this.currentPrice, maxBookSize, maxTradeSize };
  }
}
