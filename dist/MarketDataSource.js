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
    }
    start() {
        if (this.sockets.length > 0) {
            return;
        }
        this.sockets = this.createSockets();
    }
    stop() {
        this.sockets.forEach((socket) => socket.close());
        this.sockets = [];
        this.depthState.bid.clear();
        this.depthState.ask.clear();
    }
    openSocket(url, onData, onOpen) {
        const socket = new WebSocket(url);
        socket.onopen = () => {
            onOpen?.(socket);
        };
        socket.onmessage = (event) => {
            try {
                onData(JSON.parse(event.data));
            }
            catch (error) {
                console.warn(`[${this.getName()}] payload parse failed`, error);
            }
        };
        socket.onerror = (error) => {
            console.error(`[${this.getName()}] websocket error`, error);
        };
        socket.onclose = () => {
            console.warn(`[${this.getName()}] websocket closed:`, url);
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
            size: this.normalizeToTick(rawSize),
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
            const normalizedNext = this.normalizeToTick(nextSize);
            const normalizedPrev = this.normalizeToTick(previous);
            const delta = normalizedNext - normalizedPrev;
            if (delta > 0) {
                this.deps.onEvent({ type: 'add', side, price, size: delta, timestamp: Date.now() });
            }
            else {
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
    normalizeToTick(size) {
        return Math.max(0, Number((size / this.deps.tickSize).toFixed(4)));
    }
}
export class BinanceMarketDataSource extends BaseRealtimeSource {
    constructor(orderBook, onEvent, config) {
        super({ orderBook, onEvent, symbol: config.symbol.toLowerCase(), tickSize: config.tickSize });
        this.config = config;
        this.wsBaseUrl = config.wsBaseUrl ?? (config.market === 'futures' ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws');
    }
    getName() {
        return `binance:${this.config.market}:${this.deps.symbol.toUpperCase()}`;
    }
    createSockets() {
        const depthSocket = this.openSocket(`${this.wsBaseUrl}/${this.deps.symbol}@depth@100ms`, (payload) => {
            const message = payload;
            this.applyOrderBookUpdates({ bids: message.b ?? [], asks: message.a ?? [], resetState: false });
        });
        const tradeSocket = this.openSocket(`${this.wsBaseUrl}/${this.deps.symbol}@trade`, (payload) => {
            const message = payload;
            this.applyTrade({
                price: message.p ?? '',
                size: message.q ?? '',
                // Binance `m=true` means buyer is maker, so aggressive side is sell.
                aggressiveSide: message.m ? 'ask' : 'bid',
            });
        });
        return [depthSocket, tradeSocket];
    }
}
export class BybitMarketDataSource extends BaseRealtimeSource {
    constructor(orderBook, onEvent, config) {
        super({ orderBook, onEvent, symbol: config.symbol.toUpperCase(), tickSize: config.tickSize });
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
    if (config.exchange === 'bybit') {
        return new BybitMarketDataSource(orderBook, onEvent, {
            symbol: normalizedSymbol,
            tickSize: config.tickSize,
            market: config.market,
        });
    }
    return new BinanceMarketDataSource(orderBook, onEvent, {
        symbol: normalizedSymbol,
        tickSize: config.tickSize,
        market: config.market,
    });
}
