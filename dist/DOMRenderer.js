export class DOMRenderer {
    constructor(orderBook, myOrderManager, mountEl, onClickPlaceOrder) {
        this.orderBook = orderBook;
        this.myOrderManager = myOrderManager;
        this.mountEl = mountEl;
        this.onClickPlaceOrder = onClickPlaceOrder;
        this.width = 980;
        this.height = 900;
        this.rowHeight = 20;
        this.topOffset = 40;
        this.positionLoc = -1;
        this.colorLoc = -1;
        this.handleClick = (evt) => {
            const rect = this.textCanvas.getBoundingClientRect();
            const x = evt.clientX - rect.left;
            const y = evt.clientY - rect.top;
            const rowIndex = Math.floor((y - this.topOffset) / this.rowHeight);
            const levels = this.orderBook.getLevelsDescending();
            if (rowIndex < 0 || rowIndex >= levels.length) {
                return;
            }
            const side = x < this.width / 2 ? 'bid' : 'ask';
            this.onClickPlaceOrder(levels[rowIndex].price, side);
        };
    }
    init() {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.width = `${this.width}px`;
        wrapper.style.height = `${this.height}px`;
        this.glCanvas = document.createElement('canvas');
        this.glCanvas.width = this.width;
        this.glCanvas.height = this.height;
        this.glCanvas.style.position = 'absolute';
        this.textCanvas = document.createElement('canvas');
        this.textCanvas.width = this.width;
        this.textCanvas.height = this.height;
        this.textCanvas.style.position = 'absolute';
        wrapper.append(this.glCanvas, this.textCanvas);
        this.mountEl.appendChild(wrapper);
        const gl = this.glCanvas.getContext('webgl');
        const textCtx = this.textCanvas.getContext('2d');
        if (!gl || !textCtx) {
            throw new Error('WebGL/2D context not available');
        }
        this.gl = gl;
        this.textCtx = textCtx;
        this.initWebGL();
        this.textCanvas.addEventListener('click', this.handleClick);
    }
    initWebGL() {
        const vertex = `
      attribute vec2 a_position;
      attribute vec4 a_color;
      varying vec4 v_color;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_color = a_color;
      }
    `;
        const fragment = `
      precision mediump float;
      varying vec4 v_color;
      void main() {
        gl_FragColor = v_color;
      }
    `;
        const vs = this.compileShader(this.gl.VERTEX_SHADER, vertex);
        const fs = this.compileShader(this.gl.FRAGMENT_SHADER, fragment);
        this.program = this.createProgram(vs, fs);
        this.positionLoc = this.gl.getAttribLocation(this.program, 'a_position');
        this.colorLoc = this.gl.getAttribLocation(this.program, 'a_color');
        this.buffer = this.gl.createBuffer();
    }
    compileShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        return shader;
    }
    createProgram(vs, fs) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vs);
        this.gl.attachShader(program, fs);
        this.gl.linkProgram(program);
        return program;
    }
    render() {
        const levels = this.orderBook.getLevelsDescending();
        const midX = this.width / 2;
        const maxBid = Math.max(...levels.map((l) => l.bidSize), 1);
        const maxAsk = Math.max(...levels.map((l) => l.askSize), 1);
        const maxDelta = Math.max(...levels.map((l) => Math.abs(l.buyVolume - l.sellVolume)), 1);
        const rects = [];
        levels.forEach((level, index) => {
            const y = this.topOffset + index * this.rowHeight;
            const bidWidth = 280 * (level.bidSize / maxBid);
            const askWidth = 280 * (level.askSize / maxAsk);
            const delta = level.buyVolume - level.sellVolume;
            const heatRatio = Math.min(1, Math.abs(delta) / maxDelta);
            rects.push({ x: midX - 75, y, w: 150, h: this.rowHeight - 2, r: delta >= 0 ? 0 : 1, g: delta >= 0 ? 0.8 : 0.4, b: 0.2, a: 0.15 + 0.45 * heatRatio });
            rects.push({ x: midX - 80 - bidWidth, y, w: bidWidth, h: this.rowHeight - 2, r: 0.18, g: 0.48, b: 1.0, a: 0.78 });
            rects.push({ x: midX + 80, y, w: askWidth, h: this.rowHeight - 2, r: 1.0, g: 0.3, b: 0.4, a: 0.78 });
            if (this.myOrderManager.getOrdersAt(level.price, 'bid').length > 0) {
                rects.push({ x: midX - 250, y: y + 2, w: 8, h: this.rowHeight - 6, r: 1, g: 0.84, b: 0.31, a: 1 });
            }
            if (this.myOrderManager.getOrdersAt(level.price, 'ask').length > 0) {
                rects.push({ x: midX + 242, y: y + 2, w: 8, h: this.rowHeight - 6, r: 1, g: 0.84, b: 0.31, a: 1 });
            }
        });
        this.drawRects(rects);
        this.drawText(levels);
    }
    drawRects(rects) {
        const vertices = [];
        const toClipX = (x) => (x / this.width) * 2 - 1;
        const toClipY = (y) => 1 - (y / this.height) * 2;
        for (const r of rects) {
            const x1 = toClipX(r.x);
            const y1 = toClipY(r.y);
            const x2 = toClipX(r.x + r.w);
            const y2 = toClipY(r.y + r.h);
            const v = [
                x1, y1, r.r, r.g, r.b, r.a,
                x2, y1, r.r, r.g, r.b, r.a,
                x1, y2, r.r, r.g, r.b, r.a,
                x1, y2, r.r, r.g, r.b, r.a,
                x2, y1, r.r, r.g, r.b, r.a,
                x2, y2, r.r, r.g, r.b, r.a,
            ];
            vertices.push(...v);
        }
        this.gl.viewport(0, 0, this.width, this.height);
        this.gl.clearColor(0.06, 0.08, 0.12, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.useProgram(this.program);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.DYNAMIC_DRAW);
        const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
        this.gl.enableVertexAttribArray(this.positionLoc);
        this.gl.vertexAttribPointer(this.positionLoc, 2, this.gl.FLOAT, false, stride, 0);
        this.gl.enableVertexAttribArray(this.colorLoc);
        this.gl.vertexAttribPointer(this.colorLoc, 4, this.gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, vertices.length / 6);
    }
    drawText(levels) {
        const ctx = this.textCtx;
        const midX = this.width / 2;
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = '#6ab1ff';
        ctx.font = '12px sans-serif';
        ctx.fillText('Bid Size', midX - 190, 22);
        ctx.fillStyle = '#f3f6ff';
        ctx.fillText('Price', midX - 18, 22);
        ctx.fillStyle = '#ff8a98';
        ctx.fillText('Ask Size', midX + 110, 22);
        levels.forEach((level, index) => {
            const y = this.topOffset + index * this.rowHeight + 14;
            const delta = level.buyVolume - level.sellVolume;
            ctx.fillStyle = '#d8e6ff';
            ctx.fillText(`${Math.floor(level.bidSize)}`, midX - 108, y);
            ctx.fillStyle = '#f6f8ff';
            ctx.fillText(level.price.toFixed(2), midX - 30, y);
            ctx.fillStyle = '#ffe1e6';
            ctx.fillText(`${Math.floor(level.askSize)}`, midX + 90, y);
            ctx.fillStyle = '#e8f2ff';
            ctx.fillText(`Δ ${delta >= 0 ? '+' : ''}${delta}`, midX - 24, y);
            const myBid = this.myOrderManager.getOrdersAt(level.price, 'bid')[0];
            const myAsk = this.myOrderManager.getOrdersAt(level.price, 'ask')[0];
            ctx.fillStyle = '#ffe57f';
            if (myBid) {
                ctx.fillText(`MyBid #${myBid.ahead + 1}`, midX - 236, y);
            }
            if (myAsk) {
                ctx.fillText(`MyAsk #${myAsk.ahead + 1}`, midX + 128, y);
            }
        });
    }
}
