import { DOMRenderer } from './DOMRenderer.js';
import { MockDataGenerator } from './MockDataGenerator.js';
import { MyOrderManager } from './MyOrderManager.js';
import { OrderBook } from './OrderBook.js';
import type { BookEvent, Side } from './types.js';

function bootstrap(): void {
  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing #app root element');
  }

  const orderBook = new OrderBook(100, 1, 38);
  const myOrders = new MyOrderManager(orderBook);

  const renderer = new DOMRenderer(orderBook, myOrders, app, (price: number, side: Side) => {
    const order = myOrders.placeOrder(side, price, 1);
    const myAddEvent: BookEvent = { type: 'add', side, price, size: order.size };
    orderBook.applyEvent(myAddEvent);
  });
  renderer.init();

  const stream = new MockDataGenerator(orderBook, 80, (event: BookEvent) => {
    orderBook.applyEvent(event);
    myOrders.onBookEvent(event);
  });
  stream.start();

  const renderLoop = (): void => {
    renderer.render();
    window.requestAnimationFrame(renderLoop);
  };
  renderLoop();
}

bootstrap();
