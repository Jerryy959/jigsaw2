export class MockDataGenerator {
    constructor(orderBook, intervalMs, onEvent, config = {
        addWeight: 0.45,
        cancelWeight: 0.25,
        tradeWeight: 0.3,
        burstChance: 0.25,
    }) {
        this.orderBook = orderBook;
        this.intervalMs = intervalMs;
        this.onEvent = onEvent;
        this.config = config;
        this.timer = null;
    }
    start() {
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
    stop() {
        if (!this.timer) {
            return;
        }
        window.clearInterval(this.timer);
        this.timer = null;
    }
    getName() {
        return 'mock';
    }
    pickType() {
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
    nextBatch() {
        const prices = this.orderBook.getPrices();
        const center = Math.floor(prices.length / 2);
        const count = Math.random() < this.config.burstChance ? 2 + Math.floor(Math.random() * 3) : 1;
        const out = [];
        for (let i = 0; i < count; i++) {
            const distance = Math.floor((Math.random() - 0.5) * 16);
            const idx = Math.max(0, Math.min(prices.length - 1, center + distance));
            const price = prices[idx];
            const side = Math.random() > 0.5 ? 'bid' : 'ask';
            const type = this.pickType();
            const base = type === 'trade' ? 200 : 140;
            const size = 1 + Math.floor(Math.random() * base);
            out.push({ type, side, price, size, timestamp: Date.now() });
        }
        return out;
    }
}
