import { DOMRenderer } from './DOMRenderer.js';
import { MockDataGenerator } from './MockDataGenerator.js';
import { MyOrderManager } from './MyOrderManager.js';
import { OrderBook } from './OrderBook.js';
function bootstrap() {
    const app = document.getElementById('app');
    if (!app) {
        throw new Error('Missing #app root element');
    }
    const orderBook = new OrderBook(100, 1, 38);
    const myOrders = new MyOrderManager(orderBook);
    const renderer = new DOMRenderer(orderBook, myOrders, app, (price, side) => {
        const order = myOrders.placeOrder(side, price, 1);
        const myAddEvent = { type: 'add', side, price, size: order.size };
        orderBook.applyEvent(myAddEvent);
    });
    renderer.init();
    const stream = new MockDataGenerator(orderBook, 80, (event) => {
        orderBook.applyEvent(event);
        myOrders.onBookEvent(event);
    });
    stream.start();
    const renderLoop = () => {
        renderer.render();
        window.requestAnimationFrame(renderLoop);
    };
    renderLoop();
}
bootstrap();
