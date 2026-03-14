import { describe, expect, it } from 'vitest';
import { OrderBook } from '../src/OrderBook.js';

describe('OrderBook trade liquidity impact', () => {
  it('does not reduce passive liquidity when impactsLiquidity=false', () => {
    const book = new OrderBook(100, 1, 20, false);
    book.applyEvent({ type: 'add', side: 'ask', price: 101, size: 10, timestamp: 1 });

    book.applyEvent({
      type: 'trade',
      side: 'bid',
      price: 101,
      size: 3,
      timestamp: 2,
      impactsLiquidity: false,
    });

    expect(book.getLiquidity(101, 'ask')).toBe(10);
  });

  it('reduces passive liquidity by default on trade', () => {
    const book = new OrderBook(100, 1, 20, false);
    book.applyEvent({ type: 'add', side: 'ask', price: 101, size: 10, timestamp: 1 });
    book.applyEvent({ type: 'trade', side: 'bid', price: 101, size: 4, timestamp: 2 });

    expect(book.getLiquidity(101, 'ask')).toBe(6);
  });
});

describe('OrderBook price precision', () => {
  it('keeps current price within visible ladder range after large symbol price jump', () => {
    const book = new OrderBook(70000, 0.0001, 160, false);
    book.setCurrentPrice(0.0655);

    const prices = book.getPrices();
    expect(prices).toContain(0.0655);

    const sortedDesc = [...prices].sort((a, b) => b - a);
    const currentIdx = sortedDesc.findIndex((price) => price === 0.0655);
    expect(currentIdx).toBeGreaterThanOrEqual(56);
    expect(currentIdx).toBeLessThanOrEqual(104);
  });

  it('keeps small-price symbols at fine precision', () => {
    const book = new OrderBook(0.065, 0.0001, 20, false);
    book.applyEvent({ type: 'add', side: 'bid', price: 0.0654, size: 1, timestamp: 1 });
    const prices = book.getPrices();

    expect(prices).toContain(0.0654);
    expect(book.formatPrice(0.0654)).toBe('0.0654');
  });
});

describe('OrderBook session cumulative footprint', () => {
  it('starts at 0 on new book and keeps accumulating until page refresh', () => {
    const book = new OrderBook(100, 1, 30, false);
    book.applyEvent({ type: 'add', side: 'bid', price: 99, size: 20, timestamp: 1 });
    book.applyEvent({ type: 'add', side: 'ask', price: 101, size: 20, timestamp: 1 });

    const snap0 = book.getSnapshot();
    const l99_0 = snap0.levels.find((l) => l.price === 99);
    const l101_0 = snap0.levels.find((l) => l.price === 101);
    expect(l99_0?.sellTraded ?? 0).toBe(0);
    expect(l101_0?.buyTraded ?? 0).toBe(0);

    book.applyEvent({ type: 'trade', side: 'ask', price: 99, size: 3, timestamp: 2 });
    book.applyEvent({ type: 'trade', side: 'ask', price: 98, size: 5, timestamp: 3 });
    book.applyEvent({ type: 'trade', side: 'bid', price: 101, size: 4, timestamp: 4 });
    book.applyEvent({ type: 'trade', side: 'bid', price: 102, size: 6, timestamp: 5 });

    const snap1 = book.getSnapshot();
    const l98 = snap1.levels.find((l) => l.price === 98);
    const l99 = snap1.levels.find((l) => l.price === 99);
    const l101 = snap1.levels.find((l) => l.price === 101);
    const l102 = snap1.levels.find((l) => l.price === 102);

    // SELL CUM: deeper bid <= bestBid should not be flat and should grow toward best bid.
    expect((l98?.sellTraded ?? 0)).toBeGreaterThan(0);
    expect((l99?.sellTraded ?? 0)).toBeGreaterThan(l98?.sellTraded ?? 0);

    // BUY CUM: deeper ask >= bestAsk should not be flat and should grow toward best ask.
    expect((l102?.buyTraded ?? 0)).toBeGreaterThan(0);
    expect((l101?.buyTraded ?? 0)).toBeGreaterThan(l102?.buyTraded ?? 0);

    // same session keeps accumulating
    book.applyEvent({ type: 'trade', side: 'ask', price: 99, size: 2, timestamp: 6 });
    const snap2 = book.getSnapshot();
    const l99_2 = snap2.levels.find((l) => l.price === 99);
    expect((l99_2?.sellTraded ?? 0)).toBeGreaterThan(l99?.sellTraded ?? 0);

    // page refresh => new OrderBook instance => reset to 0
    const freshBook = new OrderBook(100, 1, 30, false);
    freshBook.applyEvent({ type: 'add', side: 'bid', price: 99, size: 20, timestamp: 1 });
    freshBook.applyEvent({ type: 'add', side: 'ask', price: 101, size: 20, timestamp: 1 });
    const freshSnap = freshBook.getSnapshot();
    const freshL99 = freshSnap.levels.find((l) => l.price === 99);
    const freshL101 = freshSnap.levels.find((l) => l.price === 101);
    expect(freshL99?.sellTraded ?? 0).toBe(0);
    expect(freshL101?.buyTraded ?? 0).toBe(0);
  });
});
