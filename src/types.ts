export type Side = 'bid' | 'ask';

export interface BookEvent {
  type: 'add' | 'cancel' | 'trade';
  side: Side;
  price: number;
  size: number;
  timestamp: number;
}

export interface BookLevel {
  price: number;
  bidSize: number;
  askSize: number;
  buyTraded: number; // aggressive buy cumulative at this price
  sellTraded: number; // aggressive sell cumulative at this price
  buyFlashUntil: number;
  sellFlashUntil: number;
  bidFlashUntil: number;
  askFlashUntil: number;
}

export interface MyOrder {
  id: string;
  side: Side;
  price: number;
  size: number;
  remaining: number;
  aheadVolume: number;
  createdAt: number;
}

export interface FillNotice {
  orderId: string;
  side: Side;
  price: number;
  fillSize: number;
  remaining: number;
}

export interface DOMSnapshot {
  levels: BookLevel[];
  bestBid: number;
  bestAsk: number;
  currentPrice: number;
  maxBookSize: number;
  maxTradeSize: number;
}

export interface MockConfig {
  addWeight: number;
  cancelWeight: number;
  tradeWeight: number;
  burstChance: number;
}
