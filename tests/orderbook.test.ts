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
  it('keeps small-price symbols at fine precision', () => {
    const book = new OrderBook(0.065, 0.0001, 20, false);
    book.applyEvent({ type: 'add', side: 'bid', price: 0.0654, size: 1, timestamp: 1 });
    const prices = book.getPrices();

    expect(prices).toContain(0.0654);
    expect(book.formatPrice(0.0654)).toBe('0.0654');
  });
});
