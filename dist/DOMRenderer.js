// Column layout: bid book | bid footprint | price | ask footprint | ask book
const COL_BID_BOOK = 10;
const COL_BID_FOOT = 195;
const COL_PRICE = 305;
const COL_ASK_FOOT = 415;
const COL_ASK_BOOK = 525;
const WIDTH = 900;
const HEIGHT = 1080;
const ROW_H = 20;
const HEADER_H = 44;
const VISIBLE_ROWS = 48;
export class DOMRenderer {
    constructor(orderBook, myOrders, mountEl, onClickOrder) {
        this.orderBook = orderBook;
        this.myOrders = myOrders;
        this.mountEl = mountEl;
        this.onClickOrder = onClickOrder;
        this.posLoc = -1;
        this.colorLoc = -1;
        this.targetScrollOffset = 0;
        this.displayScrollOffset = 0;
        this.wheelAccumulator = 0;
        this.hoverRow = -1;
        this.lastCurrentPrice = null;
        this.isContextLost = false;
        this.autoFocusLocked = true;
        this.sizeUnit = 'base';
        // ── Event handlers ────────────────────────────────────────────────────────
        this.handleWheel = (ev) => {
            if (this.autoFocusLocked)
                return;
            ev.preventDefault();
            const scale = ev.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : ev.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 120 : 1;
            this.wheelAccumulator += ev.deltaY * scale;
            const threshold = ev.shiftKey ? 18 : 36;
            const steps = Math.trunc(this.wheelAccumulator / threshold);
            if (steps !== 0) {
                this.adjustScroll(steps);
                this.wheelAccumulator -= steps * threshold;
            }
        };
        this.handleMouseMove = (ev) => {
            const y = ev.clientY - this.uiCanvas.getBoundingClientRect().top;
            const row = Math.floor((y - HEADER_H) / ROW_H);
            this.hoverRow = row >= 0 && row < VISIBLE_ROWS ? row : -1;
        };
        this.handleMouseLeave = () => { this.hoverRow = -1; };
        this.handleDoubleClick = () => { this.resetScroll(); };
        this.handleKeydown = (ev) => {
            const tag = ev.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
                return;
            if (ev.key === 'Home') {
                this.resetScroll();
                ev.preventDefault();
                return;
            }
            if (this.autoFocusLocked)
                return;
            if (ev.key === 'ArrowUp') {
                this.adjustScroll(-1);
                ev.preventDefault();
            }
            if (ev.key === 'ArrowDown') {
                this.adjustScroll(1);
                ev.preventDefault();
            }
        };
        this.handleClick = (ev) => {
            const rect = this.uiCanvas.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const y = ev.clientY - rect.top;
            const row = Math.floor((y - HEADER_H) / ROW_H);
            const { windowLevels } = this.pickWindow(this.orderBook.getSnapshot());
            if (row < 0 || row >= windowLevels.length)
                return;
            const price = windowLevels[row].price;
            const side = x < COL_PRICE + 60 ? 'bid' : 'ask';
            this.onClickOrder(price, side, this.myOrders.getTopOrderAt(price, side) ? 'cancel' : 'place');
        };
        this.handleContextLost = (ev) => { ev.preventDefault(); this.isContextLost = true; };
        this.handleContextRestored = () => { this.isContextLost = false; this.initGL(); this.render(); };
    }
    init() {
        const wrap = document.createElement('div');
        wrap.style.cssText = `position:relative;width:${WIDTH}px;height:${HEIGHT}px`;
        this.glCanvas = this.makeCanvas();
        this.uiCanvas = this.makeCanvas();
        wrap.append(this.glCanvas, this.uiCanvas);
        this.mountEl.appendChild(wrap);
        const gl = this.glCanvas.getContext('webgl');
        const ctx = this.uiCanvas.getContext('2d');
        if (!gl || !ctx)
            throw new Error('missing canvas context');
        this.gl = gl;
        this.ctx = ctx;
        this.initGL();
        this.uiCanvas.addEventListener('click', this.handleClick);
        this.uiCanvas.addEventListener('dblclick', this.handleDoubleClick);
        this.uiCanvas.addEventListener('mousemove', this.handleMouseMove);
        this.uiCanvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.uiCanvas.addEventListener('wheel', this.handleWheel, { passive: false });
        window.addEventListener('keydown', this.handleKeydown);
        this.glCanvas.addEventListener('webglcontextlost', this.handleContextLost);
        this.glCanvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    }
    makeCanvas() {
        const c = document.createElement('canvas');
        c.width = WIDTH;
        c.height = HEIGHT;
        c.style.position = 'absolute';
        return c;
    }
    setAutoFocusLocked(locked) {
        this.autoFocusLocked = locked;
        if (locked) {
            this.targetScrollOffset = 0;
            this.wheelAccumulator = 0;
        }
    }
    setSizeUnit(unit) {
        this.sizeUnit = unit;
    }
    recoverAfterTabSwitch() {
        if (this.isContextLost || this.gl.isContextLost())
            return;
        this.gl.viewport(0, 0, WIDTH, HEIGHT);
        this.render();
    }
    render() {
        const snap = this.orderBook.getSnapshot();
        if (this.lastCurrentPrice !== null && snap.currentPrice !== this.lastCurrentPrice && this.autoFocusLocked) {
            this.targetScrollOffset = 0;
        }
        this.lastCurrentPrice = snap.currentPrice;
        const smoothFactor = this.autoFocusLocked ? 0.32 : 0.24;
        this.displayScrollOffset += (this.targetScrollOffset - this.displayScrollOffset) * smoothFactor;
        if (Math.abs(this.targetScrollOffset - this.displayScrollOffset) < 0.02) {
            this.displayScrollOffset = this.targetScrollOffset;
        }
        const { windowLevels, anchorIndex } = this.pickWindow(snap);
        const now = Date.now();
        const rects = [];
        windowLevels.forEach((l, i) => {
            const y = HEADER_H + i * ROW_H;
            // Alternating row stripe
            if (i % 2 === 0) {
                rects.push({ x: 0, y, w: WIDTH, h: ROW_H - 1, r: 0.03, g: 0.15, b: 0.2, a: 0.16 });
            }
            // Hover highlight
            if (this.hoverRow === i) {
                rects.push({ x: 0, y, w: WIDTH, h: ROW_H - 1, r: 0.18, g: 0.3, b: 0.41, a: 0.2 });
            }
            // Current price band (±2 rows)
            if (anchorIndex >= 0 && Math.abs(i - anchorIndex) <= 2) {
                rects.push({ x: 0, y, w: WIDTH, h: ROW_H - 1, r: 0.14, g: 0.2, b: 0.27, a: i === anchorIndex ? 0.52 : 0.2 });
            }
            // Enforce book side constraints:
            //   bids only appear at or below current price  (above current price = already swept / not yet zeroed by depth stream)
            //   asks only appear at or above current price  (below current price = already swept / not yet zeroed by depth stream)
            // This eliminates the ~100ms "ghost" after fast trades, without waiting for depth-stream zeroing.
            const visibleBid = l.price <= snap.currentPrice ? l.bidSize : 0;
            const visibleAsk = l.price >= snap.currentPrice ? l.askSize : 0;
            // Bid / ask book bars
            const bidRatio = visibleBid / snap.maxBookSize;
            const askRatio = visibleAsk / snap.maxBookSize;
            rects.push({ x: COL_BID_BOOK + 170 * (1 - bidRatio), y: y + 1, w: 170 * bidRatio, h: ROW_H - 2, r: 0.24, g: 0.55, b: 0.78, a: 0.86 });
            rects.push({ x: COL_ASK_BOOK, y: y + 1, w: 170 * askRatio, h: ROW_H - 2, r: 0.78, g: 0.36, b: 0.33, a: 0.86 });
            // Footprint cumulative bars
            const sellRatio = l.sellTraded / snap.maxTradeSize;
            const buyRatio = l.buyTraded / snap.maxTradeSize;
            rects.push({ x: COL_BID_FOOT + 100 * (1 - sellRatio), y: y + 1, w: 100 * sellRatio, h: ROW_H - 2, r: 0.2, g: 0.43, b: 0.68, a: 0.78 });
            rects.push({ x: COL_ASK_FOOT, y: y + 1, w: 100 * buyRatio, h: ROW_H - 2, r: 0.69, g: 0.3, b: 0.31, a: 0.78 });
            // Taker flash animations
            if (l.bidFlashUntil > now)
                rects.push({ x: COL_BID_BOOK, y: y + 1, w: 170, h: ROW_H - 2, r: 0.42, g: 0.82, b: 1, a: 0.28 });
            if (l.askFlashUntil > now)
                rects.push({ x: COL_ASK_BOOK, y: y + 1, w: 170, h: ROW_H - 2, r: 1, g: 0.46, b: 0.46, a: 0.28 });
            if (l.sellFlashUntil > now)
                rects.push({ x: COL_BID_FOOT, y: y + 1, w: 100, h: ROW_H - 2, r: 0.4, g: 0.72, b: 1, a: 0.22 });
            if (l.buyFlashUntil > now)
                rects.push({ x: COL_ASK_FOOT, y: y + 1, w: 100, h: ROW_H - 2, r: 1, g: 0.56, b: 0.56, a: 0.22 });
            // My order indicators
            if (this.myOrders.getTopOrderAt(l.price, 'bid'))
                rects.push({ x: COL_BID_BOOK - 5, y: y + 1, w: 5, h: ROW_H - 2, r: 1, g: 0.92, b: 0.3, a: 1 });
            if (this.myOrders.getTopOrderAt(l.price, 'ask'))
                rects.push({ x: COL_ASK_BOOK + 172, y: y + 1, w: 5, h: ROW_H - 2, r: 1, g: 0.92, b: 0.3, a: 1 });
        });
        this.drawRects(rects);
        this.drawTexts(snap, windowLevels, anchorIndex);
    }
    pickWindow(snap) {
        const total = snap.levels.length;
        const currentIdx = snap.levels.findIndex(l => l.price === snap.currentPrice);
        const baseCenter = currentIdx < 0 ? Math.floor(total / 2) : currentIdx;
        const center = Math.max(0, Math.min(total - 1, baseCenter + Math.round(this.displayScrollOffset)));
        const half = Math.floor(VISIBLE_ROWS / 2);
        const start = Math.max(0, Math.min(total - VISIBLE_ROWS, center - half));
        const end = Math.min(total, start + VISIBLE_ROWS);
        const anchorIndex = currentIdx < start || currentIdx >= end ? -1 : currentIdx - start;
        return { windowLevels: snap.levels.slice(start, end), anchorIndex };
    }
    drawTexts(snap, levels, anchorIndex) {
        const { ctx } = this;
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        // Header background
        ctx.fillStyle = '#202a34';
        ctx.fillRect(0, 0, WIDTH, HEADER_H - 2);
        // Column headers — show current size unit alongside the book label
        const unitLabel = this.sizeUnit === 'base' ? '(基础)' : this.sizeUnit === 'quote' ? '(USDT)' : '(张)';
        ctx.fillStyle = '#d5e3ee';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`BID ${unitLabel}`, COL_BID_BOOK + 30, 24);
        ctx.fillText('SELL CUM', COL_BID_FOOT + 20, 24);
        ctx.fillText('PRICE', COL_PRICE + 33, 24);
        ctx.fillText('BUY CUM', COL_ASK_FOOT + 22, 24);
        ctx.fillText(`ASK ${unitLabel}`, COL_ASK_BOOK + 30, 24);
        ctx.fillStyle = '#89a2b7';
        ctx.font = '11px sans-serif';
        ctx.fillText(`滚轮滚动 / Shift加速 / Home归中 / 偏移:${Math.round(this.displayScrollOffset)} / ${this.autoFocusLocked ? '锁定跟随' : '解锁滑动'}`, 320, 40);
        ctx.font = '15px monospace';
        levels.forEach((l, i) => {
            const y = HEADER_H + i * ROW_H + 15;
            const myBid = this.myOrders.getTopOrderAt(l.price, 'bid');
            const myAsk = this.myOrders.getTopOrderAt(l.price, 'ask');
            const isAnchor = i === anchorIndex;
            // Same side constraint as in rect rendering
            const visibleBid = l.price <= snap.currentPrice ? l.bidSize : 0;
            const visibleAsk = l.price >= snap.currentPrice ? l.askSize : 0;
            ctx.fillStyle = '#d8ecfc';
            ctx.fillText(this.formatSize(visibleBid, snap.currentPrice), COL_BID_BOOK + 7, y);
            ctx.fillStyle = '#c5dbf3';
            ctx.fillText(this.formatSize(l.sellTraded, snap.currentPrice), COL_BID_FOOT + 8, y);
            ctx.fillStyle = isAnchor ? '#ffffff' : '#e8ecef';
            ctx.font = isAnchor ? 'bold 16px monospace' : '15px monospace';
            ctx.fillText(this.orderBook.formatPrice(l.price), COL_PRICE + 10, y);
            ctx.fillStyle = '#f7d4d4';
            ctx.fillText(this.formatSize(l.buyTraded, snap.currentPrice), COL_ASK_FOOT + 8, y);
            ctx.fillStyle = '#ffe2e2';
            ctx.fillText(this.formatSize(visibleAsk, snap.currentPrice), COL_ASK_BOOK + 7, y);
            ctx.font = '11px sans-serif';
            if (myBid) {
                ctx.fillStyle = '#ffeb7a';
                ctx.fillText(`#${Math.floor(myBid.aheadVolume) + 1}`, COL_BID_BOOK + 120, y - 2);
            }
            if (myAsk) {
                ctx.fillStyle = '#ffeb7a';
                ctx.fillText(`#${Math.floor(myAsk.aheadVolume) + 1}`, COL_ASK_BOOK + 120, y - 2);
            }
            if (myBid || myAsk) {
                ctx.strokeStyle = '#83fff2';
                ctx.lineWidth = 1;
                ctx.strokeRect(1, HEADER_H + i * ROW_H + 1, WIDTH - 2, ROW_H - 2);
            }
            if (isAnchor) {
                ctx.strokeStyle = '#f8fd70';
                ctx.lineWidth = 2;
                ctx.strokeRect(COL_PRICE - 6, HEADER_H + i * ROW_H + 1, 116, ROW_H - 2);
            }
            ctx.font = '15px monospace';
        });
        ctx.fillStyle = '#93a9bb';
        ctx.font = '11px sans-serif';
        ctx.fillText(`current: ${this.orderBook.formatPrice(snap.currentPrice)}  bestBid: ${this.orderBook.formatPrice(snap.bestBid)}  bestAsk: ${this.orderBook.formatPrice(snap.bestAsk)}`, 10, HEIGHT - 12);
    }
    /**
     * Formats a size value for display.
     *
     * The OrderBook stores raw base-currency quantities directly
     * (e.g. BTC for BTCUSDT, SEI for SEIUSDT) — no stepSize conversion at rest.
     *
     *   base / lots → display raw quantity with adaptive precision
     *   quote       → raw quantity × currentPrice  (= USDT notional value)
     */
    formatSize(rawQty, currentPrice) {
        if (!Number.isFinite(rawQty) || rawQty <= 0)
            return '0';
        if (this.sizeUnit === 'quote') {
            const usdt = rawQty * currentPrice;
            if (usdt >= 1000000000)
                return (usdt / 1000000).toFixed(0) + 'M';
            if (usdt >= 1000000)
                return (usdt / 1000000).toFixed(2) + 'M';
            if (usdt >= 100000)
                return (usdt / 1000).toFixed(0) + 'K';
            if (usdt >= 10000)
                return Math.round(usdt).toString();
            if (usdt >= 1000)
                return usdt.toFixed(0);
            return usdt.toFixed(1);
        }
        // base and lots: adaptive precision for any instrument
        const v = rawQty;
        if (v >= 1000000)
            return (v / 1000000).toFixed(2) + 'M';
        if (v >= 100000)
            return (v / 1000).toFixed(0) + 'K';
        if (v >= 10000)
            return Math.round(v).toString();
        if (v >= 1000)
            return v.toFixed(0);
        if (v >= 100)
            return v.toFixed(1);
        if (v >= 10)
            return v.toFixed(2);
        if (v >= 1)
            return v.toFixed(3);
        if (v >= 0.1)
            return v.toFixed(4);
        if (v >= 0.001)
            return v.toFixed(5);
        return v.toFixed(6);
    }
    drawRects(rects) {
        if (this.isContextLost || this.gl.isContextLost())
            return;
        const data = [];
        const cx = (x) => (x / WIDTH) * 2 - 1;
        const cy = (y) => 1 - (y / HEIGHT) * 2;
        for (const { x, y, w, h, r, g, b, a } of rects) {
            const x1 = cx(x), y1 = cy(y), x2 = cx(x + w), y2 = cy(y + h);
            // Two triangles per rect (6 vertices × 6 floats)
            data.push(x1, y1, r, g, b, a, x2, y1, r, g, b, a, x1, y2, r, g, b, a, x1, y2, r, g, b, a, x2, y1, r, g, b, a, x2, y2, r, g, b, a);
        }
        const gl = this.gl;
        gl.viewport(0, 0, WIDTH, HEIGHT);
        gl.clearColor(0.02, 0.11, 0.16, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
        const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(this.posLoc);
        gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.colorLoc);
        gl.vertexAttribPointer(this.colorLoc, 4, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
        gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    }
    initGL() {
        const vert = `
      attribute vec2 a_pos;
      attribute vec4 a_col;
      varying vec4 v_col;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); v_col = a_col; }
    `;
        const frag = `
      precision mediump float;
      varying vec4 v_col;
      void main() { gl_FragColor = v_col; }
    `;
        const vs = this.compileShader(this.gl.VERTEX_SHADER, vert);
        const fs = this.compileShader(this.gl.FRAGMENT_SHADER, frag);
        this.program = this.linkProgram(vs, fs);
        this.posLoc = this.gl.getAttribLocation(this.program, 'a_pos');
        this.colorLoc = this.gl.getAttribLocation(this.program, 'a_col');
        this.buffer = this.gl.createBuffer();
    }
    compileShader(type, src) {
        const s = this.gl.createShader(type);
        this.gl.shaderSource(s, src);
        this.gl.compileShader(s);
        return s;
    }
    linkProgram(vs, fs) {
        const p = this.gl.createProgram();
        this.gl.attachShader(p, vs);
        this.gl.attachShader(p, fs);
        this.gl.linkProgram(p);
        return p;
    }
    adjustScroll(step) {
        this.targetScrollOffset = Math.max(-300, Math.min(300, this.targetScrollOffset + step));
    }
    resetScroll() {
        this.targetScrollOffset = 0;
        this.wheelAccumulator = 0;
    }
}
