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
  buyTraded: number;
  sellTraded: number;
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

export interface DOMSnapshot {
  levels: BookLevel[];
  bestBid: number;
  bestAsk: number;
  maxBookSize: number;
  maxTradeSize: number;
}
