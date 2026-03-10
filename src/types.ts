export type Side = 'bid' | 'ask';

export interface LevelState {
  price: number;
  bidSize: number;
  askSize: number;
  buyVolume: number;
  sellVolume: number;
}

export interface MyOrderState {
  id: string;
  side: Side;
  price: number;
  size: number;
  ahead: number;
}

export type BookEvent =
  | {
      type: 'add';
      side: Side;
      price: number;
      size: number;
    }
  | {
      type: 'cancel';
      side: Side;
      price: number;
      size: number;
    }
  | {
      type: 'trade';
      side: Side; // 主动打单方向，buy 表示吃 ask
      price: number;
      size: number;
    };
