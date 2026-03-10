import { DOMRenderer } from './DOMRenderer.js';
import { MockDataGenerator } from './MockDataGenerator.js';
import { MyOrderManager } from './MyOrderManager.js';
import { MockMatchingEngine } from './MockMatchingEngine.js';
import { OrderBook } from './OrderBook.js';
function bootstrap() {
    const app = document.getElementById('app');
    const ordersPanel = document.getElementById('orders-panel');
    const toastRoot = document.getElementById('toast-root');
    if (!app || !ordersPanel || !toastRoot) {
        throw new Error('Missing root nodes');
    }
    const book = new OrderBook(3856, 0.25, 160);
    const mine = new MyOrderManager(book);
    const showFillToast = (fill) => {
        const item = document.createElement('div');
        item.className = 'toast';
        const sideText = fill.side === 'bid' ? '买单' : '卖单';
        item.textContent = `✅ ${sideText} ${fill.price.toFixed(2)} 成交 ${fill.fillSize}，剩余 ${fill.remaining}`;
        toastRoot.appendChild(item);
        window.setTimeout(() => {
            item.classList.add('hide');
            window.setTimeout(() => item.remove(), 280);
        }, 1700);
    };
    const renderOrdersPanel = () => {
        const orders = mine.getOrders();
        const rows = orders
            .map((o) => {
            const sideClass = o.side === 'bid' ? 'bid' : 'ask';
            const sideText = o.side === 'bid' ? 'BID' : 'ASK';
            const queueRank = Math.floor(o.aheadVolume) + 1;
            return `
          <div class="order-row ${sideClass}">
            <div class="order-main">
              <span class="tag">${sideText}</span>
              <span>${o.price.toFixed(2)}</span>
              <span>剩余:${o.remaining}</span>
              <span>排队:${queueRank}</span>
            </div>
            <button class="cancel-btn" data-order-id="${o.id}">撤单</button>
          </div>
        `;
        })
            .join('');
        ordersPanel.innerHTML = `
      <div class="orders-title">我的挂单 (${orders.length})</div>
      <div class="orders-body">${rows || '<div class="order-empty">暂无挂单</div>'}</div>
    `;
    };
    const applyEvent = (event) => {
        book.applyEvent(event);
        const fills = mine.onBookEvent(event);
        fills.forEach(showFillToast);
    };
    const matcher = new MockMatchingEngine(book, mine, (fillEvent) => {
        applyEvent(fillEvent);
    });
    const onMarketEvent = (event) => {
        applyEvent(event);
        matcher.onMarketEvent(event);
    };
    const cancelOrderById = (orderId) => {
        const cancelled = mine.cancelById(orderId);
        if (!cancelled) {
            return;
        }
        applyEvent({
            type: 'cancel',
            side: cancelled.side,
            price: cancelled.price,
            size: cancelled.remaining,
            timestamp: Date.now(),
        });
        renderOrdersPanel();
    };
    ordersPanel.addEventListener('click', (ev) => {
        const target = ev.target;
        const btn = target.closest('.cancel-btn');
        if (!btn) {
            return;
        }
        const orderId = btn.dataset.orderId;
        if (!orderId) {
            return;
        }
        cancelOrderById(orderId);
    });
    const renderer = new DOMRenderer(book, mine, app, (price, side, action) => {
        if (action === 'cancel') {
            const cancelled = mine.cancelTopOrderAt(price, side);
            if (cancelled) {
                applyEvent({ type: 'cancel', side, price, size: cancelled.remaining, timestamp: Date.now() });
            }
            renderOrdersPanel();
            return;
        }
        const size = 8 + Math.floor(Math.random() * 18);
        mine.placeOrder(side, price, size);
        applyEvent({ type: 'add', side, price, size, timestamp: Date.now() });
        renderOrdersPanel();
    });
    renderer.init();
    const mock = new MockDataGenerator(book, 70, onMarketEvent, {
        addWeight: 0.42,
        cancelWeight: 0.25,
        tradeWeight: 0.33,
        burstChance: 0.32,
    });
    mock.start();
    const loop = () => {
        renderer.render();
        renderOrdersPanel();
        requestAnimationFrame(loop);
    };
    loop();
}
bootstrap();
