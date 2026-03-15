import { DOMRenderer } from './DOMRenderer.js';
import { createRealtimeSource, resolveDefaultSymbol } from './MarketDataSource.js';
import { MockDataGenerator } from './MockDataGenerator.js';
import { MyOrderManager } from './MyOrderManager.js';
import { MockMatchingEngine } from './MockMatchingEngine.js';
import { OrderBook } from './OrderBook.js';
const DEFAULT_TICK = 0.1;
const MOCK_TICK = 0.25;
function getNumParam(params, key, fallback, allowZero = false) {
    const val = Number(params.get(key) ?? NaN);
    return Number.isFinite(val) && (allowZero ? val >= 0 : val > 0) ? val : fallback;
}
function intParam(params, key, fallback) {
    return Math.floor(getNumParam(params, key, fallback, true));
}
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
    const exchange = params.get('exchange') === 'bybit' ? 'bybit' : 'binance';
    const market = params.get('market') === 'futures' ? 'futures' : 'spot';
    const symbol = params.get('symbol') ?? resolveDefaultSymbol(exchange, market);
    const isRealtime = sourceMode === 'realtime';
    // BTCUSDT spot uses tighter defaults; futures/others use the same default tick/step
    const isBtcSpot = symbol.toLowerCase() === 'btcusdt' && market === 'spot';
    const realtimeTick = isBtcSpot ? 0.01 : DEFAULT_TICK;
    // autoDetectTick: enabled for realtime when user has not explicitly set tickSize in the URL.
    // The first snapshot from the exchange is used to infer the real tick for any instrument.
    const autoDetectTick = isRealtime && !params.has('tickSize');
    const tickSize = getNumParam(params, 'tickSize', isRealtime ? realtimeTick : MOCK_TICK);
    const centerPrice = getNumParam(params, 'centerPrice', isRealtime ? 1 : 3856);
    let footprintBucketTicks = Math.max(1, intParam(params, 'fpBucketTicks', 1));
    let footprintWindowMs = 0;
    let footprintDecayMs = 0;
    const book = new OrderBook(centerPrice, tickSize, 160, !isRealtime);
    const mine = new MyOrderManager(book);
    latestPriceEl.textContent = book.formatPrice(centerPrice);
    book.setFootprintDisplayConfig({
        bucketSizeTicks: footprintBucketTicks,
        timeWindowMs: footprintWindowMs,
        decayHalfLifeMs: footprintDecayMs,
    });
    let orderSize = 1;
    let renderIntervalMs = 0;
    let autoFocusLocked = true;
    const rawUnit = params.get('sizeUnit');
    let sizeUnit = (rawUnit === 'quote' || rawUnit === 'lots') ? rawUnit : 'base';
    let panelDirty = true;
    let lastOrdersVersion = -1;
    let lastRenderAt = 0;
    const applyEvent = (event) => {
        book.applyEvent(event);
        const fills = mine.onBookEvent(event);
        fills.forEach(showFillToast);
        if (mine.getVersion() !== lastOrdersVersion)
            panelDirty = true;
    };
    const matcher = new MockMatchingEngine(book, mine, applyEvent);
    const onMarketEvent = (event) => {
        applyEvent(event);
        matcher.onMarketEvent(event);
    };
    const cancelOrderById = (orderId) => {
        const cancelled = mine.cancelById(orderId);
        if (!cancelled)
            return;
        applyEvent({ type: 'cancel', side: cancelled.side, price: cancelled.price, size: cancelled.remaining, timestamp: Date.now() });
        panelDirty = true;
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
        const rows = orders.map((o) => `
      <div class="order-row ${o.side === 'bid' ? 'bid' : 'ask'}">
        <div class="order-main">
          <span class="tag">${o.side === 'bid' ? 'BID' : 'ASK'}</span>
          <span>${book.formatPrice(o.price)}</span>
          <span>剩余:${o.remaining}</span>
          <span>排队:${Math.floor(o.aheadVolume) + 1}</span>
        </div>
        <button class="cancel-btn" data-order-id="${o.id}">撤单</button>
      </div>
    `).join('');
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
          ${[0, 50, 100, 200, 500, 1000].map(v => `<option value="${v}" ${renderIntervalMs === v ? 'selected' : ''}>${v === 0 ? '实时' : v + 'ms'}</option>`).join('')}
        </select>
      </div>
      <div class="refresh-control">
        <label>数量单位</label>
        <div class="unit-btn-group">
          <button class="unit-btn ${sizeUnit === 'base' ? 'active' : ''}" data-unit="base">基础货币</button>
          <button class="unit-btn ${sizeUnit === 'quote' ? 'active' : ''}" data-unit="quote">USDT</button>
          <button class="unit-btn ${sizeUnit === 'lots' ? 'active' : ''}" data-unit="lots">张</button>
        </div>
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
          ${[1, 2, 5].map(v => `<option value="${v}" ${footprintBucketTicks === v ? 'selected' : ''}>${v} tick${v > 1 ? 's' : ''}</option>`).join('')}
        </select>
        <div class="footprint-hint" style="grid-column: 1 / -1;">会话累计模式：刷新页面归零，不刷新持续累计</div>
      </div>
      <div class="source-control-grid">
        <label for="source-mode">数据源</label>
        <select id="source-mode" class="refresh-select">
          <option value="mock" ${!isRealtime ? 'selected' : ''}>Mock</option>
          <option value="realtime" ${isRealtime ? 'selected' : ''}>Realtime</option>
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
    const updateRoute = () => {
        const next = new URLSearchParams(window.location.search);
        const sel = (id) => document.getElementById(id)?.value;
        const inp = (id) => document.getElementById(id)?.value?.trim();
        if (sel('source-mode'))
            next.set('source', sel('source-mode'));
        if (sel('exchange-mode'))
            next.set('exchange', sel('exchange-mode'));
        if (sel('market-mode'))
            next.set('market', sel('market-mode'));
        if (inp('symbol-input'))
            next.set('symbol', inp('symbol-input'));
        next.set('sizeUnit', sizeUnit); // persist across reload
        window.location.search = next.toString();
    };
    ordersPanel.addEventListener('change', (ev) => {
        const select = ev.target.closest('select');
        if (!select)
            return;
        if (select.id === 'refresh-mode') {
            renderIntervalMs = Number(select.value);
        }
        else if (select.id === 'focus-lock-mode') {
            autoFocusLocked = select.value !== 'free';
            renderer.setAutoFocusLocked(autoFocusLocked);
        }
        else if (select.id === 'fp-bucket') {
            footprintBucketTicks = Math.max(1, Number(select.value) || 1);
            footprintWindowMs = 0;
            footprintDecayMs = 0;
            book.setFootprintDisplayConfig({ bucketSizeTicks: footprintBucketTicks, timeWindowMs: footprintWindowMs, decayHalfLifeMs: footprintDecayMs });
        }
        else {
            return;
        }
        panelDirty = true;
    });
    ordersPanel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const target = ev.target;
        if (target.closest('#apply-source-config')) {
            updateRoute();
            return;
        }
        const sizeBtn = target.closest('.size-btn');
        if (sizeBtn) {
            orderSize = Math.max(1, Math.min(100, orderSize + Number(sizeBtn.dataset.step || 0)));
            panelDirty = true;
            return;
        }
        const unitBtn = target.closest('.unit-btn');
        if (unitBtn?.dataset.unit) {
            sizeUnit = unitBtn.dataset.unit;
            renderer.setSizeUnit(sizeUnit);
            panelDirty = true;
            return;
        }
        const cancelBtn = target.closest('.cancel-btn');
        if (cancelBtn?.dataset.orderId)
            cancelOrderById(cancelBtn.dataset.orderId);
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
    renderer.setSizeUnit(sizeUnit);
    const recoverRenderer = () => {
        renderer.recoverAfterTabSwitch();
        panelDirty = true;
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible')
        recoverRenderer(); });
    window.addEventListener('pageshow', recoverRenderer);
    const marketDataSource = isRealtime
        ? createRealtimeSource(book, onMarketEvent, { exchange, market, symbol, tickSize, autoDetectTick })
        : new MockDataGenerator(book, 70, onMarketEvent, { addWeight: 0.42, cancelWeight: 0.25, tradeWeight: 0.33, burstChance: 0.32 });
    marketDataSource.start();
    console.info(`[MarketData] source started: ${marketDataSource.getName()}`);
    let lastDisplayedPrice = '';
    const loop = () => {
        const now = performance.now();
        if (renderIntervalMs === 0 || now - lastRenderAt >= renderIntervalMs) {
            renderer.render();
            lastRenderAt = now;
            // Always keep the price display in sync with the book — not just on trade events
            const formatted = book.formatPrice(book.getSnapshot().currentPrice);
            if (formatted !== lastDisplayedPrice) {
                latestPriceEl.textContent = formatted;
                lastDisplayedPrice = formatted;
            }
        }
        if (panelDirty)
            renderOrdersPanel();
        requestAnimationFrame(loop);
    };
    loop();
    window.addEventListener('beforeunload', () => marketDataSource.stop());
}
bootstrap();
