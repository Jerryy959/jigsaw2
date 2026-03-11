export class BinanceMarketDataSource {
    constructor(orderBook, onEvent, config) {
        this.orderBook = orderBook;
        this.onEvent = onEvent;
        this.config = config;
        this.depthState = { bid: new Map(), ask: new Map() };
        this.depthSocket = null;
        this.tradeSocket = null;
    }
    getName() {
        return `binance:${this.config.symbol.toUpperCase()}`;
    }
    start() {
        if (this.depthSocket || this.tradeSocket) {
            return;
        }
        const wsBase = this.config.wsBaseUrl ?? 'wss://stream.binance.com:9443/ws';
        const symbol = this.config.symbol.toLowerCase();
        this.depthSocket = this.openSocket(`${wsBase}/${symbol}@depth@100ms`, (payload) => {
            this.handleDepth(payload);
        });
        this.tradeSocket = this.openSocket(`${wsBase}/${symbol}@trade`, (payload) => {
            this.handleTrade(payload);
        });
    }
    stop() {
        this.depthSocket?.close();
        this.tradeSocket?.close();
        this.depthSocket = null;
        this.tradeSocket = null;
        this.depthState.bid.clear();
        this.depthState.ask.clear();
    }
    openSocket(url, onData) {
        const socket = new WebSocket(url);
        socket.onmessage = (event) => {
            try {
                onData(JSON.parse(event.data));
            }
            catch (error) {
                console.warn('[BinanceMarketDataSource] payload parse failed', error);
            }
        };
        socket.onerror = (error) => {
            console.error('[BinanceMarketDataSource] websocket error', error);
        };
        socket.onclose = () => {
            console.warn('[BinanceMarketDataSource] websocket closed:', url);
        };
        return socket;
    }
    handleDepth(message) {
        this.applyDepthSide('bid', message.b ?? []);
        this.applyDepthSide('ask', message.a ?? []);
    }
    applyDepthSide(side, updates) {
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
            }
            else {
                this.onEvent({ type: 'cancel', side, price, size: Math.abs(delta), timestamp: Date.now() });
            }
            if (nextSize <= 0) {
                sideState.delete(price);
            }
            else {
                sideState.set(price, nextSize);
            }
        }
    }
    handleTrade(message) {
        const rawPrice = Number(message.p);
        const rawSize = Number(message.q);
        if (!Number.isFinite(rawPrice) || !Number.isFinite(rawSize)) {
            return;
        }
        // Binance `m=true` means buyer is maker, so aggressive side is sell.
        const side = message.m ? 'ask' : 'bid';
        this.onEvent({
            type: 'trade',
            side,
            price: this.orderBook.normalize(rawPrice),
            size: this.normalizeToTick(rawSize),
            timestamp: Date.now(),
        });
    }
    normalizeToTick(size) {
        return Math.max(0, Number((size / this.config.tickSize).toFixed(4)));
    }
}
