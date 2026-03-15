/**
 * 模拟后端撮合服务：当市场价格扫到我的挂单价格时，触发成交事件。
 * 不直接修改订单簿，通过 emit 回调推送撮合结果。
 */
export class MockMatchingEngine {
    constructor(orderBook, myOrders, emit) {
        this.orderBook = orderBook;
        this.myOrders = myOrders;
        this.emit = emit;
        this.lastTradePrice = this.orderBook.getSnapshot().currentPrice;
    }
    onMarketEvent(event) {
        if (event.type !== 'trade')
            return;
        const prev = this.lastTradePrice;
        const curr = this.orderBook.normalize(event.price);
        this.lastTradePrice = curr;
        for (const order of this.myOrders.getOrders()) {
            if (order.remaining <= 0)
                continue;
            const swept = order.side === 'bid'
                ? prev >= order.price && curr <= order.price
                : prev <= order.price && curr >= order.price;
            if (!swept && curr !== order.price)
                continue;
            const aggressor = order.side === 'bid' ? 'ask' : 'bid';
            const queueTotal = Math.max(1, order.aheadVolume + order.remaining);
            const chunk = Math.max(1, Math.floor(queueTotal * (0.25 + Math.random() * 0.45)));
            this.emit({ type: 'trade', side: aggressor, price: order.price, size: chunk, timestamp: Date.now() });
        }
    }
}
