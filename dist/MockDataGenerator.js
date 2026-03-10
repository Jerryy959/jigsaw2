export class MockDataGenerator {
    constructor(orderBook, intervalMs, onEvent) {
        this.orderBook = orderBook;
        this.intervalMs = intervalMs;
        this.onEvent = onEvent;
        this.timer = null;
    }
    start() {
        if (this.timer) {
            return;
        }
        this.timer = window.setInterval(() => {
            const batch = this.nextBatch();
            for (const evt of batch) {
                this.onEvent(evt);
            }
        }, this.intervalMs);
    }
    nextBatch() {
        const prices = this.orderBook.getPrices();
        const count = Math.random() < 0.2 ? 3 : 1;
        const out = [];
        for (let i = 0; i < count; i++) {
            const nearCenter = Math.floor(prices.length * (0.35 + Math.random() * 0.3));
            const noise = Math.floor(Math.random() * 12) - 6;
            const idx = Math.max(0, Math.min(prices.length - 1, nearCenter + noise));
            const price = prices[idx];
            const side = Math.random() > 0.5 ? 'bid' : 'ask';
            const roll = Math.random();
            const size = Math.floor(Math.random() * 320) + 5;
            const type = roll < 0.45 ? 'add' : roll < 0.75 ? 'cancel' : 'trade';
            out.push({ type, side, price, size, timestamp: Date.now() });
        }
        return out;
    }
}
