export class OrderBook {
    constructor(centerPrice = 3856, tickSize = 0.25, depth = 140, randomSeededLiquidity = true) {
        this.centerPrice = centerPrice;
        this.tickSize = tickSize;
        this.depth = depth;
        this.randomSeededLiquidity = randomSeededLiquidity;
        this.levels = new Map();
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
        this.currentPrice = this.normalize(price);
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
            level.buyTraded += event.size;
            level.buyFlashUntil = now + flashMs;
            level.askFlashUntil = now + flashMs;
        }
        else {
            if (impactsLiquidity) {
                level.bidSize = Math.max(0, level.bidSize - event.size);
            }
            level.sellTraded += event.size;
            level.sellFlashUntil = now + flashMs;
            level.bidFlashUntil = now + flashMs;
        }
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
    getSnapshot() {
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
