export class DOMRenderer {
    constructor(orderBook, myOrders, mountEl, onClick) {
        this.orderBook = orderBook;
        this.myOrders = myOrders;
        this.mountEl = mountEl;
        this.onClick = onClick;
        this.width = 860;
        this.height = 1120;
        this.rowH = 22;
        this.top = 48;
        this.posLoc = -1;
        this.colorLoc = -1;
        // jigsaw-like fixed columns
        this.cBidBook = 0;
        this.cBidPrint = 155;
        this.cPrice = 250;
        this.cAskPrint = 355;
        this.cAskBook = 450;
        this.handleClick = (ev) => {
            const rect = this.uiCanvas.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const y = ev.clientY - rect.top;
            const idx = Math.floor((y - this.top) / this.rowH);
            const levels = this.orderBook.getSnapshot().levels;
            if (idx < 0 || idx >= levels.length) {
                return;
            }
            const price = levels[idx].price;
            const side = x < this.cPrice ? 'bid' : 'ask';
            this.onClick(price, side);
        };
    }
    init() {
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
            throw new Error('no canvas context');
        }
        this.gl = gl;
        this.ctx = ctx;
        this.initGL();
        this.uiCanvas.addEventListener('click', this.handleClick);
    }
    render() {
        const snap = this.orderBook.getSnapshot();
        const rects = [];
        snap.levels.forEach((l, i) => {
            const y = this.top + i * this.rowH;
            const bidRatio = l.bidSize / snap.maxBookSize;
            const askRatio = l.askSize / snap.maxBookSize;
            const buyRatio = l.buyTraded / snap.maxTradeSize;
            const sellRatio = l.sellTraded / snap.maxTradeSize;
            // zebra rows
            if (i % 2 === 0) {
                rects.push({ x: 0, y, w: this.width, h: this.rowH - 1, r: 0.02, g: 0.16, b: 0.2, a: 0.18 });
            }
            // book bars left/right
            rects.push({ x: this.cBidBook + (140 * (1 - bidRatio)), y: y + 1, w: 140 * bidRatio, h: this.rowH - 3, r: 0.22, g: 0.62, b: 0.95, a: 0.75 });
            rects.push({ x: this.cAskBook, y: y + 1, w: 140 * askRatio, h: this.rowH - 3, r: 0.9, g: 0.35, b: 0.35, a: 0.75 });
            // footprint columns around price
            rects.push({ x: this.cBidPrint + (90 * (1 - sellRatio)), y: y + 1, w: 90 * sellRatio, h: this.rowH - 3, r: 0.15, g: 0.42, b: 0.78, a: 0.7 });
            rects.push({ x: this.cAskPrint, y: y + 1, w: 90 * buyRatio, h: this.rowH - 3, r: 0.8, g: 0.25, b: 0.25, a: 0.7 });
            // current spread highlight
            if (l.price === snap.bestBid || l.price === snap.bestAsk) {
                rects.push({ x: 0, y, w: this.width, h: this.rowH - 1, r: 0.93, g: 0.9, b: 0.2, a: 0.15 });
            }
            const myBid = this.myOrders.getTopOrderAt(l.price, 'bid');
            const myAsk = this.myOrders.getTopOrderAt(l.price, 'ask');
            if (myBid) {
                rects.push({ x: this.cBidBook - 4, y: y + 1, w: 4, h: this.rowH - 3, r: 1, g: 0.92, b: 0.35, a: 1 });
            }
            if (myAsk) {
                rects.push({ x: this.cAskBook + 142, y: y + 1, w: 4, h: this.rowH - 3, r: 1, g: 0.92, b: 0.35, a: 1 });
            }
        });
        this.drawRects(rects);
        this.drawTexts(snap);
    }
    drawTexts(snap) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = '#1a2b38';
        ctx.fillRect(0, 0, this.width, this.top - 4);
        ctx.fillStyle = '#c9d8e4';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('BID', this.cBidBook + 54, 26);
        ctx.fillText('SELL x BUY', this.cBidPrint + 10, 26);
        ctx.fillText('PRICE', this.cPrice + 22, 26);
        ctx.fillText('ASK', this.cAskBook + 54, 26);
        ctx.font = '18px sans-serif';
        snap.levels.forEach((l, i) => {
            const y = this.top + i * this.rowH + 17;
            const delta = l.buyTraded - l.sellTraded;
            const myBid = this.myOrders.getTopOrderAt(l.price, 'bid');
            const myAsk = this.myOrders.getTopOrderAt(l.price, 'ask');
            ctx.fillStyle = '#d5ecf8';
            ctx.fillText(Math.round(l.bidSize).toString(), this.cBidBook + 8, y);
            ctx.fillStyle = '#e6f0f8';
            ctx.fillText(Math.round(l.sellTraded).toString(), this.cBidPrint + 8, y);
            ctx.fillStyle = '#f5f5f5';
            ctx.fillText(l.price.toFixed(2), this.cPrice + 8, y);
            ctx.fillStyle = '#f2dfe0';
            ctx.fillText(Math.round(l.buyTraded).toString(), this.cAskPrint + 8, y);
            ctx.fillStyle = '#f7dcde';
            ctx.fillText(Math.round(l.askSize).toString(), this.cAskBook + 8, y);
            ctx.font = '12px sans-serif';
            if (myBid) {
                ctx.fillStyle = '#ffe66d';
                ctx.fillText(`B#${Math.floor(myBid.aheadVolume) + 1}`, this.cBidBook + 92, y - 2);
            }
            if (myAsk) {
                ctx.fillStyle = '#ffe66d';
                ctx.fillText(`A#${Math.floor(myAsk.aheadVolume) + 1}`, this.cAskBook + 92, y - 2);
            }
            if (Math.abs(delta) > snap.maxTradeSize * 0.55) {
                ctx.strokeStyle = '#ffd84f';
                ctx.strokeRect(this.cPrice - 3, this.top + i * this.rowH + 1, 102, this.rowH - 3);
            }
            ctx.font = '18px sans-serif';
        });
    }
    drawRects(rects) {
        const gl = this.gl;
        const data = [];
        const clipX = (x) => (x / this.width) * 2 - 1;
        const clipY = (y) => 1 - (y / this.height) * 2;
        for (const r of rects) {
            const x1 = clipX(r.x);
            const y1 = clipY(r.y);
            const x2 = clipX(r.x + r.w);
            const y2 = clipY(r.y + r.h);
            data.push(x1, y1, r.r, r.g, r.b, r.a, x2, y1, r.r, r.g, r.b, r.a, x1, y2, r.r, r.g, r.b, r.a, x1, y2, r.r, r.g, r.b, r.a, x2, y1, r.r, r.g, r.b, r.a, x2, y2, r.r, r.g, r.b, r.a);
        }
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0.02, 0.14, 0.18, 1);
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
        this.buffer = this.gl.createBuffer();
    }
    compile(type, source) {
        const s = this.gl.createShader(type);
        this.gl.shaderSource(s, source);
        this.gl.compileShader(s);
        return s;
    }
    link(vs, fs) {
        const p = this.gl.createProgram();
        this.gl.attachShader(p, vs);
        this.gl.attachShader(p, fs);
        this.gl.linkProgram(p);
        return p;
    }
}
