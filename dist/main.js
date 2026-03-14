import { DOMRenderer } from './DOMRenderer.js';
import { createRealtimeSource, resolveDefaultSymbol } from './MarketDataSource.js';
import { MockDataGenerator } from './MockDataGenerator.js';
import { MyOrderManager } from './MyOrderManager.js';
import { MockMatchingEngine } from './MockMatchingEngine.js';
import { OrderBook } from './OrderBook.js';
const DEFAULT_REALTIME_TICK_SIZE = 0.0001;
const DEFAULT_MOCK_TICK_SIZE = 0.25;
function bootstrap() {
    const app = document.getElementById('app');
    const ordersPanel = document.getElementById('orders-panel');
    const toastRoot = document.getElementById('toast-root');
    const latestPriceEl = document.getElementById('latest-price-value');
    if (!app || !ordersPanel || !toastRoot || !latestPriceEl) {
        throw new Error('Missing root nodes');
    }
    const params = new URLSearchParams(window.location.search);
    const sourceMode = params.get('source') ?? 'mock';
    const exchange = params.get('exchange') ?? 'binance';
    const market = params.get('market') ?? 'spot';
    const symbol = params.get('symbol') ?? resolveDefaultSymbol(exchange === 'bybit' ? 'bybit' : 'binance', market === 'futures' ? 'futures' : 'spot');
    const randomSeededLiquidity = sourceMode === 'mock';
    const tickSize = Number(params.get('tickSize') ?? (sourceMode === 'realtime' ? DEFAULT_REALTIME_TICK_SIZE : DEFAULT_MOCK_TICK_SIZE));
    const normalizedTick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : sourceMode === 'realtime' ? DEFAULT_REALTIME_TICK_SIZE : DEFAULT_MOCK_TICK_SIZE;
    const centerPrice = Number(params.get('centerPrice') ?? (sourceMode === 'realtime' ? 1 : 3856));
    const normalizedCenter = Number.isFinite(centerPrice) && centerPrice > 0 ? centerPrice : sourceMode === 'realtime' ? 1 : 3856;
    const book = new OrderBook(normalizedCenter, normalizedTick, 160, randomSeededLiquidity);
    const mine = new MyOrderManager(book);
    latestPriceEl.textContent = book.formatPrice(normalizedCenter);
    let orderSize = 1;
    let renderIntervalMs = 0; // 0 = realtime
    let footprintBucketTicks = Number(params.get('fpBucketTicks') ?? '1');
    let footprintWindowMs = Number(params.get('fpWindowMs') ?? '0');
    let footprintDecayHalfLifeMs = Number(params.get('fpDecayHalfLifeMs') ?? '0');
    footprintBucketTicks = Number.isFinite(footprintBucketTicks) && footprintBucketTicks > 0 ? Math.floor(footprintBucketTicks) : 1;
    footprintWindowMs = Number.isFinite(footprintWindowMs) && footprintWindowMs >= 0 ? Math.floor(footprintWindowMs) : 0;
    footprintDecayHalfLifeMs = Number.isFinite(footprintDecayHalfLifeMs) && footprintDecayHalfLifeMs >= 0 ? Math.floor(footprintDecayHalfLifeMs) : 0;
    book.setFootprintDisplayConfig({
        bucketSizeTicks: footprintBucketTicks,
        timeWindowMs: footprintWindowMs,
        decayHalfLifeMs: footprintDecayHalfLifeMs,
    });
    let autoFocusLocked = true;
    let panelDirty = true;
    let lastOrdersVersion = -1;
    let lastRenderAt = 0;
    const updateRouteWithSelection = () => {
        const sourceSelect = document.getElementById('source-mode');
        const exchangeSelect = document.getElementById('exchange-mode');
        const marketSelect = document.getElementById('market-mode');
        const symbolInput = document.getElementById('symbol-input');
        const next = new URLSearchParams(window.location.search);
        if (sourceSelect) {
            next.set('source', sourceSelect.value);
        }
        if (exchangeSelect) {
            next.set('exchange', exchangeSelect.value);
        }
        if (marketSelect) {
            next.set('market', marketSelect.value);
        }
        if (symbolInput?.value) {
            next.set('symbol', symbolInput.value.trim());
        }
        window.location.search = next.toString();
    };
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
              <span>${book.formatPrice(o.price)}</span>
              <span>剩余:${o.remaining}</span>
              <span>排队:${queueRank}</span>
            </div>
            <button class="cancel-btn" data-order-id="${o.id}">撤单</button>
          </div>
        `;
        })
            .join('');
        ordersPanel.innerHTML = `
      <div class="orders-title-row">
        <div class="orders-title">我的挂单 (${orders.length})</div>
        <div class="size-control">
          <span>下单手数</span>
          <button class="size-btn" data-step="-1">-</button>
          <span class="size-value">${orderSize}</span>
          <button class="size-btn" data-step="1">+</button>
        </div>
      </div>
      <div class="refresh-control">
        <label for="refresh-mode">订单簿刷新</label>
        <select id="refresh-mode" class="refresh-select">
          <option value="0" ${renderIntervalMs === 0 ? 'selected' : ''}>实时</option>
          <option value="50" ${renderIntervalMs === 50 ? 'selected' : ''}>50ms</option>
          <option value="100" ${renderIntervalMs === 100 ? 'selected' : ''}>100ms</option>
          <option value="200" ${renderIntervalMs === 200 ? 'selected' : ''}>200ms</option>
          <option value="500" ${renderIntervalMs === 500 ? 'selected' : ''}>500ms</option>
          <option value="1000" ${renderIntervalMs === 1000 ? 'selected' : ''}>1000ms</option>
        </select>
      </div>
      <div class="refresh-control">
        <label for="focus-lock-mode">价格自动聚焦</label>
        <select id="focus-lock-mode" class="refresh-select">
          <option value="locked" ${autoFocusLocked ? 'selected' : ''}>锁定跟随买一卖一</option>
          <option value="free" ${autoFocusLocked ? '' : 'selected'}>解锁自由滑动</option>
        </select>
      </div>
      <div class="footprint-control-grid">
        <label for="fp-bucket">CUM价格聚合</label>
        <select id="fp-bucket" class="refresh-select">
          <option value="1" ${footprintBucketTicks === 1 ? 'selected' : ''}>1 tick</option>
          <option value="2" ${footprintBucketTicks === 2 ? 'selected' : ''}>2 ticks</option>
          <option value="5" ${footprintBucketTicks === 5 ? 'selected' : ''}>5 ticks</option>
        </select>
        <div class="footprint-hint" style="grid-column: 1 / -1;">会话累计模式：刷新页面归零，不刷新持续累计</div>
      </div>
      <div class="source-control-grid">
        <label for="source-mode">数据源</label>
        <select id="source-mode" class="refresh-select">
          <option value="mock" ${sourceMode === 'mock' ? 'selected' : ''}>Mock</option>
          <option value="realtime" ${sourceMode === 'realtime' ? 'selected' : ''}>Realtime</option>
        </select>
        <label for="exchange-mode">交易所</label>
        <select id="exchange-mode" class="refresh-select">
          <option value="binance" ${exchange === 'binance' ? 'selected' : ''}>Binance</option>
          <option value="bybit" ${exchange === 'bybit' ? 'selected' : ''}>Bybit</option>
        </select>
        <label for="market-mode">市场</label>
        <select id="market-mode" class="refresh-select">
          <option value="spot" ${market === 'spot' ? 'selected' : ''}>现货</option>
          <option value="futures" ${market === 'futures' ? 'selected' : ''}>期货</option>
        </select>
        <label for="symbol-input">币种</label>
        <input id="symbol-input" class="symbol-input" value="${symbol}" />
        <button id="apply-source-config" class="apply-btn" type="button">应用配置</button>
      </div>
      <div class="orders-body">${rows || '<div class="order-empty">暂无挂单</div>'}</div>
    `;
        panelDirty = false;
        lastOrdersVersion = mine.getVersion();
    };
    const applyEvent = (event) => {
        book.applyEvent(event);
        latestPriceEl.textContent = book.formatPrice(book.getSnapshot().currentPrice);
        const fills = mine.onBookEvent(event);
        fills.forEach(showFillToast);
        if (mine.getVersion() !== lastOrdersVersion) {
            panelDirty = true;
        }
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
        panelDirty = true;
    };
    ordersPanel.addEventListener('change', (ev) => {
        const target = ev.target;
        const select = target.closest('select');
        if (!select) {
            return;
        }
        if (select.id === 'refresh-mode') {
            renderIntervalMs = Number(select.value);
            panelDirty = true;
            return;
        }
        if (select.id === 'focus-lock-mode') {
            autoFocusLocked = select.value !== 'free';
            renderer.setAutoFocusLocked(autoFocusLocked);
            panelDirty = true;
            return;
        }
        if (select.id === 'fp-bucket') {
            footprintBucketTicks = Math.max(1, Number(select.value) || 1);
        }
        else {
            return;
        }
        footprintWindowMs = 0;
        footprintDecayHalfLifeMs = 0;
        book.setFootprintDisplayConfig({
            bucketSizeTicks: footprintBucketTicks,
            timeWindowMs: footprintWindowMs,
            decayHalfLifeMs: footprintDecayHalfLifeMs,
        });
        panelDirty = true;
    });
    ordersPanel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const target = ev.target;
        const applyButton = target.closest('#apply-source-config');
        if (applyButton) {
            updateRouteWithSelection();
            return;
        }
        const sizeBtn = target.closest('.size-btn');
        if (sizeBtn) {
            const step = Number(sizeBtn.dataset.step || '0');
            orderSize = Math.max(1, Math.min(100, orderSize + step));
            panelDirty = true;
            return;
        }
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
                panelDirty = true;
            }
            return;
        }
        mine.placeOrder(side, price, orderSize);
        applyEvent({ type: 'add', side, price, size: orderSize, timestamp: Date.now() });
        panelDirty = true;
    });
    renderer.init();
    renderer.setAutoFocusLocked(autoFocusLocked);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            renderer.recoverAfterTabSwitch();
            panelDirty = true;
        }
    });
    window.addEventListener('pageshow', () => {
        renderer.recoverAfterTabSwitch();
        panelDirty = true;
    });
    const marketDataSource = sourceMode === 'realtime'
        ? createRealtimeSource(book, onMarketEvent, {
            exchange: exchange === 'bybit' ? 'bybit' : 'binance',
            market: market === 'futures' ? 'futures' : 'spot',
            symbol,
            tickSize: normalizedTick,
        })
        : new MockDataGenerator(book, 70, onMarketEvent, {
            addWeight: 0.42,
            cancelWeight: 0.25,
            tradeWeight: 0.33,
            burstChance: 0.32,
        });
    marketDataSource.start();
    console.info(`[MarketData] source started: ${marketDataSource.getName()}`);
    const loop = () => {
        const now = performance.now();
        const shouldRenderBook = renderIntervalMs === 0 || now - lastRenderAt >= renderIntervalMs;
        if (shouldRenderBook) {
            renderer.render();
            lastRenderAt = now;
        }
        if (panelDirty) {
            renderOrdersPanel();
        }
        requestAnimationFrame(loop);
    };
    loop();
    window.addEventListener('beforeunload', () => {
        marketDataSource.stop();
    });
}
bootstrap();
