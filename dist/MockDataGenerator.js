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
        if (this.timer !== null)
            return;
        this.timer = window.setInterval(() => {
            for (const event of this.nextBatch())
                this.onEvent(event);
        }, this.intervalMs);
    }
    stop() {
        if (this.timer === null)
            return;
        window.clearInterval(this.timer);
        this.timer = null;
    }
    getName() {
        return 'mock';
    }
    pickType() {
        const { addWeight, cancelWeight, tradeWeight } = this.config;
        const r = Math.random() * (addWeight + cancelWeight + tradeWeight);
        if (r < addWeight)
            return 'add';
        if (r < addWeight + cancelWeight)
            return 'cancel';
        return 'trade';
    }
    nextBatch() {
        const prices = this.orderBook.getPrices();
        const center = Math.floor(prices.length / 2);
        const count = Math.random() < this.config.burstChance ? 2 + Math.floor(Math.random() * 3) : 1;
        return Array.from({ length: count }, () => {
            const distance = Math.floor((Math.random() - 0.5) * 16);
            const idx = Math.max(0, Math.min(prices.length - 1, center + distance));
            const type = this.pickType();
            const side = Math.random() > 0.5 ? 'bid' : 'ask';
            const size = 1 + Math.floor(Math.random() * (type === 'trade' ? 200 : 140));
            return { type, side, price: prices[idx], size, timestamp: Date.now() };
        });
    }
}
