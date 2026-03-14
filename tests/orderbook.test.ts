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

describe('OrderBook footprint display config', () => {
  it('supports bucket aggregation, time window, and decay', () => {
    const now = Date.now();
    const book = new OrderBook(100, 1, 20, false);

    book.setFootprintDisplayConfig({ bucketSizeTicks: 2, timeWindowMs: 60000, decayHalfLifeMs: 0 });
    book.applyEvent({ type: 'trade', side: 'bid', price: 101, size: 10, timestamp: now - 1_000 });
    book.applyEvent({ type: 'trade', side: 'bid', price: 102, size: 5, timestamp: now - 1_000 });

    const snapBucket = book.getSnapshot();
    const l101 = snapBucket.levels.find((l) => l.price === 101);
    const l102 = snapBucket.levels.find((l) => l.price === 102);
    const l103 = snapBucket.levels.find((l) => l.price === 103);
    expect(Math.round((l101?.buyTraded ?? 0) * 1000) / 1000).toBe(15);
    expect(Math.round((l102?.buyTraded ?? 0) * 1000) / 1000).toBe(30);
    expect((l103?.buyTraded ?? 0)).toBeGreaterThanOrEqual(15);

    book.setFootprintDisplayConfig({ bucketSizeTicks: 1, timeWindowMs: 500, decayHalfLifeMs: 0 });
    const snapWindow = book.getSnapshot();
    const l101Window = snapWindow.levels.find((l) => l.price === 101);
    expect(l101Window?.buyTraded ?? 0).toBe(0);

    book.applyEvent({ type: 'trade', side: 'bid', price: 101, size: 8, timestamp: Date.now() - 2000 });
    book.setFootprintDisplayConfig({ bucketSizeTicks: 1, timeWindowMs: 0, decayHalfLifeMs: 1000 });
    const snapDecay = book.getSnapshot();
    const l101Decay = snapDecay.levels.find((l) => l.price === 101);
    expect((l101Decay?.buyTraded ?? 0)).toBeLessThan(8);
  });
});
