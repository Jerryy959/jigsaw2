export class MyOrderManager {
    constructor(orderBook) {
        this.orderBook = orderBook;
        this.orders = new Map();
    }
    placeOrder(side, price, size = 1) {
        const ahead = this.orderBook.getSizeAt(price, side);
        const order = {
            id: `${side}-${price}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            side,
            price,
            size,
            ahead,
        };
        this.orders.set(order.id, order);
        return order;
    }
    onBookEvent(event) {
        for (const order of this.orders.values()) {
            if (order.price !== event.price || order.side !== event.side) {
                continue;
            }
            if (event.type === 'trade' || event.type === 'cancel') {
                // 简化模型：成交/撤单优先减少排在我前面的队列。
                order.ahead = Math.max(0, order.ahead - event.size);
            }
        }
    }
    getOrders() {
        return [...this.orders.values()];
    }
    getOrdersAt(price, side) {
        return this.getOrders().filter((order) => order.price === price && order.side === side);
    }
}
