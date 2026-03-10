export class OrderBook {
    constructor(centerPrice = 3856, tickSize = 0.25, depth = 70) {
        this.centerPrice = centerPrice;
        this.tickSize = tickSize;
        this.depth = depth;
        this.levels = new Map();
        this.seed();
    }
    seed() {
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
    rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    normalize(price) {
        return Number(price.toFixed(2));
    }
    getOrCreate(price) {
        const key = this.normalize(price);
        const existing = this.levels.get(key);
        if (existing) {
            return existing;
        }
        const created = {
            price: key,
            bidSize: 0,
            askSize: 0,
            buyTraded: 0,
            sellTraded: 0,
        };
        this.levels.set(key, created);
        return created;
    }
    applyEvent(event) {
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
        // trade: side=bid means aggressive buy hitting ask; side=ask means aggressive sell hitting bid.
        if (event.side === 'bid') {
            level.askSize = Math.max(0, level.askSize - event.size);
            level.buyTraded += event.size;
        }
        else {
            level.bidSize = Math.max(0, level.bidSize - event.size);
            level.sellTraded += event.size;
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
        const bestBid = Math.max(...levels.filter((l) => l.bidSize > 0).map((l) => l.price));
        const bestAsk = Math.min(...levels.filter((l) => l.askSize > 0).map((l) => l.price));
        const maxBookSize = Math.max(1, ...levels.map((l) => Math.max(l.bidSize, l.askSize)));
        const maxTradeSize = Math.max(1, ...levels.map((l) => Math.max(l.buyTraded, l.sellTraded, Math.abs(l.buyTraded - l.sellTraded))));
        return { levels, bestBid, bestAsk, maxBookSize, maxTradeSize };
    }
}
