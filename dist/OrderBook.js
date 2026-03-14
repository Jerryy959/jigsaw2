export class OrderBook {
    constructor(centerPrice = 3856, tickSize = 0.25, depth = 140, randomSeededLiquidity = true) {
        this.centerPrice = centerPrice;
        this.tickSize = tickSize;
        this.depth = depth;
        this.randomSeededLiquidity = randomSeededLiquidity;
        this.levels = new Map();
        this.sessionTradedByPrice = new Map();
        this.displayConfig = {
            bucketSizeTicks: 1,
            timeWindowMs: 0,
            decayHalfLifeMs: 0,
        };
        this.tickDecimals = this.resolveTickDecimals(tickSize);
        this.currentPrice = this.normalize(centerPrice);
        this.seed();
    }
    resolveTickDecimals(tickSize) {
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
    seed() {
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
    createLevel(price, bidSize = 0, askSize = 0) {
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
    rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    normalize(price) {
        const rounded = Math.round(price / this.tickSize) * this.tickSize;
        return Number(rounded.toFixed(this.tickDecimals));
    }
    formatPrice(price) {
        return this.normalize(price).toFixed(this.tickDecimals);
    }
    setCurrentPrice(price) {
        if (!Number.isFinite(price)) {
            return;
        }
        const normalizedPrice = this.normalize(price);
        this.currentPrice = normalizedPrice;
        this.alignLevelsAroundCurrentPrice(normalizedPrice);
    }
    alignLevelsAroundCurrentPrice(price) {
        const now = Date.now();
        const keepDistance = this.tickSize * this.depth;
        const nextLevels = new Map();
        for (const [levelPrice, level] of this.levels.entries()) {
            const hasActivity = level.bidSize > 0 ||
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
    setFootprintDisplayConfig(config) {
        this.displayConfig = {
            bucketSizeTicks: Math.max(1, Math.floor(config.bucketSizeTicks ?? this.displayConfig.bucketSizeTicks)),
            timeWindowMs: Math.max(0, Math.floor(config.timeWindowMs ?? this.displayConfig.timeWindowMs)),
            decayHalfLifeMs: Math.max(0, Math.floor(config.decayHalfLifeMs ?? this.displayConfig.decayHalfLifeMs)),
        };
    }
    getOrCreate(price) {
        const key = this.normalize(price);
        const l = this.levels.get(key);
        if (l) {
            return l;
        }
        const created = this.createLevel(key);
        this.levels.set(key, created);
        return created;
    }
    applyEvent(event) {
        const now = event.timestamp;
        const level = this.getOrCreate(event.price);
        if (event.type === 'add') {
            if (event.side === 'bid') {
                level.bidSize += event.size;
            }
            else {
                level.askSize += event.size;
            }
            return;
        }
        if (event.type === 'cancel') {
            if (event.side === 'bid') {
                level.bidSize = Math.max(0, level.bidSize - event.size);
            }
            else {
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
        }
        else {
            if (impactsLiquidity) {
                level.bidSize = Math.max(0, level.bidSize - event.size);
            }
            level.sellFlashUntil = now + flashMs;
            level.bidFlashUntil = now + flashMs;
        }
        this.recordSessionTrade(event.price, event.side, event.size);
    }
    recordSessionTrade(price, side, size) {
        if (!Number.isFinite(size) || size <= 0) {
            return;
        }
        const normalizedPrice = this.normalize(price);
        const atPrice = this.sessionTradedByPrice.get(normalizedPrice) ?? { buy: 0, sell: 0 };
        if (side === 'bid') {
            atPrice.buy += size;
        }
        else {
            atPrice.sell += size;
        }
        this.sessionTradedByPrice.set(normalizedPrice, atPrice);
    }
    getLiquidity(price, side) {
        const level = this.levels.get(this.normalize(price));
        if (!level) {
            return 0;
        }
        return side === 'bid' ? level.bidSize : level.askSize;
    }
    getPrices() {
        return [...this.levels.keys()].sort((a, b) => a - b);
    }
    resolveBucketPrice(price) {
        const bucketTickSize = this.tickSize * this.displayConfig.bucketSizeTicks;
        const bucketPrice = Math.round(price / bucketTickSize) * bucketTickSize;
        return Number(bucketPrice.toFixed(this.tickDecimals));
    }
    projectTradeTotals() {
        const byBucket = new Map();
        for (const [price, traded] of this.sessionTradedByPrice.entries()) {
            const bucketPrice = this.resolveBucketPrice(price);
            const bucket = byBucket.get(bucketPrice) ?? { buy: 0, sell: 0 };
            bucket.buy += traded.buy;
            bucket.sell += traded.sell;
            byBucket.set(bucketPrice, bucket);
        }
        return byBucket;
    }
    getSnapshot() {
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
        // Cumulative footprint should be side-aware and accumulate from deeper levels toward the touch:
        // - SELL CUM only accumulates on bid-side prices (<= bestBid), from deeper bids up to best bid.
        // - BUY CUM only accumulates on ask-side prices (>= bestAsk), from deeper asks down to best ask.
        let cumulativeSell = 0;
        for (let i = levels.length - 1; i >= 0; i -= 1) {
            if (levels[i].price <= bestBid) {
                cumulativeSell += levels[i].sellTraded;
                levels[i].sellTraded = cumulativeSell;
            }
            else {
                levels[i].sellTraded = 0;
            }
        }
        let cumulativeBuy = 0;
        for (let i = 0; i < levels.length; i += 1) {
            if (levels[i].price >= bestAsk) {
                cumulativeBuy += levels[i].buyTraded;
                levels[i].buyTraded = cumulativeBuy;
            }
            else {
                levels[i].buyTraded = 0;
            }
        }
        const maxBookSize = Math.max(1, ...levels.map((l) => Math.max(l.bidSize, l.askSize)));
        const maxTradeSize = Math.max(1, ...levels.map((l) => Math.max(l.buyTraded, l.sellTraded)));
        return { levels, bestBid, bestAsk, currentPrice: this.currentPrice, maxBookSize, maxTradeSize };
    }
}
