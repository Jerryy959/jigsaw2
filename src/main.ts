import { DOMRenderer } from './DOMRenderer.js';
import { MockDataGenerator } from './MockDataGenerator.js';
import { MyOrderManager } from './MyOrderManager.js';
import { MockMatchingEngine } from './MockMatchingEngine.js';
import { OrderBook } from './OrderBook.js';
import type { BookEvent, Side } from './types.js';

function bootstrap(): void {
  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing #app root');
  }

  const book = new OrderBook(3856, 0.25, 160);
  const mine = new MyOrderManager(book);

  const applyEvent = (event: BookEvent): void => {
    book.applyEvent(event);
    mine.onBookEvent(event);
  };

  const matcher = new MockMatchingEngine(book, mine, (fillEvent: BookEvent) => {
    applyEvent(fillEvent);
  });

  const onMarketEvent = (event: BookEvent): void => {
    applyEvent(event);
    matcher.onMarketEvent(event);
  };

  const renderer = new DOMRenderer(book, mine, app, (price: number, side: Side, action: 'place' | 'cancel') => {
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

  const loop = (): void => {
    renderer.render();
    requestAnimationFrame(loop);
  };
  loop();
}

bootstrap();
