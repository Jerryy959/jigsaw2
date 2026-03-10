export class MyOrderManager {
    constructor(orderBook) {
        this.orderBook = orderBook;
        this.orders = new Map();
    }
    placeOrder(side, price, size) {
        const aheadVolume = this.orderBook.getLiquidity(price, side);
        const order = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            side,
            price,
            size,
            remaining: size,
            aheadVolume,
            createdAt: Date.now(),
        };
        this.orders.set(order.id, order);
        return order;
    }
    onBookEvent(event) {
        for (const order of this.orders.values()) {
            if (order.price !== event.price || order.remaining <= 0) {
                continue;
            }
            const affectedByQueueChange = event.type === 'cancel' && event.side === order.side;
            const affectedByTrade = event.type === 'trade' && ((order.side === 'bid' && event.side === 'ask') || (order.side === 'ask' && event.side === 'bid'));
            if (!affectedByQueueChange && !affectedByTrade) {
                continue;
            }
            const reduce = Math.min(order.aheadVolume, event.size);
            order.aheadVolume -= reduce;
            const remainingImpact = event.size - reduce;
            if (remainingImpact > 0) {
                order.remaining = Math.max(0, order.remaining - remainingImpact);
            }
        }
        for (const [id, order] of this.orders.entries()) {
            if (order.remaining <= 0) {
                this.orders.delete(id);
            }
        }
    }
    getOrders() {
        return [...this.orders.values()].sort((a, b) => a.createdAt - b.createdAt);
    }
    getTopOrderAt(price, side) {
        return this.getOrders().find((o) => o.price === price && o.side === side);
    }
}
