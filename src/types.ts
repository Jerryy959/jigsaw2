export type Side = 'bid' | 'ask';

/**
 * 数量显示单位
 *   base  — 基础货币原始数量，与 Binance 网页默认显示一致 (e.g. BTC, SEI)
 *   quote — 计价货币价值 = 原始数量 × 当前价格 (e.g. USDT)，与 Binance 切换到 USDT 模式一致
 *   lots  — 最小合约张数 = 原始数量 / stepSize（历史显示方式，数字偏大）
 */
export type SizeUnit = 'base' | 'quote' | 'lots';

export interface BookEvent {
  type: 'add' | 'cancel' | 'trade';
  side: Side;
  price: number;
  size: number;
  timestamp: number;
  // For venues where depth stream is authoritative (e.g. Binance depth + trade),
  // set false to avoid reducing book size twice on trade + depth cancel.
  impactsLiquidity?: boolean;
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

export interface FootprintDisplayConfig {
  bucketSizeTicks: number;
  timeWindowMs: number;
  decayHalfLifeMs: number;
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