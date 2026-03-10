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
    cancelTopOrderAt(price, side) {
        const top = this.getTopOrderAt(price, side);
        if (!top) {
            return undefined;
        }
        this.orders.delete(top.id);
        return top;
    }
    cancelById(orderId) {
        const order = this.orders.get(orderId);
        if (!order) {
            return undefined;
        }
        this.orders.delete(orderId);
        return order;
    }
    onBookEvent(event) {
        const fills = [];
        for (const order of this.orders.values()) {
            if (order.price !== event.price || order.remaining <= 0) {
                continue;
            }
            const queueChange = event.type === 'cancel' && event.side === order.side;
            const matchHappened = event.type === 'trade' &&
                ((order.side === 'bid' && event.side === 'ask') ||
                    (order.side === 'ask' && event.side === 'bid'));
            if (!queueChange && !matchHappened) {
                continue;
            }
            const consumedAhead = Math.min(order.aheadVolume, event.size);
            order.aheadVolume -= consumedAhead;
            const impactOnMe = event.size - consumedAhead;
            if (impactOnMe > 0) {
                const filled = Math.min(order.remaining, impactOnMe);
                order.remaining = Math.max(0, order.remaining - impactOnMe);
                fills.push({
                    orderId: order.id,
                    side: order.side,
                    price: order.price,
                    fillSize: filled,
                    remaining: order.remaining,
                });
            }
        }
        for (const [id, order] of this.orders.entries()) {
            if (order.remaining <= 0) {
                this.orders.delete(id);
            }
        }
        return fills;
    }
    getOrders() {
        return [...this.orders.values()].sort((a, b) => a.createdAt - b.createdAt);
    }
    getTopOrderAt(price, side) {
        return this.getOrders().find((o) => o.price === price && o.side === side);
    }
}
