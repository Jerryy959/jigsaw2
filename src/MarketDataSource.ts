import { OrderBook } from './OrderBook.js';
import type { BookEvent, Side } from './types.js';

export interface MarketDataSource {
  start(): void;
  stop(): void;
  getName(): string;
}

export type Exchange = 'binance' | 'bybit';
export type MarketType = 'spot' | 'futures';

export interface RealtimeSourceConfig {
  exchange: Exchange;
  market: MarketType;
  symbol: string;
  tickSize: number;
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

interface BybitOrderBookMessage {
  topic?: string;
  type?: 'snapshot' | 'delta';
  data?: {
    b?: Array<[string, string]>;
    a?: Array<[string, string]>;
  };
}

interface BybitTradeMessage {
  topic?: string;
  data?: Array<{
    p?: string;
    v?: string;
    S?: 'Buy' | 'Sell';
  }>;
}

interface SourceRuntimeDeps {
  orderBook: OrderBook;
  onEvent: (event: BookEvent) => void;
  symbol: string;
  tickSize: number;
}

interface OrderBookUpdates {
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  resetState: boolean;
}

interface TradePayload {
  price: string;
  size: string;
  aggressiveSide: Side;
}

export function resolveDefaultSymbol(exchange: Exchange, market: MarketType): string {
  if (exchange === 'bybit' && market === 'futures') {
    return 'BTCUSDT';
  }
  return 'btcusdt';
}

function normalizeSymbol(exchange: Exchange, symbol: string): string {
  return exchange === 'binance' ? symbol.toLowerCase() : symbol.toUpperCase();
}

abstract class BaseRealtimeSource implements MarketDataSource {
  private readonly depthState: DepthState = { bid: new Map(), ask: new Map() };
  private sockets: WebSocket[] = [];
  private hasFocusedFromDepth = false;

  constructor(protected readonly deps: SourceRuntimeDeps) {}

  public start(): void {
    if (this.sockets.length > 0) {
      return;
    }
    this.sockets = this.createSockets();
  }

  public stop(): void {
    this.sockets.forEach((socket) => socket.close());
    this.sockets = [];
    this.depthState.bid.clear();
    this.depthState.ask.clear();
    this.hasFocusedFromDepth = false;
  }

  public abstract getName(): string;

  protected abstract createSockets(): WebSocket[];

  protected openSocket(url: string, onData: (payload: unknown) => void, onOpen?: (socket: WebSocket) => void): WebSocket {
    const socket = new WebSocket(url);
    socket.onopen = () => {
      onOpen?.(socket);
    };
    socket.onmessage = (event: MessageEvent<string>): void => {
      try {
        onData(JSON.parse(event.data) as unknown);
      } catch (error) {
        console.warn(`[${this.getName()}] payload parse failed`, error);
      }
    };
    socket.onerror = (error: Event): void => {
      console.error(`[${this.getName()}] websocket error`, error);
    };
    socket.onclose = (): void => {
      console.warn(`[${this.getName()}] websocket closed:`, url);
    };
    return socket;
  }

  protected applyOrderBookUpdates(message: OrderBookUpdates): void {
    if (message.resetState) {
      this.depthState.bid.clear();
      this.depthState.ask.clear();
    }
    this.applyDepthSide('bid', message.bids);
    this.applyDepthSide('ask', message.asks);
    this.focusCurrentPriceFromDepthOnce();
  }

  private focusCurrentPriceFromDepthOnce(): void {
    if (this.hasFocusedFromDepth || !this.depthState.bid.size || !this.depthState.ask.size) {
      return;
    }

    const bestBid = Math.max(...this.depthState.bid.keys());
    const bestAsk = Math.min(...this.depthState.ask.keys());
    this.deps.orderBook.setCurrentPrice((bestBid + bestAsk) / 2);
    this.hasFocusedFromDepth = true;
  }

  protected applyTrade(payload: TradePayload): void {
    const rawPrice = Number(payload.price);
    const rawSize = Number(payload.size);
    if (!Number.isFinite(rawPrice) || !Number.isFinite(rawSize)) {
      return;
    }

    this.deps.onEvent({
      type: 'trade',
      side: payload.aggressiveSide,
      price: this.deps.orderBook.normalize(rawPrice),
      size: this.normalizeToTick(rawSize),
      timestamp: Date.now(),
      impactsLiquidity: false,
    });
  }

  private applyDepthSide(side: Side, updates: Array<[string, string]>): void {
    const sideState = this.depthState[side];

    for (const [priceText, sizeText] of updates) {
      const rawPrice = Number(priceText);
      const nextSize = Number(sizeText);
      if (!Number.isFinite(rawPrice) || !Number.isFinite(nextSize)) {
        continue;
      }

      const price = this.deps.orderBook.normalize(rawPrice);
      const previous = sideState.get(price) ?? 0;
      if (nextSize === previous) {
        continue;
      }

      const normalizedNext = this.normalizeToTick(nextSize);
      const normalizedPrev = this.normalizeToTick(previous);
      const delta = normalizedNext - normalizedPrev;

      if (delta > 0) {
        this.deps.onEvent({ type: 'add', side, price, size: delta, timestamp: Date.now() });
      } else {
        this.deps.onEvent({ type: 'cancel', side, price, size: Math.abs(delta), timestamp: Date.now() });
      }

      if (nextSize <= 0) {
        sideState.delete(price);
      } else {
        sideState.set(price, nextSize);
      }
    }
  }

  protected normalizeToTick(size: number): number {
    return Math.max(0, Number((size / this.deps.tickSize).toFixed(4)));
  }
}

export class BinanceMarketDataSource extends BaseRealtimeSource {
  private readonly wsBaseUrl: string;

  constructor(
    orderBook: OrderBook,
    onEvent: (event: BookEvent) => void,
    private readonly config: { symbol: string; tickSize: number; market: MarketType; wsBaseUrl?: string }
  ) {
    super({ orderBook, onEvent, symbol: config.symbol.toLowerCase(), tickSize: config.tickSize });
    this.wsBaseUrl = config.wsBaseUrl ?? (config.market === 'futures' ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws');
  }

  public getName(): string {
    return `binance:${this.config.market}:${this.deps.symbol.toUpperCase()}`;
  }

  protected createSockets(): WebSocket[] {
    const depthSocket = this.openSocket(`${this.wsBaseUrl}/${this.deps.symbol}@depth@100ms`, (payload) => {
      const message = payload as BinanceDepthMessage;
      this.applyOrderBookUpdates({ bids: message.b ?? [], asks: message.a ?? [], resetState: false });
    });

    const tradeSocket = this.openSocket(`${this.wsBaseUrl}/${this.deps.symbol}@trade`, (payload) => {
      const message = payload as BinanceTradeMessage;
      this.applyTrade({
        price: message.p ?? '',
        size: message.q ?? '',
        // Binance `m=true` means buyer is maker, so aggressive side is sell.
        aggressiveSide: message.m ? 'ask' : 'bid',
      });
    });

    return [depthSocket, tradeSocket];
  }
}

export class BybitMarketDataSource extends BaseRealtimeSource {
  private readonly wsBaseUrl: string;

  constructor(
    orderBook: OrderBook,
    onEvent: (event: BookEvent) => void,
    private readonly config: { symbol: string; tickSize: number; market: MarketType; wsBaseUrl?: string }
  ) {
    super({ orderBook, onEvent, symbol: config.symbol.toUpperCase(), tickSize: config.tickSize });
    const marketChannel = config.market === 'futures' ? 'linear' : 'spot';
    this.wsBaseUrl = config.wsBaseUrl ?? `wss://stream.bybit.com/v5/public/${marketChannel}`;
  }

  public getName(): string {
    return `bybit:${this.config.market}:${this.deps.symbol}`;
  }

  protected createSockets(): WebSocket[] {
    const depthTopic = `orderbook.50.${this.deps.symbol}`;
    const tradeTopic = `publicTrade.${this.deps.symbol}`;

    const depthSocket = this.openSocket(
      this.wsBaseUrl,
      (payload) => {
        const message = payload as BybitOrderBookMessage;
        if (message.topic !== depthTopic || !message.data) {
          return;
        }
        this.applyOrderBookUpdates({
          bids: message.data.b ?? [],
          asks: message.data.a ?? [],
          resetState: message.type === 'snapshot',
        });
      },
      (socket) => {
        socket.send(JSON.stringify({ op: 'subscribe', args: [depthTopic] }));
      }
    );

    const tradeSocket = this.openSocket(
      this.wsBaseUrl,
      (payload) => {
        const message = payload as BybitTradeMessage;
        if (message.topic !== tradeTopic || !message.data) {
          return;
        }
        for (const trade of message.data) {
          this.applyTrade({
            price: trade.p ?? '',
            size: trade.v ?? '',
            aggressiveSide: trade.S === 'Sell' ? 'ask' : 'bid',
          });
        }
      },
      (socket) => {
        socket.send(JSON.stringify({ op: 'subscribe', args: [tradeTopic] }));
      }
    );

    return [depthSocket, tradeSocket];
  }
}

export function createRealtimeSource(
  orderBook: OrderBook,
  onEvent: (event: BookEvent) => void,
  config: RealtimeSourceConfig
): MarketDataSource {
  const normalizedSymbol = normalizeSymbol(config.exchange, config.symbol);
  if (config.exchange === 'bybit') {
    return new BybitMarketDataSource(orderBook, onEvent, {
      symbol: normalizedSymbol,
      tickSize: config.tickSize,
      market: config.market,
    });
  }

  return new BinanceMarketDataSource(orderBook, onEvent, {
    symbol: normalizedSymbol,
    tickSize: config.tickSize,
    market: config.market,
  });
}
