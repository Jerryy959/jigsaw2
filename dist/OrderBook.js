export class OrderBook {
    constructor(midPrice = 100, tickSize = 1, levelCount = 40) {
        this.midPrice = midPrice;
        this.tickSize = tickSize;
        this.levelCount = levelCount;
        this.levels = new Map();
        this.seedLevels();
    }
    seedLevels() {
        const half = Math.floor(this.levelCount / 2);
        for (let i = -half; i <= half; i++) {
            const price = this.midPrice + i * this.tickSize;
            const distance = Math.abs(i) + 1;
            this.levels.set(price, {
                price,
                bidSize: i <= 0 ? this.randomSize(30, 160) / distance : this.randomSize(5, 24),
                askSize: i >= 0 ? this.randomSize(30, 160) / distance : this.randomSize(5, 24),
                buyVolume: 0,
                sellVolume: 0,
            });
        }
    }
    randomSize(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    applyEvent(event) {
        const level = this.levels.get(event.price);
        if (!level) {
            return;
        }
        switch (event.type) {
            case 'add': {
                if (event.side === 'bid') {
                    level.bidSize += event.size;
                }
                else {
                    level.askSize += event.size;
                }
                break;
            }
            case 'cancel': {
                if (event.side === 'bid') {
                    level.bidSize = Math.max(0, level.bidSize - event.size);
                }
                else {
                    level.askSize = Math.max(0, level.askSize - event.size);
                }
                break;
            }
            case 'trade': {
                // buy 主动成交会吃掉 ask，sell 主动成交会吃掉 bid。
                if (event.side === 'bid') {
                    level.askSize = Math.max(0, level.askSize - event.size);
                    level.buyVolume += event.size;
                }
                else {
                    level.bidSize = Math.max(0, level.bidSize - event.size);
                    level.sellVolume += event.size;
                }
                break;
            }
        }
    }
    getLevelsDescending() {
        return [...this.levels.values()].sort((a, b) => b.price - a.price);
    }
    getSizeAt(price, side) {
        const level = this.levels.get(price);
        if (!level) {
            return 0;
        }
        return side === 'bid' ? level.bidSize : level.askSize;
    }
    getPriceRange() {
        return [...this.levels.keys()].sort((a, b) => a - b);
    }
}
