import { OrderBook } from './OrderBook.js';
import { MyOrderManager } from './MyOrderManager.js';
import type { DOMSnapshot, Side } from './types.js';

interface RectDraw {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export class DOMRenderer {
  private readonly width = 900;
  private readonly height = 1080;
  private readonly rowH = 20;
  private readonly top = 44;
  private readonly visibleRows = 48;

  private glCanvas!: HTMLCanvasElement;
  private uiCanvas!: HTMLCanvasElement;
  private gl!: WebGLRenderingContext;
  private ctx!: CanvasRenderingContext2D;
  private program!: WebGLProgram;
  private buffer!: WebGLBuffer;
  private posLoc = -1;
  private colorLoc = -1;
  private scrollOffset = 0;

  // Column order: bid book | bid footprint | price | ask footprint | ask book
  private readonly colBidBook = 10;
  private readonly colBidFoot = 195;
  private readonly colPrice = 305;
  private readonly colAskFoot = 415;
  private readonly colAskBook = 525;

  constructor(
    private readonly orderBook: OrderBook,
    private readonly myOrders: MyOrderManager,
    private readonly mountEl: HTMLElement,
    private readonly onClickOrder: (price: number, side: Side, action: 'place' | 'cancel') => void
  ) {}

  public init(): void {
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.style.width = `${this.width}px`;
    wrap.style.height = `${this.height}px`;

    this.glCanvas = document.createElement('canvas');
    this.glCanvas.width = this.width;
    this.glCanvas.height = this.height;
    this.glCanvas.style.position = 'absolute';

    this.uiCanvas = document.createElement('canvas');
    this.uiCanvas.width = this.width;
    this.uiCanvas.height = this.height;
    this.uiCanvas.style.position = 'absolute';

    wrap.append(this.glCanvas, this.uiCanvas);
    this.mountEl.appendChild(wrap);

    const gl = this.glCanvas.getContext('webgl');
    const ctx = this.uiCanvas.getContext('2d');
    if (!gl || !ctx) {
      throw new Error('missing canvas context');
    }
    this.gl = gl;
    this.ctx = ctx;
    this.initGL();

    this.uiCanvas.addEventListener('click', this.handleClick);
    this.uiCanvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  public render(): void {
    const snap = this.orderBook.getSnapshot();
    const { windowLevels, anchorIndex } = this.pickWindow(snap);
    const now = Date.now();

    const rects: RectDraw[] = [];
    windowLevels.forEach((l, i) => {
      const y = this.top + i * this.rowH;
      const bidRatio = l.bidSize / snap.maxBookSize;
      const askRatio = l.askSize / snap.maxBookSize;
      const buyTradeRatio = l.buyTraded / snap.maxTradeSize;
      const sellTradeRatio = l.sellTraded / snap.maxTradeSize;

      if (i % 2 === 0) {
        rects.push({ x: 0, y, w: this.width, h: this.rowH - 1, r: 0.03, g: 0.15, b: 0.2, a: 0.16 });
      }

      // current and +-2 rows highlighted across all columns (dark, eye-friendly blend)
      if (anchorIndex >= 0 && Math.abs(i - anchorIndex) <= 2) {
        rects.push({ x: 0, y, w: this.width, h: this.rowH - 1, r: 0.14, g: 0.2, b: 0.27, a: i === anchorIndex ? 0.52 : 0.2 });
      }

      // bid/ask palette closer to jigsaw
      rects.push({ x: this.colBidBook + 170 * (1 - bidRatio), y: y + 1, w: 170 * bidRatio, h: this.rowH - 2, r: 0.24, g: 0.55, b: 0.78, a: 0.86 });
      rects.push({ x: this.colAskBook, y: y + 1, w: 170 * askRatio, h: this.rowH - 2, r: 0.78, g: 0.36, b: 0.33, a: 0.86 });

      // footprint cumulative columns
      rects.push({ x: this.colBidFoot + 100 * (1 - sellTradeRatio), y: y + 1, w: 100 * sellTradeRatio, h: this.rowH - 2, r: 0.2, g: 0.43, b: 0.68, a: 0.78 });
      rects.push({ x: this.colAskFoot, y: y + 1, w: 100 * buyTradeRatio, h: this.rowH - 2, r: 0.69, g: 0.3, b: 0.31, a: 0.78 });

      // taker flashes animation
      if (l.bidFlashUntil > now) {
        rects.push({ x: this.colBidBook, y: y + 1, w: 170, h: this.rowH - 2, r: 0.42, g: 0.82, b: 1, a: 0.28 });
      }
      if (l.askFlashUntil > now) {
        rects.push({ x: this.colAskBook, y: y + 1, w: 170, h: this.rowH - 2, r: 1, g: 0.46, b: 0.46, a: 0.28 });
      }
      if (l.sellFlashUntil > now) {
        rects.push({ x: this.colBidFoot, y: y + 1, w: 100, h: this.rowH - 2, r: 0.4, g: 0.72, b: 1, a: 0.22 });
      }
      if (l.buyFlashUntil > now) {
        rects.push({ x: this.colAskFoot, y: y + 1, w: 100, h: this.rowH - 2, r: 1, g: 0.56, b: 0.56, a: 0.22 });
      }

      if (this.myOrders.getTopOrderAt(l.price, 'bid')) {
        rects.push({ x: this.colBidBook - 5, y: y + 1, w: 5, h: this.rowH - 2, r: 1, g: 0.92, b: 0.3, a: 1 });
      }
      if (this.myOrders.getTopOrderAt(l.price, 'ask')) {
        rects.push({ x: this.colAskBook + 172, y: y + 1, w: 5, h: this.rowH - 2, r: 1, g: 0.92, b: 0.3, a: 1 });
      }
    });

    this.drawRects(rects);
    this.drawTexts(snap, windowLevels, anchorIndex);
  }

  private pickWindow(snap: DOMSnapshot): { windowLevels: DOMSnapshot['levels']; anchorIndex: number } {
    const total = snap.levels.length;
    const currentIdx = snap.levels.findIndex((l) => l.price === snap.currentPrice);
    const baseCenter = currentIdx < 0 ? Math.floor(total / 2) : currentIdx;
    const center = Math.max(0, Math.min(total - 1, baseCenter + this.scrollOffset));
    const half = Math.floor(this.visibleRows / 2);
    const start = Math.max(0, Math.min(total - this.visibleRows, center - half));
    const end = Math.min(total, start + this.visibleRows);
    const windowLevels = snap.levels.slice(start, end);
    // anchor current price to true market row; do not move current highlight with manual wheel scroll.
    const anchorIndex = currentIdx < start || currentIdx >= end ? -1 : currentIdx - start;
    return { windowLevels, anchorIndex };
  }

  private drawTexts(snap: DOMSnapshot, levels: DOMSnapshot['levels'], anchorIndex: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#202a34';
    ctx.fillRect(0, 0, this.width, this.top - 2);

    ctx.fillStyle = '#d5e3ee';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('BID BOOK', this.colBidBook + 45, 24);
    ctx.fillText('SELL CUM', this.colBidFoot + 20, 24);
    ctx.fillText('PRICE', this.colPrice + 33, 24);
    ctx.fillText('BUY CUM', this.colAskFoot + 22, 24);
    ctx.fillText('ASK BOOK', this.colAskBook + 45, 24);

    ctx.font = '15px monospace';
    levels.forEach((l, i) => {
      const y = this.top + i * this.rowH + 15;
      const myBid = this.myOrders.getTopOrderAt(l.price, 'bid');
      const myAsk = this.myOrders.getTopOrderAt(l.price, 'ask');

      ctx.fillStyle = '#d8ecfc';
      ctx.fillText(Math.round(l.bidSize).toString(), this.colBidBook + 7, y);
      ctx.fillStyle = '#c5dbf3';
      ctx.fillText(Math.round(l.sellTraded).toString(), this.colBidFoot + 8, y);
      ctx.fillStyle = i === anchorIndex ? '#ffffff' : '#e8ecef';
      ctx.font = i === anchorIndex ? 'bold 16px monospace' : '15px monospace';
      ctx.fillText(this.orderBook.formatPrice(l.price), this.colPrice + 10, y);
      ctx.fillStyle = '#f7d4d4';
      ctx.fillText(Math.round(l.buyTraded).toString(), this.colAskFoot + 8, y);
      ctx.fillStyle = '#ffe2e2';
      ctx.fillText(Math.round(l.askSize).toString(), this.colAskBook + 7, y);

      ctx.font = '11px sans-serif';
      if (myBid) {
        ctx.fillStyle = '#ffeb7a';
        ctx.fillText(`#${Math.floor(myBid.aheadVolume) + 1}`, this.colBidBook + 120, y - 2);
      }
      if (myAsk) {
        ctx.fillStyle = '#ffeb7a';
        ctx.fillText(`#${Math.floor(myAsk.aheadVolume) + 1}`, this.colAskBook + 120, y - 2);
      }

      if (myBid || myAsk) {
        // highlight row border once my order is resting on this price
        ctx.strokeStyle = '#83fff2';
        ctx.lineWidth = 1;
        ctx.strokeRect(1, this.top + i * this.rowH + 1, this.width - 2, this.rowH - 2);
      }
      if (i === anchorIndex) {
        ctx.strokeStyle = '#f8fd70';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.colPrice - 6, this.top + i * this.rowH + 1, 116, this.rowH - 2);
      }

      ctx.font = '15px monospace';
    });

    ctx.fillStyle = '#93a9bb';
    ctx.font = '11px sans-serif';
    ctx.fillText(`current: ${this.orderBook.formatPrice(snap.currentPrice)}  bestBid: ${this.orderBook.formatPrice(snap.bestBid)}  bestAsk: ${this.orderBook.formatPrice(snap.bestAsk)}`, 10, this.height - 12);
  }

  private drawRects(rects: RectDraw[]): void {
    const data: number[] = [];
    const clipX = (x: number) => (x / this.width) * 2 - 1;
    const clipY = (y: number) => 1 - (y / this.height) * 2;

    for (const r of rects) {
      const x1 = clipX(r.x);
      const y1 = clipY(r.y);
      const x2 = clipX(r.x + r.w);
      const y2 = clipY(r.y + r.h);
      data.push(
        x1, y1, r.r, r.g, r.b, r.a,
        x2, y1, r.r, r.g, r.b, r.a,
        x1, y2, r.r, r.g, r.b, r.a,
        x1, y2, r.r, r.g, r.b, r.a,
        x2, y1, r.r, r.g, r.b, r.a,
        x2, y2, r.r, r.g, r.b, r.a
      );
    }

    this.gl.viewport(0, 0, this.width, this.height);
    this.gl.clearColor(0.02, 0.11, 0.16, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.useProgram(this.program);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(data), this.gl.DYNAMIC_DRAW);

    const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
    this.gl.enableVertexAttribArray(this.posLoc);
    this.gl.vertexAttribPointer(this.posLoc, 2, this.gl.FLOAT, false, stride, 0);
    this.gl.enableVertexAttribArray(this.colorLoc);
    this.gl.vertexAttribPointer(this.colorLoc, 4, this.gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, data.length / 6);
  }

  private initGL(): void {
    const vert = `
      attribute vec2 a_pos;
      attribute vec4 a_col;
      varying vec4 v_col;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_col = a_col;
      }
    `;
    const frag = `
      precision mediump float;
      varying vec4 v_col;
      void main() {
        gl_FragColor = v_col;
      }
    `;

    const vs = this.compile(this.gl.VERTEX_SHADER, vert);
    const fs = this.compile(this.gl.FRAGMENT_SHADER, frag);
    this.program = this.link(vs, fs);
    this.posLoc = this.gl.getAttribLocation(this.program, 'a_pos');
    this.colorLoc = this.gl.getAttribLocation(this.program, 'a_col');
    this.buffer = this.gl.createBuffer() as WebGLBuffer;
  }

  private compile(type: number, source: string): WebGLShader {
    const s = this.gl.createShader(type) as WebGLShader;
    this.gl.shaderSource(s, source);
    this.gl.compileShader(s);
    return s;
  }

  private link(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const p = this.gl.createProgram() as WebGLProgram;
    this.gl.attachShader(p, vs);
    this.gl.attachShader(p, fs);
    this.gl.linkProgram(p);
    return p;
  }

  private handleWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    this.scrollOffset += ev.deltaY > 0 ? 1 : -1;
    this.scrollOffset = Math.max(-200, Math.min(200, this.scrollOffset));
  };

  private handleClick = (ev: MouseEvent): void => {
    const rect = this.uiCanvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const row = Math.floor((y - this.top) / this.rowH);
    const snap = this.orderBook.getSnapshot();
    const { windowLevels } = this.pickWindow(snap);

    if (row < 0 || row >= windowLevels.length) {
      return;
    }

    const price = windowLevels[row].price;
    const side: Side = x < this.colPrice + 60 ? 'bid' : 'ask';
    const hasMine = this.myOrders.getTopOrderAt(price, side);
    this.onClickOrder(price, side, hasMine ? 'cancel' : 'place');
  };
}
