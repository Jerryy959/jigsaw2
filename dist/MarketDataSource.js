export function resolveDefaultSymbol(exchange, market) {
    if (exchange === 'bybit' && market === 'futures') {
        return 'BTCUSDT';
    }
    return 'btcusdt';
}
function normalizeSymbol(exchange, symbol) {
    return exchange === 'binance' ? symbol.toLowerCase() : symbol.toUpperCase();
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
        if (this.sockets.length > 0) {
            return;
        }
        this.connect();
    }
    connect() {
        if (this.isStopped)
            return;
        this.sockets = this.createSockets();
    }
    stop() {
        this.isStopped = true;
        this.sockets.forEach((socket) => {
            socket.onclose = null; // Prevent reconnect on manual stop
            socket.close();
        });
        this.sockets = [];
        this.reconnectTimers.forEach(clearTimeout);
        this.reconnectTimers = [];
        this.depthState.bid.clear();
        this.depthState.ask.clear();
        this.hasFocusedFromDepth = false;
    }
    openSocket(url, onData, onOpen, reconnectDelay = 1000) {
        const socket = new WebSocket(url);
        let pingInterval = null;
        socket.onopen = () => {
            console.info(`[${this.getName()}] websocket opened: ${url}`);
            onOpen?.(socket);
            // Heartbeat: Binance server sends pings, but we can also send pings to keep connection alive
            pingInterval = window.setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ method: 'PING' }));
                }
            }, 30000);
        };
        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Handle Binance/Bybit ping-pong if they send it as a message
                if (data.result === null && data.id)
                    return;
                onData(data);
            }
            catch (error) {
                console.warn(`[${this.getName()}] payload parse failed`, error);
            }
        };
        socket.onerror = (error) => {
            console.error(`[${this.getName()}] websocket error: ${url}`, error);
        };
        socket.onclose = () => {
            if (pingInterval)
                clearInterval(pingInterval);
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
        }
        this.applyDepthSide('bid', message.bids);
        this.applyDepthSide('ask', message.asks);
        this.focusCurrentPriceFromDepthOnce();
    }
    focusCurrentPriceFromDepthOnce() {
        if (this.hasFocusedFromDepth || !this.depthState.bid.size || !this.depthState.ask.size) {
            return;
        }
        const bestBid = Math.max(...this.depthState.bid.keys());
        const bestAsk = Math.min(...this.depthState.ask.keys());
        this.deps.orderBook.setCurrentPrice((bestBid + bestAsk) / 2);
        this.hasFocusedFromDepth = true;
    }
    applyTrade(payload) {
        const rawPrice = Number(payload.price);
        const rawSize = Number(payload.size);
        if (!Number.isFinite(rawPrice) || !Number.isFinite(rawSize)) {
            return;
        }
        this.deps.onEvent({
            type: 'trade',
            side: payload.aggressiveSide,
            price: this.deps.orderBook.normalize(rawPrice),
            size: this.normalizeToStep(rawSize),
            timestamp: Date.now(),
            impactsLiquidity: false,
        });
    }
    applyDepthSide(side, updates) {
        const sideState = this.depthState[side];
        for (const [priceText, sizeText] of updates) {
            const rawPrice = Number(priceText);
            const nextSize = Number(sizeText);
            if (!Number.isFinite(rawPrice) || !Number.isFinite(nextSize)) {
                continue;
            }
            const price = this.deps.orderBook.normalize(rawPrice);
            const previous = sideState.get(price) ?? 0;
            if (nextSize === previous) {
                continue;
            }
            const normalizedNext = this.normalizeToStep(nextSize);
            const normalizedPrev = this.normalizeToStep(previous);
            const delta = normalizedNext - normalizedPrev;
            if (delta > 0) {
                this.deps.onEvent({ type: 'add', side, price, size: delta, timestamp: Date.now() });
            }
            else if (delta < 0) {
                this.deps.onEvent({ type: 'cancel', side, price, size: Math.abs(delta), timestamp: Date.now() });
            }
            if (nextSize <= 0) {
                sideState.delete(price);
            }
            else {
                sideState.set(price, nextSize);
            }
        }
    }
    normalizeToStep(size) {
        // Use stepSize for quantity normalization
        return Math.max(0, Number((size / this.deps.stepSize).toFixed(4)));
    }
}
export class BinanceMarketDataSource extends BaseRealtimeSource {
    constructor(orderBook, onEvent, config) {
        super({
            orderBook,
            onEvent,
            symbol: config.symbol.toLowerCase(),
            tickSize: config.tickSize,
            stepSize: config.stepSize
        });
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
            const message = payload;
            if (message.e !== 'depthUpdate')
                return;
            if (this.isSyncing) {
                this.buffer.push(message);
                if (this.lastUpdateId === -1) {
                    this.fetchSnapshot();
                }
                else {
                    this.processBuffer();
                }
            }
            else {
                this.handleIncrementalUpdate(message);
            }
        });
        const tradeSocket = this.openSocket(`${this.wsBaseUrl}/${this.deps.symbol}@trade`, (payload) => {
            const message = payload;
            if (message.e !== 'trade')
                return;
            this.applyTrade({
                price: message.p ?? '',
                size: message.q ?? '',
                aggressiveSide: message.m ? 'ask' : 'bid',
            });
        });
        return [depthSocket, tradeSocket];
    }
    async fetchSnapshot() {
        try {
            const url = `${this.restBaseUrl}${this.config.market === 'futures' ? '/fapi/v1/depth' : '/api/v3/depth'}?symbol=${this.deps.symbol.toUpperCase()}&limit=1000`;
            const response = await fetch(url);
            const data = await response.json();
            this.lastUpdateId = data.lastUpdateId || data.u;
            console.info(`[${this.getName()}] Snapshot fetched, lastUpdateId: ${this.lastUpdateId}`);
            this.applyOrderBookUpdates({
                bids: data.bids || [],
                asks: data.asks || [],
                resetState: true
            });
            this.processBuffer();
        }
        catch (error) {
            console.error(`[${this.getName()}] Failed to fetch snapshot`, error);
            // Retry snapshot after delay
            setTimeout(() => this.fetchSnapshot(), 5000);
        }
    }
    processBuffer() {
        if (this.lastUpdateId === -1)
            return;
        for (const msg of this.buffer) {
            // For Spot: The first processed event should have U <= lastUpdateId+1 AND u >= lastUpdateId+1
            // For Futures: The first processed event should have U <= lastUpdateId AND u >= lastUpdateId
            const isFirstMessage = this.config.market === 'futures'
                ? (msg.U <= this.lastUpdateId && msg.u >= this.lastUpdateId)
                : (msg.U <= this.lastUpdateId + 1 && msg.u >= this.lastUpdateId + 1);
            if (this.isSyncing) {
                if (isFirstMessage) {
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
        // Sequence validation
        if (this.config.market === 'futures') {
            // For futures, pu should match previous u
            // But for simplicity and robustness, we just check if it's newer
            if (msg.u <= this.lastUpdateId)
                return;
        }
        else {
            // For spot, U should be lastUpdateId + 1
            if (msg.u <= this.lastUpdateId)
                return;
        }
        this.applyOrderBookUpdates({
            bids: msg.b ?? [],
            asks: msg.a ?? [],
            resetState: false
        });
        this.lastUpdateId = msg.u;
    }
}
export class BybitMarketDataSource extends BaseRealtimeSource {
    constructor(orderBook, onEvent, config) {
        super({
            orderBook,
            onEvent,
            symbol: config.symbol.toUpperCase(),
            tickSize: config.tickSize,
            stepSize: config.stepSize
        });
        this.config = config;
        const marketChannel = config.market === 'futures' ? 'linear' : 'spot';
        this.wsBaseUrl = config.wsBaseUrl ?? `wss://stream.bybit.com/v5/public/${marketChannel}`;
    }
    getName() {
        return `bybit:${this.config.market}:${this.deps.symbol}`;
    }
    createSockets() {
        const depthTopic = `orderbook.50.${this.deps.symbol}`;
        const tradeTopic = `publicTrade.${this.deps.symbol}`;
        const depthSocket = this.openSocket(this.wsBaseUrl, (payload) => {
            const message = payload;
            if (message.topic !== depthTopic || !message.data) {
                return;
            }
            this.applyOrderBookUpdates({
                bids: message.data.b ?? [],
                asks: message.data.a ?? [],
                resetState: message.type === 'snapshot',
            });
        }, (socket) => {
            socket.send(JSON.stringify({ op: 'subscribe', args: [depthTopic] }));
        });
        const tradeSocket = this.openSocket(this.wsBaseUrl, (payload) => {
            const message = payload;
            if (message.topic !== tradeTopic || !message.data) {
                return;
            }
            for (const trade of message.data) {
                this.applyTrade({
                    price: trade.p ?? '',
                    size: trade.v ?? '',
                    aggressiveSide: trade.S === 'Sell' ? 'ask' : 'bid',
                });
            }
        }, (socket) => {
            socket.send(JSON.stringify({ op: 'subscribe', args: [tradeTopic] }));
        });
        return [depthSocket, tradeSocket];
    }
}
export function createRealtimeSource(orderBook, onEvent, config) {
    const normalizedSymbol = normalizeSymbol(config.exchange, config.symbol);
    // Default stepSize if not provided
    const stepSize = config.stepSize ?? (config.market === 'futures' ? 0.001 : 0.00001);
    if (config.exchange === 'bybit') {
        return new BybitMarketDataSource(orderBook, onEvent, {
            symbol: normalizedSymbol,
            tickSize: config.tickSize,
            stepSize: stepSize,
            market: config.market,
        });
    }
    return new BinanceMarketDataSource(orderBook, onEvent, {
        symbol: normalizedSymbol,
        tickSize: config.tickSize,
        stepSize: stepSize,
        market: config.market,
    });
}
