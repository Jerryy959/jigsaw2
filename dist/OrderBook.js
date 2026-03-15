export class OrderBook {
    constructor(centerPrice = 3856, tickSize = 0.25, depth = 140, randomSeededLiquidity = true) {
        this.depth = depth;
        this.randomSeededLiquidity = randomSeededLiquidity;
        this.levels = new Map();
        this.sessionTradedByPrice = new Map();
        this.displayConfig = { bucketSizeTicks: 1, timeWindowMs: 0, decayHalfLifeMs: 0 };
        this.centerPrice = centerPrice;
        this.tickSize = tickSize;
        this.tickDecimals = this.resolveTickDecimals(tickSize);
        this.currentPrice = this.normalize(centerPrice);
        this.seed();
    }
    /**
     * Reinitializes the book with a new center price and tick size.
     * Called automatically by MarketDataSource once the first real snapshot arrives,
     * so the book adapts to any instrument (SEIUSDT, BTCUSDT, etc.) without manual config.
     */
    reinitialize(newCenter, newTickSize) {
        if (!Number.isFinite(newCenter) || newCenter <= 0)
            return;
        if (!Number.isFinite(newTickSize) || newTickSize <= 0)
            return;
        this.tickSize = newTickSize;
        this.tickDecimals = this.resolveTickDecimals(newTickSize);
        this.centerPrice = newCenter;
        this.levels.clear();
        this.sessionTradedByPrice.clear();
        this.currentPrice = this.normalize(newCenter);
        this.seed();
    }
    resolveTickDecimals(tickSize) {
        if (!Number.isFinite(tickSize) || tickSize <= 0)
            return 2;
        const text = tickSize.toString();
        const dot = text.indexOf('.');
        return dot < 0 ? 0 : Math.min(8, text.length - dot - 1);
    }
    seed() {
        const half = Math.floor(this.depth / 2);
        for (let i = -half; i <= half; i++) {
            const price = this.normalize(this.centerPrice + i * this.tickSize);
            if (price <= 0)
                continue; // never seed negative or zero price levels
            const dist = Math.max(1, Math.abs(i));
            const bidSize = this.randomSeededLiquidity ? (i <= 0 ? this.rand(80, 5000) / Math.sqrt(dist) : this.rand(5, 500)) : 0;
            const askSize = this.randomSeededLiquidity ? (i >= 0 ? this.rand(80, 5000) / Math.sqrt(dist) : this.rand(5, 500)) : 0;
            this.levels.set(price, this.createLevel(price, bidSize, askSize));
        }
    }
    createLevel(price, bidSize = 0, askSize = 0) {
        return { price, bidSize, askSize, buyTraded: 0, sellTraded: 0, buyFlashUntil: 0, sellFlashUntil: 0, bidFlashUntil: 0, askFlashUntil: 0 };
    }
    rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    normalize(price) {
        return Number((Math.round(price / this.tickSize) * this.tickSize).toFixed(this.tickDecimals));
    }
    formatPrice(price) {
        return this.normalize(price).toFixed(this.tickDecimals);
    }
    getTickSize() {
        return this.tickSize;
    }
    setCurrentPrice(price) {
        if (!Number.isFinite(price))
            return;
        const p = this.normalize(price);
        this.currentPrice = p;
        this.alignLevelsAroundCurrentPrice(p);
    }
    alignLevelsAroundCurrentPrice(price) {
        const now = Date.now();
        const keepDistance = this.tickSize * this.depth;
        const half = Math.floor(this.depth / 2);
        for (const [levelPrice, level] of this.levels.entries()) {
            const tooFar = Math.abs(levelPrice - price) > keepDistance;
            if (!tooFar)
                continue;
            const hasActivity = level.bidSize > 0 || level.askSize > 0 ||
                level.buyTraded > 0 || level.sellTraded > 0 ||
                level.buyFlashUntil > now || level.sellFlashUntil > now ||
                level.bidFlashUntil > now || level.askFlashUntil > now;
            if (!hasActivity)
                this.levels.delete(levelPrice);
        }
        for (let i = -half; i <= half; i++) {
            const levelPrice = this.normalize(price + i * this.tickSize);
            if (levelPrice <= 0)
                continue; // guard: never create negative price levels
            if (!this.levels.has(levelPrice)) {
                this.levels.set(levelPrice, this.createLevel(levelPrice));
            }
        }
    }
    setFootprintDisplayConfig(config) {
        this.displayConfig = {
            bucketSizeTicks: Math.max(1, Math.floor(config.bucketSizeTicks ?? this.displayConfig.bucketSizeTicks)),
            timeWindowMs: Math.max(0, Math.floor(config.timeWindowMs ?? this.displayConfig.timeWindowMs)),
            decayHalfLifeMs: Math.max(0, Math.floor(config.decayHalfLifeMs ?? this.displayConfig.decayHalfLifeMs)),
        };
    }
    getOrCreate(price) {
        const key = this.normalize(price);
        const existing = this.levels.get(key);
        if (existing)
            return existing;
        const created = this.createLevel(key);
        this.levels.set(key, created);
        return created;
    }
    applyEvent(event) {
        const level = this.getOrCreate(event.price);
        if (event.type === 'add') {
            if (event.side === 'bid')
                level.bidSize += event.size;
            else
                level.askSize += event.size;
            return;
        }
        if (event.type === 'cancel') {
            if (event.side === 'bid')
                level.bidSize = Math.max(0, level.bidSize - event.size);
            else
                level.askSize = Math.max(0, level.askSize - event.size);
            return;
        }
        // trade
        const flashMs = 200 + Math.floor(Math.random() * 300);
        this.currentPrice = this.normalize(event.price);
        const impacts = event.impactsLiquidity ?? true;
        if (event.side === 'bid') {
            if (impacts)
                level.askSize = Math.max(0, level.askSize - event.size);
            level.buyFlashUntil = event.timestamp + flashMs;
            level.askFlashUntil = event.timestamp + flashMs;
        }
        else {
            if (impacts)
                level.bidSize = Math.max(0, level.bidSize - event.size);
            level.sellFlashUntil = event.timestamp + flashMs;
            level.bidFlashUntil = event.timestamp + flashMs;
        }
        this.recordSessionTrade(event.price, event.side, event.size);
    }
    recordSessionTrade(price, side, size) {
        if (!Number.isFinite(size) || size <= 0)
            return;
        const key = this.normalize(price);
        const entry = this.sessionTradedByPrice.get(key) ?? { buy: 0, sell: 0 };
        if (side === 'bid')
            entry.buy += size;
        else
            entry.sell += size;
        this.sessionTradedByPrice.set(key, entry);
    }
    getLiquidity(price, side) {
        const level = this.levels.get(this.normalize(price));
        if (!level)
            return 0;
        return side === 'bid' ? level.bidSize : level.askSize;
    }
    getPrices() {
        return [...this.levels.keys()].sort((a, b) => a - b);
    }
    resolveBucketPrice(price) {
        const bucketSize = this.tickSize * this.displayConfig.bucketSizeTicks;
        return Number((Math.round(price / bucketSize) * bucketSize).toFixed(this.tickDecimals));
    }
    projectTradeTotals() {
        const byBucket = new Map();
        for (const [price, traded] of this.sessionTradedByPrice.entries()) {
            const key = this.resolveBucketPrice(price);
            const bucket = byBucket.get(key) ?? { buy: 0, sell: 0 };
            bucket.buy += traded.buy;
            bucket.sell += traded.sell;
            byBucket.set(key, bucket);
        }
        return byBucket;
    }
    getSnapshot() {
        const projectedTrades = this.projectTradeTotals();
        const levels = [...this.levels.values()]
            .map((level) => {
            const bucket = projectedTrades.get(this.resolveBucketPrice(level.price));
            return { ...level, buyTraded: bucket?.buy ?? 0, sellTraded: bucket?.sell ?? 0 };
        })
            .sort((a, b) => b.price - a.price);
        const bestBid = levels.find(l => l.bidSize > 0)?.price ?? this.currentPrice;
        let bestAsk = this.currentPrice;
        for (let i = levels.length - 1; i >= 0; i--) {
            if (levels[i].askSize > 0) {
                bestAsk = levels[i].price;
                break;
            }
        }
        const maxBookSize = Math.max(1, ...levels.map(l => Math.max(l.bidSize, l.askSize)));
        const maxTradeSize = Math.max(1, ...levels.map(l => Math.max(l.buyTraded, l.sellTraded)));
        return { levels, bestBid, bestAsk, currentPrice: this.currentPrice, maxBookSize, maxTradeSize };
    }
}
