import { OrderBook } from './OrderBook.js';
import type { BookEvent, Side } from './types.js';

export interface MarketDataSource {
  start(): void;
  stop(): void;
  getName(): string;
}

export interface BinanceSourceConfig {
  symbol: string;
  tickSize: number;
  wsBaseUrl?: string;
}

interface DepthState {
  bid: Map<number, number>;
  ask: Map<number, number>;
}

interface BinanceDepthMessage {
  b?: Array<[string, string]>;
  a?: Array<[string, string]>;
}

interface BinanceTradeMessage {
  p?: string;
  q?: string;
  m?: boolean;
}

export class BinanceMarketDataSource implements MarketDataSource {
  private readonly depthState: DepthState = { bid: new Map(), ask: new Map() };
  private depthSocket: WebSocket | null = null;
  private tradeSocket: WebSocket | null = null;

  constructor(
    private readonly orderBook: OrderBook,
    private readonly onEvent: (event: BookEvent) => void,
    private readonly config: BinanceSourceConfig
  ) {}

  public getName(): string {
    return `binance:${this.config.symbol.toUpperCase()}`;
  }

  public start(): void {
    if (this.depthSocket || this.tradeSocket) {
      return;
    }

    const wsBase = this.config.wsBaseUrl ?? 'wss://stream.binance.com:9443/ws';
    const symbol = this.config.symbol.toLowerCase();

    this.depthSocket = this.openSocket(`${wsBase}/${symbol}@depth@100ms`, (payload) => {
      this.handleDepth(payload as BinanceDepthMessage);
    });

    this.tradeSocket = this.openSocket(`${wsBase}/${symbol}@trade`, (payload) => {
      this.handleTrade(payload as BinanceTradeMessage);
    });
  }

  public stop(): void {
    this.depthSocket?.close();
    this.tradeSocket?.close();
    this.depthSocket = null;
    this.tradeSocket = null;
    this.depthState.bid.clear();
    this.depthState.ask.clear();
  }

  private openSocket(url: string, onData: (payload: unknown) => void): WebSocket {
    const socket = new WebSocket(url);
    socket.onmessage = (event: MessageEvent<string>): void => {
      try {
        onData(JSON.parse(event.data) as unknown);
      } catch (error) {
        console.warn('[BinanceMarketDataSource] payload parse failed', error);
      }
    };
    socket.onerror = (error: Event): void => {
      console.error('[BinanceMarketDataSource] websocket error', error);
    };
    socket.onclose = (): void => {
      console.warn('[BinanceMarketDataSource] websocket closed:', url);
    };
    return socket;
  }

  private handleDepth(message: BinanceDepthMessage): void {
    this.applyDepthSide('bid', message.b ?? []);
    this.applyDepthSide('ask', message.a ?? []);
  }

  private applyDepthSide(side: Side, updates: Array<[string, string]>): void {
    const sideState = this.depthState[side];

    for (const [priceText, sizeText] of updates) {
      const rawPrice = Number(priceText);
      const nextSize = Number(sizeText);
      if (!Number.isFinite(rawPrice) || !Number.isFinite(nextSize)) {
        continue;
      }

      const price = this.orderBook.normalize(rawPrice);
      const previous = sideState.get(price) ?? 0;
      if (nextSize === previous) {
        continue;
      }

      const normalizedNext = this.normalizeToTick(nextSize);
      const normalizedPrev = this.normalizeToTick(previous);
      const delta = normalizedNext - normalizedPrev;

      if (delta > 0) {
        this.onEvent({ type: 'add', side, price, size: delta, timestamp: Date.now() });
      } else {
        this.onEvent({ type: 'cancel', side, price, size: Math.abs(delta), timestamp: Date.now() });
      }

      if (nextSize <= 0) {
        sideState.delete(price);
      } else {
        sideState.set(price, nextSize);
      }
    }
  }

  private handleTrade(message: BinanceTradeMessage): void {
    const rawPrice = Number(message.p);
    const rawSize = Number(message.q);
    if (!Number.isFinite(rawPrice) || !Number.isFinite(rawSize)) {
      return;
    }

    // Binance `m=true` means buyer is maker, so aggressive side is sell.
    const side: Side = message.m ? 'ask' : 'bid';
    this.onEvent({
      type: 'trade',
      side,
      price: this.orderBook.normalize(rawPrice),
      size: this.normalizeToTick(rawSize),
      timestamp: Date.now(),
    });
  }

  private normalizeToTick(size: number): number {
    return Math.max(0, Number((size / this.config.tickSize).toFixed(4)));
  }
}
