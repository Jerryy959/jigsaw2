import { describe, expect, it, vi } from 'vitest';
import { createRealtimeSource, resolveDefaultSymbol } from '../src/MarketDataSource.js';
import { OrderBook } from '../src/OrderBook.js';

describe('Realtime exchange source selection', () => {
  it('builds a Binance futures source with normalized symbol', () => {
    const source = createRealtimeSource(new OrderBook(), vi.fn(), {
      exchange: 'binance',
      market: 'futures',
      symbol: 'BTCUSDT',
      tickSize: 0.0001,
    });

    expect(source.getName()).toBe('binance:futures:BTCUSDT');
  });

  it('builds a Bybit spot source with normalized symbol', () => {
    const source = createRealtimeSource(new OrderBook(), vi.fn(), {
      exchange: 'bybit',
      market: 'spot',
      symbol: 'btcusdt',
      tickSize: 0.0001,
    });

    expect(source.getName()).toBe('bybit:spot:BTCUSDT');
  });

  it('returns exchange-aware default symbols', () => {
    expect(resolveDefaultSymbol('binance', 'spot')).toBe('btcusdt');
    expect(resolveDefaultSymbol('bybit', 'futures')).toBe('BTCUSDT');
  });
});
