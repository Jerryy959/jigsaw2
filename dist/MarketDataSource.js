export function resolveDefaultSymbol(exchange, market) {
    return exchange === 'bybit' && market === 'futures' ? 'BTCUSDT' : 'btcusdt';
}
function normalizeSymbol(exchange, symbol) {
    return exchange === 'binance' ? symbol.toLowerCase() : symbol.toUpperCase();
}
/**
 * Infers the tick size for an instrument from raw price strings in a depth snapshot.
 *
 * Strategy: minimum positive diff between consecutive sorted prices,
 * snapped to nearest clean value (1, 2, 2.5, 5, 10 × 10^n).
 */
function inferTickSize(priceStrings) {
    const prices = priceStrings
        .slice(0, 40)
        .map(Number)
        .filter(p => Number.isFinite(p) && p > 0)
        .sort((a, b) => a - b);
    if (prices.length < 2)
        return 0.01;
    let minDiff = Infinity;
    for (let i = 1; i < prices.length; i++) {
        const diff = Number((prices[i] - prices[i - 1]).toPrecision(10));
        if (diff > 0)
            minDiff = Math.min(minDiff, diff);
    }
    if (!Number.isFinite(minDiff) || minDiff <= 0)
        return 0.01;
    const exp = Math.floor(Math.log10(minDiff));
    const mantissa = minDiff / Math.pow(10, exp);
    let snap;
    if (mantissa < 1.5)
        snap = 1;
    else if (mantissa < 3.5)
        snap = 2.5;
    else if (mantissa < 7.5)
        snap = 5;
    else
        snap = 10;
    return snap * Math.pow(10, exp);
}
class BaseRealtimeSource {
    constructor(deps) {
        this.deps = deps;
        this.depthState = { bid: new Map(), ask: new Map() };
        this.sockets = [];
        this.hasFocusedFromDepth = false;
        this.reconnectTimers = [];
        this.isStopped = false;
    }
    start() {
        this.isStopped = false;
        if (this.sockets.length === 0)
            this.connect();
    }
    stop() {
        this.isStopped = true;
        this.sockets.forEach(s => { s.onclose = null; s.close(); });
        this.sockets = [];
        this.reconnectTimers.forEach(clearTimeout);
        this.reconnectTimers = [];
        this.depthState.bid.clear();
        this.depthState.ask.clear();
        this.hasFocusedFromDepth = false;
    }
    connect() {
        if (!this.isStopped)
            this.sockets = this.createSockets();
    }
    openSocket(url, onData, onOpen, reconnectDelay = 1000) {
        const socket = new WebSocket(url);
        socket.onopen = () => {
            console.info(`[${this.getName()}] websocket opened: ${url}`);
            onOpen?.(socket);
        };
        socket.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data);
                if (data.result === null && data.id)
                    return;
                onData(data);
            }
            catch (err) {
                console.warn(`[${this.getName()}] payload parse failed`, err);
            }
        };
        socket.onerror = (err) => {
            console.error(`[${this.getName()}] websocket error: ${url}`, err);
        };
        socket.onclose = () => {
            console.warn(`[${this.getName()}] websocket closed: ${url}. Reconnecting in ${reconnectDelay}ms...`);
            if (!this.isStopped) {
                const timer = window.setTimeout(() => {
                    this.reconnectTimers = this.reconnectTimers.filter(t => t !== timer);
                    this.connect();
                }, reconnectDelay);
                this.reconnectTimers.push(timer);
            }
        };
        return socket;
    }
    applyOrderBookUpdates(message) {
        if (message.resetState) {
            this.depthState.bid.clear();
            this.depthState.ask.clear();
            if (this.deps.autoDetectTick && !this.hasFocusedFromDepth) {
                this.reinitializeFromSnapshot(message.bids, message.asks);
            }
        }
        this.applyDepthSide('bid', message.bids);
        this.applyDepthSide('ask', message.asks);
        this.focusCurrentPriceOnce();
    }
    /**
     * Detects tick size and mid price from raw snapshot price strings,
     * then reinitializes the OrderBook so all levels align to real market increments.
     * Quantities are stored as-is (raw base-currency units — e.g. BTC for BTCUSDT).
     */
    reinitializeFromSnapshot(bids, asks) {
        const allPrices = [...bids.map(b => b[0]), ...asks.map(a => a[0])];
        const tick = inferTickSize(allPrices);
        const topBid = bids.length ? Number(bids[0][0]) : 0;
        const topAsk = asks.length ? Number(asks[0][0]) : 0;
        const mid = topBid > 0 && topAsk > 0 ? (topBid + topAsk) / 2 : topBid || topAsk;
        if (mid > 0 && tick > 0) {
            console.info(`[${this.getName()}] auto-detected tick=${tick}, mid=${mid}`);
            this.deps.orderBook.reinitialize(mid, tick);
        }
    }
    focusCurrentPriceOnce() {
        if (this.hasFocusedFromDepth || !this.depthState.bid.size || !this.depthState.ask.size)
            return;
        const bestBid = Math.max(...this.depthState.bid.keys());
        const bestAsk = Math.min(...this.depthState.ask.keys());
        this.deps.orderBook.setCurrentPrice((bestBid + bestAsk) / 2);
        this.hasFocusedFromDepth = true;
    }
    applyTrade(payload) {
        const price = Number(payload.price);
        const size = Number(payload.size);
        if (!Number.isFinite(price) || !Number.isFinite(size))
            return;
        this.deps.onEvent({
            type: 'trade',
            side: payload.aggressiveSide,
            price: this.deps.orderBook.normalize(price),
            size,
            timestamp: Date.now(),
            impactsLiquidity: false,
        });
    }
    applyDepthSide(side, updates) {
        const state = this.depthState[side];
        for (const [priceStr, sizeStr] of updates) {
            const rawPrice = Number(priceStr);
            const nextSize = Number(sizeStr);
            if (!Number.isFinite(rawPrice) || !Number.isFinite(nextSize))
                continue;
            const price = this.deps.orderBook.normalize(rawPrice);
            const previous = state.get(price) ?? 0;
            if (nextSize === previous)
                continue;
            // Store and emit raw base-currency quantities directly (no step-size division).
            // This avoids all rounding / accumulation errors from imprecise step inference.
            const delta = nextSize - previous;
            if (delta > 0) {
                this.deps.onEvent({ type: 'add', side, price, size: delta, timestamp: Date.now() });
            }
            else {
                this.deps.onEvent({ type: 'cancel', side, price, size: Math.abs(delta), timestamp: Date.now() });
            }
            if (nextSize <= 0)
                state.delete(price);
            else
                state.set(price, nextSize);
        }
    }
}
export class BinanceMarketDataSource extends BaseRealtimeSource {
    constructor(orderBook, onEvent, config) {
        super({ orderBook, onEvent, symbol: config.symbol.toLowerCase(), tickSize: config.tickSize, autoDetectTick: config.autoDetectTick });
        this.config = config;
        this.lastUpdateId = -1;
        this.buffer = [];
        this.isSyncing = false;
        this.wsBaseUrl = config.wsBaseUrl ?? (config.market === 'futures' ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws');
        this.restBaseUrl = config.restBaseUrl ?? (config.market === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com');
    }
    getName() {
        return `binance:${this.config.market}:${this.deps.symbol.toUpperCase()}`;
    }
    createSockets() {
        this.lastUpdateId = -1;
        this.buffer = [];
        this.isSyncing = true;
        const depthSocket = this.openSocket(`${this.wsBaseUrl}/${this.deps.symbol}@depth@100ms`, (payload) => {
            const msg = payload;
            if (msg.e !== 'depthUpdate')
                return;
            if (this.isSyncing) {
                this.buffer.push(msg);
                if (this.lastUpdateId === -1)
                    this.fetchSnapshot();
                else
                    this.processBuffer();
            }
            else {
                this.handleIncrementalUpdate(msg);
            }
        });
        const tradeSocket = this.openSocket(`${this.wsBaseUrl}/${this.deps.symbol}@trade`, (payload) => {
            const msg = payload;
            if (msg.e !== 'trade')
                return;
            this.applyTrade({ price: msg.p ?? '', size: msg.q ?? '', aggressiveSide: msg.m ? 'ask' : 'bid' });
        });
        return [depthSocket, tradeSocket];
    }
    async fetchSnapshot() {
        try {
            const path = this.config.market === 'futures' ? '/fapi/v1/depth' : '/api/v3/depth';
            const url = `${this.restBaseUrl}${path}?symbol=${this.deps.symbol.toUpperCase()}&limit=1000`;
            const data = await (await fetch(url)).json();
            this.lastUpdateId = data.lastUpdateId ?? data.u;
            console.info(`[${this.getName()}] snapshot fetched, lastUpdateId: ${this.lastUpdateId}`);
            this.applyOrderBookUpdates({ bids: data.bids ?? [], asks: data.asks ?? [], resetState: true });
            this.processBuffer();
        }
        catch (err) {
            console.error(`[${this.getName()}] snapshot fetch failed`, err);
            setTimeout(() => this.fetchSnapshot(), 5000);
        }
    }
    processBuffer() {
        if (this.lastUpdateId === -1)
            return;
        for (const msg of this.buffer) {
            const syncStart = this.config.market === 'futures'
                ? msg.U <= this.lastUpdateId && msg.u >= this.lastUpdateId
                : msg.U <= this.lastUpdateId + 1 && msg.u >= this.lastUpdateId + 1;
            if (this.isSyncing) {
                if (syncStart) {
                    this.isSyncing = false;
                    this.handleIncrementalUpdate(msg);
                }
            }
            else {
                this.handleIncrementalUpdate(msg);
            }
        }
        this.buffer = [];
    }
    handleIncrementalUpdate(msg) {
        if (msg.u <= this.lastUpdateId)
            return;
        this.applyOrderBookUpdates({ bids: msg.b ?? [], asks: msg.a ?? [], resetState: false });
        this.lastUpdateId = msg.u;
    }
}
export class BybitMarketDataSource extends BaseRealtimeSource {
    constructor(orderBook, onEvent, config) {
        super({ orderBook, onEvent, symbol: config.symbol.toUpperCase(), tickSize: config.tickSize, autoDetectTick: config.autoDetectTick });
        this.config = config;
        const channel = config.market === 'futures' ? 'linear' : 'spot';
        this.wsBaseUrl = config.wsBaseUrl ?? `wss://stream.bybit.com/v5/public/${channel}`;
    }
    getName() {
        return `bybit:${this.config.market}:${this.deps.symbol}`;
    }
    createSockets() {
        const depthTopic = `orderbook.50.${this.deps.symbol}`;
        const tradeTopic = `publicTrade.${this.deps.symbol}`;
        const depthSocket = this.openSocket(this.wsBaseUrl, (payload) => {
            const msg = payload;
            if (msg.topic !== depthTopic || !msg.data)
                return;
            this.applyOrderBookUpdates({ bids: msg.data.b ?? [], asks: msg.data.a ?? [], resetState: msg.type === 'snapshot' });
        }, (socket) => socket.send(JSON.stringify({ op: 'subscribe', args: [depthTopic] })));
        const tradeSocket = this.openSocket(this.wsBaseUrl, (payload) => {
            const msg = payload;
            if (msg.topic !== tradeTopic || !msg.data)
                return;
            for (const trade of msg.data) {
                this.applyTrade({ price: trade.p ?? '', size: trade.v ?? '', aggressiveSide: trade.S === 'Sell' ? 'ask' : 'bid' });
            }
        }, (socket) => socket.send(JSON.stringify({ op: 'subscribe', args: [tradeTopic] })));
        return [depthSocket, tradeSocket];
    }
}
export function createRealtimeSource(orderBook, onEvent, config) {
    const symbol = normalizeSymbol(config.exchange, config.symbol);
    const autoDetectTick = config.autoDetectTick ?? false;
    const cfg = { symbol, tickSize: config.tickSize, market: config.market, autoDetectTick };
    return config.exchange === 'bybit'
        ? new BybitMarketDataSource(orderBook, onEvent, cfg)
        : new BinanceMarketDataSource(orderBook, onEvent, cfg);
}
