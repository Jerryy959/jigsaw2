export class MockDataGenerator {
    constructor(orderBook, intervalMs, onEvent) {
        this.orderBook = orderBook;
        this.intervalMs = intervalMs;
        this.onEvent = onEvent;
        this.timer = null;
    }
    start() {
        if (this.timer !== null) {
            return;
        }
        this.timer = window.setInterval(() => {
            const event = this.createEvent();
            this.onEvent(event);
        }, this.intervalMs);
    }
    stop() {
        if (this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }
    createEvent() {
        const prices = this.orderBook.getPriceRange();
        const price = prices[Math.floor(Math.random() * prices.length)];
        const side = Math.random() > 0.5 ? 'bid' : 'ask';
        const roll = Math.random();
        const size = Math.floor(Math.random() * 18) + 1;
        if (roll < 0.45) {
            return { type: 'add', side, price, size };
        }
        if (roll < 0.75) {
            return { type: 'cancel', side, price, size };
        }
        return { type: 'trade', side, price, size };
    }
}
