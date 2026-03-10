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

  const book = new OrderBook(3856, 0.25, 66);
  const mine = new MyOrderManager(book);

  const onEvent = (event: BookEvent): void => {
    book.applyEvent(event);
    mine.onBookEvent(event);
  };

  const renderer = new DOMRenderer(book, mine, app, (price: number, side: Side) => {
    const size = side === 'bid' ? 15 : 12;
    mine.placeOrder(side, price, size);
    onEvent({ type: 'add', side, price, size, timestamp: Date.now() });
  });
  renderer.init();

  const mock = new MockDataGenerator(book, 80, onEvent);
  mock.start();

  const loop = (): void => {
    renderer.render();
    requestAnimationFrame(loop);
  };
  loop();
}

bootstrap();
