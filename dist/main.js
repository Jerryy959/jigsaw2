import { DOMRenderer } from './DOMRenderer.js';
import { MockDataGenerator } from './MockDataGenerator.js';
import { MyOrderManager } from './MyOrderManager.js';
import { MockMatchingEngine } from './MockMatchingEngine.js';
import { OrderBook } from './OrderBook.js';
function bootstrap() {
    const app = document.getElementById('app');
    if (!app) {
        throw new Error('Missing #app root');
    }
    const book = new OrderBook(3856, 0.25, 160);
    const mine = new MyOrderManager(book);
    const applyEvent = (event) => {
        book.applyEvent(event);
        mine.onBookEvent(event);
    };
    const matcher = new MockMatchingEngine(book, mine, (fillEvent) => {
        applyEvent(fillEvent);
    });
    const onMarketEvent = (event) => {
        applyEvent(event);
        matcher.onMarketEvent(event);
    };
    const renderer = new DOMRenderer(book, mine, app, (price, side, action) => {
        if (action === 'cancel') {
            const cancelled = mine.cancelTopOrderAt(price, side);
            if (cancelled) {
                applyEvent({ type: 'cancel', side, price, size: cancelled.remaining, timestamp: Date.now() });
            }
            return;
        }
        const size = 8 + Math.floor(Math.random() * 18);
        mine.placeOrder(side, price, size);
        applyEvent({ type: 'add', side, price, size, timestamp: Date.now() });
    });
    renderer.init();
    const mock = new MockDataGenerator(book, 70, onMarketEvent, {
        addWeight: 0.42,
        cancelWeight: 0.25,
        tradeWeight: 0.33,
        burstChance: 0.32,
    });
    mock.start();
    const loop = () => {
        renderer.render();
        requestAnimationFrame(loop);
    };
    loop();
}
bootstrap();
