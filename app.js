// ===================== APP VERSION =====================
const APP_VERSION = '0.40';

// ===================== GLOBAL ERROR VISIBILITY =====================
// Since some devices (e.g. tablets with no USB port) can't be debugged with
// DevTools, surface any otherwise-silent error directly on screen.
function showGlobalError(message) {
  let el = document.getElementById('global-error-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-error-banner';
    el.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:3000; background:#a3231f; color:#fff; padding:12px 16px; font-size:13px; font-weight:600;';
    document.body.appendChild(el);
  }
  el.textContent = 'Error: ' + message;
}
window.addEventListener('error', function (e) {
  showGlobalError(e.message || 'Unknown error');
});
window.addEventListener('unhandledrejection', function (e) {
  showGlobalError((e.reason && e.reason.message) ? e.reason.message : String(e.reason));
});

// ===================== DATA LAYER =====================
const db = new Dexie('purchase-tracker');
db.version(1).stores({
  products: 'barcode, sku, name, tax_group, category, supplier_id',
  suppliers: 'supplier_id'
});
db.version(2).stores({
  products: 'barcode, sku, name, tax_group, category, supplier_id',
  suppliers: 'supplier_id',
  settings: 'id',
  invoices: 'invoice_number, invoice_date',
  invoice_items: '++id, invoice_number'
});
// Changing a table's primary key isn't supported in a single version step in
// Dexie — the old invoices/invoice_items tables must be fully removed first
// (version 3), then recreated with the new structure (version 4).
db.version(3).stores({
  products: 'barcode, sku, name, tax_group, category, supplier_id',
  suppliers: 'supplier_id',
  settings: 'id',
  invoices: null,
  invoice_items: null
});
db.version(4).stores({
  products: 'barcode, sku, name, tax_group, category, supplier_id',
  suppliers: 'supplier_id',
  settings: 'id',
  invoices: '++id, invoice_number, invoice_date, status',
  invoice_items: '++id, invoice_id'
});
db.version(5).stores({
  products: 'barcode, sku, name, tax_group, category, supplier_id',
  suppliers: 'supplier_id',
  settings: 'id',
  invoices: '++id, invoice_number, invoice_date, status',
  invoice_items: '++id, invoice_id',
  orders: '++id, status, confirmed_at, exported',
  order_items: '++id, order_id'
});

// Seed the 7 placeholder suppliers on first run
async function seedSuppliers() {
  const count = await db.suppliers.count();
  if (count === 0) {
    const seed = [];
    for (let i = 1; i <= 7; i++) {
      seed.push({ supplier_id: i, supplier_name: 'Supplier ' + i });
    }
    await db.suppliers.bulkAdd(seed);
  }
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}

const TAX_OPTIONS = [
  { label: '21%', value: 'R21' },
  { label: '9%', value: 'R9' }
];
const CATEGORY_OPTIONS = ['Food', 'Non food'];

const ALL_COLUMNS = [
  { key: 'barcode', label: 'Barcode' },
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Name' },
  { key: 'price', label: 'Price' },
  { key: 'cost_price', label: 'Cost price' },
  { key: 'category', label: 'Category' },
  { key: 'tax_group', label: 'Tax group' },
  { key: 'supplier_id', label: 'Supplier' },
  { key: 'date_added', label: 'Date added' },
  { key: 'date_modified', label: 'Date modified' }
];

let supplierMap = {}; // supplier_id -> supplier_name

async function refreshSupplierMap() {
  const all = await db.suppliers.toArray();
  supplierMap = {};
  all.forEach(function (s) { supplierMap[s.supplier_id] = s.supplier_name; });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function taxLabel(value) {
  const found = TAX_OPTIONS.find(function (t) { return t.value === value; });
  return found ? found.label : value;
}

// ===================== TOP-LEVEL TAB SWITCHING =====================
const tabBasket = document.getElementById('tab-basket');
const tabProducts = document.getElementById('tab-products');
const tabInvoice = document.getElementById('tab-invoice');
const viewBasket = document.getElementById('view-basket');
const viewProducts = document.getElementById('view-products');
const viewInvoice = document.getElementById('view-invoice');

function focusActiveScanField() {
  if (viewBasket.style.display !== 'none') {
    if (subBasketNew.style.display !== 'none') {
      basketScan.focus();
    }
  } else if (viewProducts.style.display !== 'none') {
    if (subManage.style.display !== 'none') {
      manageScan.focus();
    } else if (subAdd.style.display !== 'none') {
      addScan.focus();
    }
  } else if (viewInvoice.style.display !== 'none') {
    if (subInvoiceNew.style.display !== 'none') {
      invoiceScan.focus();
    }
  }
}

function activateTopTab(name) {
  tabBasket.classList.toggle('active', name === 'basket');
  tabProducts.classList.toggle('active', name === 'products');
  tabInvoice.classList.toggle('active', name === 'invoice');
  viewBasket.style.display = name === 'basket' ? '' : 'none';
  viewProducts.style.display = name === 'products' ? '' : 'none';
  viewInvoice.style.display = name === 'invoice' ? '' : 'none';
  if (name === 'products') renderProductList();
  if (name === 'invoice') refreshInvoiceNumberPreview();
  focusActiveScanField();
}

tabBasket.addEventListener('click', function () { activateTopTab('basket'); });
tabProducts.addEventListener('click', function () { activateTopTab('products'); });
tabInvoice.addEventListener('click', function () { activateTopTab('invoice'); });

// ===================== SUB-TAB SWITCHING (Basket) =====================
const subtabBasketNew = document.getElementById('subtab-basket-new');
const subtabBasketHistory = document.getElementById('subtab-basket-history');
const subBasketNew = document.getElementById('sub-basket-new');
const subBasketHistory = document.getElementById('sub-basket-history');

function showBasketSubtab(name) {
  subtabBasketNew.classList.toggle('active', name === 'new');
  subtabBasketHistory.classList.toggle('active', name === 'history');
  subBasketNew.style.display = name === 'new' ? '' : 'none';
  subBasketHistory.style.display = name === 'history' ? '' : 'none';
  if (name === 'history') renderOrderHistory();
  focusActiveScanField();
}
subtabBasketNew.addEventListener('click', function () { showBasketSubtab('new'); });
subtabBasketHistory.addEventListener('click', function () { showBasketSubtab('history'); });

// ===================== SUB-TAB SWITCHING (Products) =====================
const subtabManage = document.getElementById('subtab-manage');
const subtabAdd = document.getElementById('subtab-add');
const subtabList = document.getElementById('subtab-list');
const subManage = document.getElementById('sub-manage');
const subAdd = document.getElementById('sub-add');
const subList = document.getElementById('sub-list');

function showSubtab(name) {
  subtabManage.classList.toggle('active', name === 'manage');
  subtabAdd.classList.toggle('active', name === 'add');
  subtabList.classList.toggle('active', name === 'list');
  subManage.style.display = name === 'manage' ? '' : 'none';
  subAdd.style.display = name === 'add' ? '' : 'none';
  subList.style.display = name === 'list' ? '' : 'none';
  if (name === 'list') renderProductList();
  focusActiveScanField();
}
subtabManage.addEventListener('click', function () { showSubtab('manage'); });
subtabAdd.addEventListener('click', function () { showSubtab('add'); });
subtabList.addEventListener('click', function () { showSubtab('list'); });

// ===================== SUB-TAB SWITCHING (Invoice) =====================
const subtabInvoiceNew = document.getElementById('subtab-invoice-new');
const subtabInvoiceHistory = document.getElementById('subtab-invoice-history');
const subtabInvoiceSettings = document.getElementById('subtab-invoice-settings');
const subInvoiceNew = document.getElementById('sub-invoice-new');
const subInvoiceHistory = document.getElementById('sub-invoice-history');
const subInvoiceSettings = document.getElementById('sub-invoice-settings');

function showInvoiceSubtab(name) {
  subtabInvoiceNew.classList.toggle('active', name === 'new');
  subtabInvoiceHistory.classList.toggle('active', name === 'history');
  subtabInvoiceSettings.classList.toggle('active', name === 'settings');
  subInvoiceNew.style.display = name === 'new' ? '' : 'none';
  subInvoiceHistory.style.display = name === 'history' ? '' : 'none';
  subInvoiceSettings.style.display = name === 'settings' ? '' : 'none';
  if (name === 'history') renderInvoiceHistory();
  if (name === 'settings') loadSettingsIntoForm();
  if (name === 'new') refreshInvoiceNumberPreview();
  focusActiveScanField();
}
subtabInvoiceNew.addEventListener('click', function () { showInvoiceSubtab('new'); });
subtabInvoiceHistory.addEventListener('click', function () { showInvoiceSubtab('history'); });
subtabInvoiceSettings.addEventListener('click', function () { showInvoiceSubtab('settings'); });

// ===================== BASKET TAB =====================
function setStatus(el, msg) {
  el.textContent = msg;
  setTimeout(function () { el.textContent = ''; }, 2000);
}

let currentOrderId = null;
let basketLines = []; // { id (order_item id), barcode, name, price, qty, tax_group }
const basketScan = document.getElementById('basket-scan');
const basketLinesEl = document.getElementById('basket-lines');
const basketEmpty = document.getElementById('basket-empty');
const basketCount = document.getElementById('basket-count');
const basketTotal = document.getElementById('basket-total');
const basketMessageEl = document.getElementById('basket-message');

async function loadActiveOrCreateOrder() {
  let activeOrder = await db.orders.where('status').equals('active').first();
  if (!activeOrder) {
    const id = await db.orders.add({
      created_at: new Date().toISOString(),
      confirmed_at: null,
      total: 0,
      payment_method: null,
      status: 'active',
      edited_at: null,
      exported: false,
      exported_at: null
    });
    activeOrder = await db.orders.get(id);
  }
  currentOrderId = activeOrder.id;
  const items = await db.order_items.where('order_id').equals(currentOrderId).toArray();
  basketLines = items.map(function (it) {
    return { id: it.id, barcode: it.barcode, name: it.name, price: it.price, qty: it.qty, tax_group: it.tax_group };
  });
  renderBasketLines();
}

async function saveOrderTotal() {
  const total = basketLines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  await db.orders.update(currentOrderId, { total: total });
}

function updateBasketSummary() {
  const total = basketLines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const items = basketLines.reduce(function (s, l) { return s + l.qty; }, 0);
  basketTotal.textContent = '€' + total.toFixed(2);
  basketCount.textContent = items + (items === 1 ? ' item' : ' items');

  const sub9 = basketLines.filter(function (l) { return l.tax_group === 'R9'; }).reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const sub21 = basketLines.filter(function (l) { return l.tax_group === 'R21'; }).reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const warningEl = document.getElementById('mixed-tax-warning');
  if (sub9 > 0 && sub21 > 0) {
    warningEl.innerHTML =
      '<div class="msg-box warn" style="font-size:15px;">' +
        '<div style="font-weight:700; margin-bottom:6px;">Mixed tax rates — needs two separate PIN transactions</div>' +
        '<div>9% items: <strong>€' + sub9.toFixed(2) + '</strong> &nbsp;·&nbsp; 21% items: <strong>€' + sub21.toFixed(2) + '</strong></div>' +
      '</div>' +
      '<div class="msg-box success" style="font-size:14px; margin-top:8px;">' +
        'If Cash: proceed with total <strong>€' + total.toFixed(2) + '</strong>' +
      '</div>';
  } else {
    warningEl.innerHTML = '';
  }
}

function renderBasketLines() {
  basketLinesEl.innerHTML = '';
  basketEmpty.style.display = basketLines.length === 0 ? '' : 'none';

  basketLines.forEach(function (line, idx) {
    const div = document.createElement('div');
    div.className = 'invoice-line-card';
    const lineTotal = (line.price * line.qty).toFixed(2);
    const taxClass = line.tax_group === 'R21' ? 'r21' : 'r9';
    div.innerHTML =
      '<div class="invoice-line-name">' + (idx + 1) + '. ' + line.name + '</div>' +
      '<div class="invoice-line-price-stepper">' +
        '<button class="invoice-line-price-btn" data-idx="' + idx + '" data-dir="-1" aria-label="Decrease price">&minus;</button>' +
        '<div class="invoice-line-price-wrap">' +
          '<span class="invoice-line-currency">€</span>' +
          '<input type="text" inputmode="decimal" class="invoice-line-price-input" data-idx="' + idx + '" value="' + line.price.toFixed(2) + '" />' +
        '</div>' +
        '<button class="invoice-line-price-btn" data-idx="' + idx + '" data-dir="1" aria-label="Increase price">+</button>' +
      '</div>' +
      '<div class="invoice-line-qty-stepper">' +
        '<button class="invoice-line-qty-btn" data-idx="' + idx + '" data-dir="-1" aria-label="Decrease quantity">&minus;</button>' +
        '<span class="invoice-line-qty-value">' + line.qty + '</span>' +
        '<button class="invoice-line-qty-btn" data-idx="' + idx + '" data-dir="1" aria-label="Increase quantity">+</button>' +
      '</div>' +
      '<span class="tax-badge ' + taxClass + '">' + taxLabel(line.tax_group) + '</span>' +
      '<div class="invoice-line-total">€' + lineTotal + '</div>' +
      '<button class="invoice-line-remove-btn" data-idx="' + idx + '" aria-label="Remove line">&times;</button>';
    basketLinesEl.appendChild(div);
  });

  basketLinesEl.querySelectorAll('.invoice-line-price-input').forEach(function (input) {
    input.addEventListener('input', async function () {
      const idx = parseInt(input.getAttribute('data-idx'), 10);
      const val = parseFloat(input.value.replace(',', '.'));
      basketLines[idx].price = isNaN(val) ? 0 : val;
      updateBasketSummary();
      await db.order_items.update(basketLines[idx].id, { price: basketLines[idx].price });
      await saveOrderTotal();
    });
  });

  basketLinesEl.querySelectorAll('.invoice-line-price-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      const current = basketLines[idx].price;
      const next = Math.max(0, Math.round((current + dir * 0.05) * 100) / 100);
      basketLines[idx].price = next;
      await db.order_items.update(basketLines[idx].id, { price: next });
      await saveOrderTotal();
      renderBasketLines();
    });
  });

  basketLinesEl.querySelectorAll('.invoice-line-qty-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      const nextQty = Math.max(1, basketLines[idx].qty + dir);
      basketLines[idx].qty = nextQty;
      await db.order_items.update(basketLines[idx].id, { qty: nextQty });
      await saveOrderTotal();
      renderBasketLines();
    });
  });

  basketLinesEl.querySelectorAll('.invoice-line-remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const line = basketLines[idx];
      openConfirmModal('Are you sure you want to remove "' + (line ? line.name : 'this line') + '" from the basket?', 'Yes, remove', async function () {
        await db.order_items.delete(line.id);
        basketLines.splice(idx, 1);
        await saveOrderTotal();
        renderBasketLines();
      });
    });
  });

  updateBasketSummary();
}

basketScan.addEventListener('keydown', async function (e) {
  if (e.key !== 'Enter') return;
  const code = basketScan.value.trim();
  basketScan.value = '';
  if (!code) return;
  const product = await db.products.get(code);
  if (!product) {
    basketMessageEl.innerHTML = '<div class="msg-box warn">Unknown barcode ' + code + ' — add it in Products first.</div>';
    return;
  }
  basketMessageEl.innerHTML = '';
  const existing = basketLines.find(function (l) { return l.barcode === code; });
  if (existing) {
    existing.qty += 1;
    await db.order_items.update(existing.id, { qty: existing.qty });
  } else {
    const itemId = await db.order_items.add({
      order_id: currentOrderId,
      barcode: code,
      name: product.name,
      price: product.price,
      qty: 1,
      tax_group: product.tax_group
    });
    basketLines.push({ id: itemId, barcode: code, name: product.name, price: product.price, qty: 1, tax_group: product.tax_group });
  }
  await saveOrderTotal();
  renderBasketLines();
});

document.getElementById('void-basket-btn').addEventListener('click', function () {
  if (basketLines.length === 0) return;
  openConfirmModal('Are you sure you want to void this basket? All lines will be removed.', 'Yes, void', async function () {
    await db.order_items.where('order_id').equals(currentOrderId).delete();
    await db.orders.delete(currentOrderId);
    currentOrderId = null;
    basketLines = [];
    await loadActiveOrCreateOrder();
    basketMessageEl.innerHTML = '<div class="msg-box success">Basket voided.</div>';
    basketScan.focus();
  });
});

document.getElementById('confirm-order-btn').addEventListener('click', function () {
  if (basketLines.length === 0) {
    basketMessageEl.innerHTML = '<div class="msg-box error">Add at least one item before confirming the order.</div>';
    return;
  }
  document.getElementById('payment-modal').style.display = 'flex';
});

async function finalizeOrder(paymentMethod) {
  document.getElementById('payment-modal').style.display = 'none';
  const total = basketLines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  await db.orders.update(currentOrderId, {
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
    payment_method: paymentMethod,
    total: total
  });
  currentOrderId = null;
  basketLines = [];
  await loadActiveOrCreateOrder();
  basketMessageEl.innerHTML = '<div class="msg-box success">Order confirmed (' + (paymentMethod === 'cash' ? 'Cash' : 'PIN') + ').</div>';
  basketScan.focus();
}

document.getElementById('payment-cash-btn').addEventListener('click', function () { finalizeOrder('cash'); });
document.getElementById('payment-pin-btn').addEventListener('click', function () { finalizeOrder('pin'); });

// ===================== TODAY'S SUMMARY =====================
document.getElementById('today-summary-toggle-btn').addEventListener('click', async function () {
  const body = document.getElementById('today-summary-body');
  const isHidden = body.style.display === 'none';
  if (isHidden) {
    await refreshTodaySummary();
  }
  body.style.display = isHidden ? '' : 'none';
});

async function refreshTodaySummary() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const allOrders = await db.orders.where('status').equals('confirmed').toArray();
  const todayOrders = allOrders.filter(function (o) { return o.confirmed_at && o.confirmed_at.slice(0, 10) === todayStr; });
  const cash = todayOrders.filter(function (o) { return o.payment_method === 'cash'; }).reduce(function (s, o) { return s + o.total; }, 0);
  const pin = todayOrders.filter(function (o) { return o.payment_method === 'pin'; }).reduce(function (s, o) { return s + o.total; }, 0);
  document.getElementById('summary-cash').textContent = '€' + cash.toFixed(2);
  document.getElementById('summary-pin').textContent = '€' + pin.toFixed(2);
  document.getElementById('summary-total').textContent = '€' + (cash + pin).toFixed(2);
  document.getElementById('summary-count').textContent = todayOrders.length;
}

// ===================== SHARED: PRODUCT FORM BUILDER =====================
function supplierOptionsHtml(selected) {
  return Object.keys(supplierMap).map(function (id) {
    return '<option value="' + id + '"' + (String(id) === String(selected) ? ' selected' : '') + '>' + supplierMap[id] + '</option>';
  }).join('');
}

function taxOptionsHtml(selected) {
  return TAX_OPTIONS.map(function (t) {
    return '<option value="' + t.value + '"' + (t.value === selected ? ' selected' : '') + '>' + t.label + '</option>';
  }).join('');
}

function categoryOptionsHtml(selected) {
  return CATEGORY_OPTIONS.map(function (c) {
    return '<option value="' + c + '"' + (c === selected ? ' selected' : '') + '>' + c + '</option>';
  }).join('');
}

function priceStepperField(label, id, val, readOnly) {
  if (readOnly) {
    return field(label, id, val, true);
  }
  const displayVal = (Number(val) || 0).toFixed(2);
  return '<div class="field"><label>' + label + '</label>' +
    '<div class="price-stepper">' +
      '<button type="button" class="price-stepper-btn" data-target="' + id + '" data-dir="-1" aria-label="Decrease price">&minus;</button>' +
      '<div class="price-stepper-wrap">' +
        '<span class="price-stepper-currency">€</span>' +
        '<input type="text" inputmode="decimal" id="' + id + '" value="' + displayVal + '" />' +
      '</div>' +
      '<button type="button" class="price-stepper-btn" data-target="' + id + '" data-dir="1" aria-label="Increase price">+</button>' +
    '</div>' +
  '</div>';
}

// Renders an editable or read-only product form. Returns the container HTML string.
// prefix scopes all element IDs (e.g. 'manage-' or 'add-') so the two forms never collide
// even if both panels have rendered content in the DOM at the same time.
function buildProductFormHtml(p, readOnly, showCancel, prefix) {
  prefix = prefix || '';
  let html = '<div class="card">';
  html += '<div id="' + prefix + 'form-error"></div>';
  html +=
    field('Barcode', prefix + 'f-barcode', p.barcode, true) +
    field('SKU', prefix + 'f-sku', p.sku || '', readOnly) +
    field('Name', prefix + 'f-name', p.name || '', readOnly) +
    priceStepperField('Price (€)', prefix + 'f-price', p.price != null ? p.price : '', readOnly) +
    field('Cost price (€)', prefix + 'f-cost_price', p.cost_price != null ? p.cost_price : '', readOnly, 'number') +
    selectField('Category', prefix + 'f-category', categoryOptionsHtml(p.category), readOnly) +
    selectField('Tax group', prefix + 'f-tax_group', taxOptionsHtml(p.tax_group), readOnly) +
    selectField('Supplier', prefix + 'f-supplier_id', supplierOptionsHtml(p.supplier_id), readOnly);

  if (p.date_added || p.date_modified) {
    html += '<div class="row"><span>Date added</span><span>' + fmtDate(p.date_added) + '</span></div>';
    html += '<div class="row"><span>Date modified</span><span>' + fmtDate(p.date_modified) + '</span></div>';
  }

  if (!readOnly) {
    if (showCancel) {
      html +=
        '<div class="btn split" style="margin-top:10px;">' +
          '<button id="' + prefix + 'form-save-btn" class="btn primary">Save</button>' +
          '<button id="' + prefix + 'form-cancel-btn" class="btn">Cancel</button>' +
        '</div>';
    } else {
      html += '<button id="' + prefix + 'form-save-btn" class="btn primary" style="margin-top:10px;">Save</button>';
    }
  }
  html += '</div>';
  return html;
}

function wireCategoryAutoTax(prefix) {
  prefix = prefix || '';
  const catEl = document.getElementById(prefix + 'f-category');
  const taxEl = document.getElementById(prefix + 'f-tax_group');
  if (!catEl || !taxEl || catEl.disabled) return;
  function applyMapping() {
    if (catEl.value === 'Food') taxEl.value = 'R9';
    else if (catEl.value === 'Non food') taxEl.value = 'R21';
  }
  catEl.addEventListener('change', applyMapping);
  applyMapping();
}

function field(label, id, val, disabled, type) {
  return '<div class="field"><label>' + label + '</label>' +
    '<input id="' + id + '" type="' + (type || 'text') + '" value="' + (val === undefined ? '' : val) + '" ' + (disabled ? 'disabled' : '') + ' /></div>';
}

function selectField(label, id, optionsHtml, disabled) {
  return '<div class="field"><label>' + label + '</label>' +
    '<select id="' + id + '" ' + (disabled ? 'disabled' : '') + '>' + optionsHtml + '</select></div>';
}

function validateProduct(values) {
  if (!values.name || !values.name.trim()) {
    return 'Name is required.';
  }
  if (values.cost_price > values.price) {
    return 'Cost price cannot be higher than price.';
  }
  return null;
}

function readFormValues(barcode, prefix) {
  prefix = prefix || '';
  return {
    barcode: barcode,
    sku: document.getElementById(prefix + 'f-sku').value,
    name: document.getElementById(prefix + 'f-name').value,
    price: parseFloat(document.getElementById(prefix + 'f-price').value) || 0,
    cost_price: parseFloat(document.getElementById(prefix + 'f-cost_price').value) || 0,
    tax_group: document.getElementById(prefix + 'f-tax_group').value,
    category: document.getElementById(prefix + 'f-category').value,
    supplier_id: parseInt(document.getElementById(prefix + 'f-supplier_id').value, 10)
  };
}

// ===================== MANAGE PRODUCTS SUB-TAB =====================
const manageScan = document.getElementById('manage-scan');
const managePanel = document.getElementById('manage-panel');
const manageStatus = document.getElementById('manage-status');

manageScan.addEventListener('keydown', async function (e) {
  if (e.key !== 'Enter') return;
  const code = manageScan.value.trim();
  manageScan.value = '';
  if (!code) return;
  const product = await db.products.get(code);
  if (!product) {
    managePanel.innerHTML = '<div class="msg-box warn">Product does not exist.</div>';
    return;
  }
  renderManageForm(product, 'manage');
});

function renderManageForm(product, returnTo) {
  returnTo = returnTo || 'manage';
  const p = 'manage-';
  managePanel.innerHTML = buildProductFormHtml(product, false, true, p);
  wireCategoryAutoTax(p);

  document.getElementById(p + 'form-save-btn').addEventListener('click', async function () {
    const updated = readFormValues(product.barcode, p);
    const error = validateProduct(updated);
    if (error) {
      document.getElementById(p + 'form-error').innerHTML = '<div class="msg-box error">' + error + '</div>';
      return;
    }
    updated.date_added = product.date_added;
    updated.date_modified = new Date().toISOString();
    await db.products.put(updated);
    if (returnTo === 'list') {
      pendingListMessage = 'Product ' + updated.name + ' successfully saved.';
      managePanel.innerHTML = '';
      showSubtab('list');
    } else {
      managePanel.innerHTML = '<div class="msg-box success">Product ' + updated.name + ' successfully saved.</div>';
      manageScan.focus();
    }
  });

  document.getElementById(p + 'form-cancel-btn').addEventListener('click', function () {
    openConfirmModal('Are you sure? This will discard your changes.', 'Yes', function () {
      managePanel.innerHTML = '';
      if (returnTo === 'list') {
        showSubtab('list');
      } else {
        manageScan.focus();
      }
    });
  });
}

// ===================== ADD PRODUCT SUB-TAB =====================
const addScan = document.getElementById('add-scan');
const addPanel = document.getElementById('add-panel');
const addStatus = document.getElementById('add-status');

addScan.addEventListener('keydown', async function (e) {
  if (e.key !== 'Enter') return;
  const code = addScan.value.trim();
  addScan.value = '';
  if (!code) return;
  const product = await db.products.get(code);
  if (product) {
    addPanel.innerHTML = '<div class="msg-box warn">This product already exists. Use Manage Products to edit it.</div>' +
      buildProductFormHtml(product, true, false, 'add-');
    return;
  }
  renderAddForm(code);
});

function renderAddForm(code) {
  const blank = { barcode: code, sku: '', name: '', price: '', cost_price: '', tax_group: '', category: '', supplier_id: '' };
  const p = 'add-';
  addPanel.innerHTML = buildProductFormHtml(blank, false, true, p);
  wireCategoryAutoTax(p);

  document.getElementById(p + 'form-save-btn').addEventListener('click', async function () {
    const created = readFormValues(code, p);
    const error = validateProduct(created);
    if (error) {
      document.getElementById(p + 'form-error').innerHTML = '<div class="msg-box error">' + error + '</div>';
      return;
    }
    const now = new Date().toISOString();
    created.date_added = now;
    created.date_modified = now;
    await db.products.add(created);
    addPanel.innerHTML = '<div class="msg-box success">Product ' + created.name + ' successfully added.</div>';
    addScan.focus();
  });

  document.getElementById(p + 'form-cancel-btn').addEventListener('click', function () {
    openConfirmModal('Are you sure? This will clear what you\'ve entered.', 'Yes', function () {
      addPanel.innerHTML = '';
      addScan.focus();
    });
  });
}

// ===================== PRODUCT LIST SUB-TAB =====================
const listCount = document.getElementById('list-count');
const listEmpty = document.getElementById('list-empty');
const tableHead = document.getElementById('product-table-head');
const tableBody = document.getElementById('product-table-body');

document.getElementById('product-search').addEventListener('input', function () {
  renderProductList();
});

document.getElementById('product-sort-toggle-btn').addEventListener('click', function () {
  productSortAZ = !productSortAZ;
  this.textContent = productSortAZ ? 'A–Z ✓' : 'A–Z';
  renderProductList();
});
const exportColumnsEl = document.getElementById('export-columns');
const exportBtn = document.getElementById('export-btn');
const exportStatus = document.getElementById('export-status');

function renderExportCheckboxes() {
  exportColumnsEl.innerHTML = ALL_COLUMNS.map(function (c) {
    return '<label><input type="checkbox" class="export-col" value="' + c.key + '" checked /> ' + c.label + '</label>';
  }).join('');
}

let pendingListMessage = null;

let productSortAZ = false;

async function renderProductList() {
  await refreshSupplierMap();
  let products = await db.products.toArray();

  const searchTerm = (document.getElementById('product-search').value || '').trim().toLowerCase();
  if (searchTerm) {
    products = products.filter(function (p) { return (p.name || '').toLowerCase().indexOf(searchTerm) !== -1; });
  }
  if (productSortAZ) {
    products.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
  }

  listCount.textContent = products.length;
  listEmpty.style.display = products.length === 0 ? '' : 'none';

  const listMessageEl = document.getElementById('list-message');
  if (pendingListMessage) {
    listMessageEl.innerHTML = '<div class="msg-box success">' + pendingListMessage + '</div>';
    pendingListMessage = null;
  } else {
    listMessageEl.innerHTML = '';
  }

  tableHead.innerHTML = ALL_COLUMNS.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '<th>Actions</th>';
  tableBody.innerHTML = products.map(function (p) {
    return '<tr>' + ALL_COLUMNS.map(function (c) {
      let val = p[c.key];
      if (c.key === 'tax_group') val = taxLabel(val);
      if (c.key === 'supplier_id') val = supplierMap[val] || val;
      if (c.key === 'date_added' || c.key === 'date_modified') val = fmtDate(val);
      if (c.key === 'cost_price') val = val != null ? '€' + Number(val).toFixed(2) : '';
      if (c.key === 'price') {
        return '<td><div class="grid-price-stepper">' +
          '<button class="grid-price-btn" data-barcode="' + p.barcode + '" data-dir="-1" aria-label="Decrease price">&minus;</button>' +
          '<span class="grid-price-value">€' + Number(p.price || 0).toFixed(2) + '</span>' +
          '<button class="grid-price-btn" data-barcode="' + p.barcode + '" data-dir="1" aria-label="Increase price">+</button>' +
        '</div></td>';
      }
      return '<td>' + (val === undefined || val === null ? '' : val) + '</td>';
    }).join('') +
    '<td><button class="edit-row-btn" data-barcode="' + p.barcode + '">Edit</button>' +
    '<button class="delete-row-btn" data-barcode="' + p.barcode + '">Delete</button></td></tr>';
  }).join('');

  document.querySelectorAll('.grid-price-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const barcode = btn.getAttribute('data-barcode');
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      const product = await db.products.get(barcode);
      if (!product) return;
      const current = Number(product.price) || 0;
      const next = Math.max(0, Math.round((current + dir * 0.01) * 100) / 100);
      product.price = next;
      product.date_modified = new Date().toISOString();
      await db.products.put(product);
      renderProductList();
    });
  });

  document.querySelectorAll('.edit-row-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const barcode = btn.getAttribute('data-barcode');
      const product = await db.products.get(barcode);
      showSubtab('manage');
      renderManageForm(product, 'list');
    });
  });

  document.querySelectorAll('.delete-row-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const barcode = btn.getAttribute('data-barcode');
      const product = products.find(function (p) { return p.barcode === barcode; });
      askDeleteProduct(barcode, product ? product.name : barcode);
    });
  });
}

// ===================== GENERIC CONFIRM MODAL (used by Cancel and Delete) =====================
const confirmModal = document.getElementById('confirm-modal');
const confirmModalText = document.getElementById('confirm-modal-text');
const confirmYesBtn = document.getElementById('confirm-yes-btn');
const confirmNoBtn = document.getElementById('confirm-no-btn');
let confirmCallback = null;

function openConfirmModal(message, yesLabel, onYes) {
  confirmModalText.textContent = message;
  confirmYesBtn.textContent = yesLabel || 'Yes';
  confirmCallback = onYes;
  confirmModal.style.display = 'flex';
}
function closeConfirmModal() {
  confirmModal.style.display = 'none';
  confirmCallback = null;
}
confirmNoBtn.addEventListener('click', closeConfirmModal);
confirmYesBtn.addEventListener('click', function () {
  const cb = confirmCallback;
  closeConfirmModal();
  if (cb) cb();
});

function askDeleteProduct(barcode, name) {
  openConfirmModal('Are you sure you want to delete "' + name + '"? This cannot be undone.', 'Yes, delete', async function () {
    await db.products.delete(barcode);
    pendingListMessage = 'Product deleted.';
    renderProductList();
  });
}

exportBtn.addEventListener('click', async function () {
  const checked = Array.from(document.querySelectorAll('.export-col:checked')).map(function (cb) { return cb.value; });
  if (checked.length === 0) {
    setStatus(exportStatus, 'Select at least one column');
    return;
  }
  await refreshSupplierMap();
  const products = await db.products.toArray();
  const columns = ALL_COLUMNS.filter(function (c) { return checked.indexOf(c.key) !== -1; });

  const header = columns.map(function (c) { return c.label; }).join(',');
  const rows = products.map(function (p) {
    return columns.map(function (c) {
      let val = p[c.key];
      if (c.key === 'tax_group') val = p.tax_group;
      if (c.key === 'supplier_id') val = supplierMap[p.supplier_id] || p.supplier_id;
      if (val === undefined || val === null) val = '';
      const str = String(val).replace(/"/g, '""');
      return /[",\n]/.test(str) ? '"' + str + '"' : str;
    }).join(',');
  });
  const csv = [header].concat(rows).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'product-catalog-export-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus(exportStatus, 'Exported ' + products.length + ' products');
});

renderExportCheckboxes();

// ===================== IMPORT (restore/migrate a catalog CSV) =====================
const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');
const importMessageEl = document.getElementById('import-message');

importBtn.addEventListener('click', function () {
  importFile.click();
});

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // ignore, handled by \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
}

function mapTaxImportValue(raw) {
  const t = String(raw || '').trim();
  if (t === '21%' || t === 'R21') return 'R21';
  if (t === '9%' || t === 'R9') return 'R9';
  return t;
}

function resolveSupplierIdOnImport(raw, nameToId) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (nameToId[t] !== undefined) return nameToId[t];
  const asNum = parseInt(t, 10);
  return isNaN(asNum) ? '' : asNum;
}

function parseImportDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

importFile.addEventListener('change', async function () {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) {
      importMessageEl.innerHTML = '<div class="msg-box warn">The file appears to be empty.</div>';
      return;
    }

    const header = rows[0].map(function (h) { return h.trim(); });
    const colIdx = {};
    ALL_COLUMNS.forEach(function (c) { colIdx[c.key] = header.indexOf(c.label); });

    if (colIdx.barcode === -1) {
      importMessageEl.innerHTML = '<div class="msg-box warn">Could not find a "Barcode" column in this file.</div>';
      return;
    }

    await refreshSupplierMap();
    const nameToId = {};
    Object.keys(supplierMap).forEach(function (id) { nameToId[supplierMap[id]] = parseInt(id, 10); });

    let added = 0, updated = 0, skipped = 0;
    const now = new Date().toISOString();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const barcode = (r[colIdx.barcode] || '').trim();
      if (!barcode) { skipped++; continue; }

      const existing = await db.products.get(barcode);
      const get = function (key, fallback) {
        return colIdx[key] !== -1 && r[colIdx[key]] !== undefined ? r[colIdx[key]] : fallback;
      };

      const product = {
        barcode: barcode,
        sku: get('sku', existing ? existing.sku : ''),
        name: get('name', existing ? existing.name : ''),
        price: parseFloat(String(get('price', existing ? existing.price : 0)).replace('€', '')) || 0,
        cost_price: parseFloat(String(get('cost_price', existing ? existing.cost_price : 0)).replace('€', '')) || 0,
        category: get('category', existing ? existing.category : ''),
        tax_group: colIdx.tax_group !== -1 ? mapTaxImportValue(r[colIdx.tax_group]) : (existing ? existing.tax_group : ''),
        supplier_id: colIdx.supplier_id !== -1 ? resolveSupplierIdOnImport(r[colIdx.supplier_id], nameToId) : (existing ? existing.supplier_id : ''),
        date_added: (colIdx.date_added !== -1 ? parseImportDate(r[colIdx.date_added]) : null) || (existing ? existing.date_added : now),
        date_modified: now
      };

      await db.products.put(product);
      if (existing) updated++; else added++;
    }

    let msg = 'Import complete: ' + added + ' added, ' + updated + ' updated.';
    if (skipped > 0) msg += ' ' + skipped + ' row(s) skipped (missing barcode).';
    importMessageEl.innerHTML = '<div class="msg-box success">' + msg + '</div>';
    renderProductList();
  } catch (err) {
    importMessageEl.innerHTML = '<div class="msg-box error">Import failed: ' + (err.message || err) + '</div>';
  }
});

// ===================== INVOICE: SETTINGS =====================
const SETTINGS_ID = 'main';

const DEFAULT_SETTINGS_VALUES = {
  business_name: 'Mama Merienda',
  legal_name: 'Deity Pinoy Luxury',
  address_line1: 'Admiraliteitslaan 228',
  address_line2: "'s-Hertogenbosch, 5224 EJ",
  kvk: '90556682',
  vat_number: 'NL004825060B75',
  iban: 'NL95 RABO 0360 6296 01',
  bic: 'RABONL2U'
};

async function getSettings() {
  let s = await db.settings.get(SETTINGS_ID);
  if (!s) {
    s = { id: SETTINGS_ID, business_name: '', legal_name: '', address_line1: '', address_line2: '', kvk: '', vat_number: '', iban: '', bic: '', logo: '', counters: {} };
  }
  if (!s.counters) s.counters = {};
  Object.keys(DEFAULT_SETTINGS_VALUES).forEach(function (key) {
    if (!s[key]) s[key] = DEFAULT_SETTINGS_VALUES[key];
  });
  await db.settings.put(s);
  return s;
}

function formatInvoiceNumber(yearMonth, seq) {
  return yearMonth + '-' + String(seq).padStart(4, '0');
}

function getYearMonth(dateStr) {
  return dateStr.slice(0, 7).replace('-', '');
}

async function loadSettingsIntoForm() {
  const s = await getSettings();
  document.getElementById('settings-business-name').value = s.business_name || '';
  document.getElementById('settings-legal-name').value = s.legal_name || '';
  document.getElementById('settings-address-line1').value = s.address_line1 || '';
  document.getElementById('settings-address-line2').value = s.address_line2 || '';
  document.getElementById('settings-kvk').value = s.kvk || '';
  document.getElementById('settings-vat-number').value = s.vat_number || '';
  document.getElementById('settings-iban').value = s.iban || '';
  document.getElementById('settings-bic').value = s.bic || '';
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentYear = todayStr.slice(0, 4);
  const nextSeq = (s.counters[currentYear] || 0) + 1;
  document.getElementById('settings-next-number').textContent = formatInvoiceNumber(getYearMonth(todayStr), nextSeq);
  const preview = document.getElementById('settings-logo-preview');
  preview.innerHTML = s.logo ? '<img src="' + s.logo + '" style="max-height:60px; margin-top:8px;" />' : '';
}

document.getElementById('settings-logo').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    const img = new Image();
    img.onload = function () {
      const maxWidth = 400;
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const resized = canvas.toDataURL('image/png');
      document.getElementById('settings-logo-preview').innerHTML =
        '<img src="' + resized + '" style="max-height:60px; margin-top:8px;" />';
      document.getElementById('settings-logo-preview').dataset.pendingLogo = resized;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById('settings-save-btn').addEventListener('click', async function () {
  try {
    const s = await getSettings();
    s.business_name = document.getElementById('settings-business-name').value.trim();
    s.legal_name = document.getElementById('settings-legal-name').value.trim();
    s.address_line1 = document.getElementById('settings-address-line1').value.trim();
    s.address_line2 = document.getElementById('settings-address-line2').value.trim();
    s.kvk = document.getElementById('settings-kvk').value.trim();
    s.vat_number = document.getElementById('settings-vat-number').value.trim();
    s.iban = document.getElementById('settings-iban').value.trim();
    s.bic = document.getElementById('settings-bic').value.trim();
    const pendingLogo = document.getElementById('settings-logo-preview').dataset.pendingLogo;
    if (pendingLogo) s.logo = pendingLogo;
    await db.settings.put(s);
    document.getElementById('settings-message').innerHTML = '<div class="msg-box success">Settings saved.</div>';
    refreshInvoiceNumberPreview();
  } catch (err) {
    document.getElementById('settings-message').innerHTML = '<div class="msg-box error">Save failed: ' + (err.message || err) + '</div>';
  }
});

document.getElementById('settings-backup-btn').addEventListener('click', async function () {
  try {
    const s = await getSettings();
    const backupCopy = Object.assign({}, s);
    delete backupCopy.logo; // skip the large image data, keep the backup small and readable
    const content = JSON.stringify(backupCopy, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'settings-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    document.getElementById('settings-message').innerHTML = '<div class="msg-box error">Backup failed: ' + (err.message || err) + '</div>';
  }
});

// ===================== INVOICE: NEW INVOICE =====================
let invoiceLines = []; // { barcode(optional), description, qty, price, tax_group }
const invoiceDateEl = document.getElementById('invoice-date');
const invoiceScan = document.getElementById('invoice-scan');
const invoiceLinesEl = document.getElementById('invoice-lines');
const invoiceEmptyEl = document.getElementById('invoice-empty');
const invoiceCountEl = document.getElementById('invoice-count');
const invoiceSub21El = document.getElementById('invoice-sub21');
const invoiceSub9El = document.getElementById('invoice-sub9');
const invoiceTotalEl = document.getElementById('invoice-total');
const invoiceMessageEl = document.getElementById('invoice-message');

invoiceDateEl.value = new Date().toISOString().slice(0, 10);
invoiceDateEl.addEventListener('input', refreshInvoiceNumberPreview);

async function refreshInvoiceNumberPreview() {
  const s = await getSettings();
  const dateStr = invoiceDateEl.value || new Date().toISOString().slice(0, 10);
  const year = dateStr.slice(0, 4);
  const nextSeq = (s.counters[year] || 0) + 1;
  document.getElementById('invoice-number-preview').textContent =
    formatInvoiceNumber(getYearMonth(dateStr), nextSeq) + ' (assigned on approval)';
}

function updateInvoiceSummary() {
  const sub21 = invoiceLines.filter(function (l) { return l.tax_group === 'R21'; }).reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const sub9 = invoiceLines.filter(function (l) { return l.tax_group === 'R9'; }).reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const lineCount = invoiceLines.length;
  invoiceSub21El.textContent = '€' + sub21.toFixed(2);
  invoiceSub9El.textContent = '€' + sub9.toFixed(2);
  invoiceTotalEl.textContent = '€' + (sub21 + sub9).toFixed(2);
  invoiceCountEl.textContent = lineCount + (lineCount === 1 ? ' line' : ' lines');
}

function updateInvoiceLineTotalsOnly() {
  const totalEls = invoiceLinesEl.querySelectorAll('.invoice-line-total');
  invoiceLines.forEach(function (line, idx) {
    if (totalEls[idx]) totalEls[idx].textContent = '€' + (line.price * line.qty).toFixed(2);
  });
  updateInvoiceSummary();
}

function renderInvoiceLines() {
  invoiceLinesEl.innerHTML = '';
  invoiceEmptyEl.style.display = invoiceLines.length === 0 ? '' : 'none';

  invoiceLines.forEach(function (line, idx) {
    const div = document.createElement('div');
    div.className = 'invoice-line-card';
    const lineTotal = (line.price * line.qty).toFixed(2);
    const taxClass = line.tax_group === 'R21' ? 'r21' : 'r9';
    div.innerHTML =
      '<div class="invoice-line-name">' + line.description + '</div>' +
      '<div class="invoice-line-price-stepper">' +
        '<button class="invoice-line-price-btn" data-idx="' + idx + '" data-dir="-1" aria-label="Decrease price">&minus;</button>' +
        '<div class="invoice-line-price-wrap">' +
          '<span class="invoice-line-currency">€</span>' +
          '<input type="text" inputmode="decimal" class="invoice-line-price-input" data-idx="' + idx + '" value="' + line.price.toFixed(2) + '" />' +
        '</div>' +
        '<button class="invoice-line-price-btn" data-idx="' + idx + '" data-dir="1" aria-label="Increase price">+</button>' +
      '</div>' +
      '<div class="invoice-line-qty-stepper">' +
        '<button class="invoice-line-qty-btn" data-idx="' + idx + '" data-dir="-1" aria-label="Decrease quantity">&minus;</button>' +
        '<span class="invoice-line-qty-value">' + line.qty + '</span>' +
        '<button class="invoice-line-qty-btn" data-idx="' + idx + '" data-dir="1" aria-label="Increase quantity">+</button>' +
      '</div>' +
      '<span class="tax-badge ' + taxClass + '">' + taxLabel(line.tax_group) + '</span>' +
      '<div class="invoice-line-total">€' + lineTotal + '</div>' +
      '<button class="invoice-line-remove-btn" data-idx="' + idx + '" aria-label="Remove line">&times;</button>';
    invoiceLinesEl.appendChild(div);
  });

  invoiceLinesEl.querySelectorAll('.invoice-line-price-input').forEach(function (input) {
    input.addEventListener('input', function () {
      const idx = parseInt(input.getAttribute('data-idx'), 10);
      const val = parseFloat(input.value.replace(',', '.'));
      invoiceLines[idx].price = isNaN(val) ? 0 : val;
      updateInvoiceLineTotalsOnly();
    });
  });

  invoiceLinesEl.querySelectorAll('.invoice-line-price-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      const current = invoiceLines[idx].price;
      const next = Math.max(0, Math.round((current + dir * 0.05) * 100) / 100);
      invoiceLines[idx].price = next;
      renderInvoiceLines();
    });
  });

  invoiceLinesEl.querySelectorAll('.invoice-line-qty-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      invoiceLines[idx].qty = Math.max(1, invoiceLines[idx].qty + dir);
      renderInvoiceLines();
    });
  });

  invoiceLinesEl.querySelectorAll('.invoice-line-remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const line = invoiceLines[idx];
      openConfirmModal('Are you sure you want to remove "' + (line ? line.description : 'this line') + '" from the invoice?', 'Yes, remove', function () {
        invoiceLines.splice(idx, 1);
        renderInvoiceLines();
      });
    });
  });

  updateInvoiceSummary();
}

invoiceScan.addEventListener('keydown', async function (e) {
  if (e.key !== 'Enter') return;
  const code = invoiceScan.value.trim();
  invoiceScan.value = '';
  if (!code) return;
  const product = await db.products.get(code);
  if (!product) {
    invoiceMessageEl.innerHTML = '<div class="msg-box warn">Product does not exist. Use a manual line instead, or add it in Products first.</div>';
    return;
  }
  invoiceMessageEl.innerHTML = '';
  const existing = invoiceLines.find(function (l) { return l.barcode === code; });
  if (existing) {
    existing.qty += 1;
  } else {
    invoiceLines.push({ barcode: code, description: product.name, price: product.price, tax_group: product.tax_group, qty: 1 });
  }
  renderInvoiceLines();
});

document.getElementById('manual-toggle-btn').addEventListener('click', function () {
  const fields = document.getElementById('manual-fields');
  fields.style.display = fields.style.display === 'none' ? '' : 'none';
});

document.getElementById('manual-add-btn').addEventListener('click', function () {
  const desc = document.getElementById('manual-desc').value.trim();
  const qty = parseInt(document.getElementById('manual-qty').value, 10) || 1;
  const price = parseFloat(document.getElementById('manual-price').value) || 0;
  const tax = document.getElementById('manual-tax').value;
  if (!desc) {
    invoiceMessageEl.innerHTML = '<div class="msg-box error">Description is required for a manual line.</div>';
    return;
  }
  invoiceMessageEl.innerHTML = '';
  invoiceLines.push({ barcode: null, description: desc, price: price, tax_group: tax, qty: qty });
  document.getElementById('manual-desc').value = '';
  document.getElementById('manual-qty').value = '1';
  document.getElementById('manual-price').value = '';
  renderInvoiceLines();
});

// ===================== INVOICE: PDF GENERATION =====================
function taxRateFraction(taxGroup) {
  return taxGroup === 'R21' ? 0.21 : 0.09;
}

function buildInvoiceDocContent(doc, invoiceRecord, items, settings) {
  const BLUE = [30, 80, 160];
  let y = 20;

  if (settings.logo) {
    try { doc.addImage(settings.logo, 140, 10, 50, 35); } catch (e) { /* ignore bad image data */ }
  }

  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text(settings.business_name || '', 20, y); y += 6;
  doc.setFont(undefined, 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text(settings.address_line1 || '', 20, y); y += 6;
  if (settings.address_line2) { doc.text(settings.address_line2, 20, y); y += 6; }

  y += 16;
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(20);
  doc.text('FACTUUR', 105, y, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(11);
  y += 20;

  doc.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.setLineWidth(0.6);
  doc.line(20, y, 190, y);
  y += 10;

  const blockStartY = y;
  let leftY = blockStartY;
  if (invoiceRecord.buyer_name || invoiceRecord.buyer_address_line1 || invoiceRecord.buyer_address_line2) {
    doc.setFont(undefined, 'normal');
    if (invoiceRecord.buyer_name) { doc.text(invoiceRecord.buyer_name, 20, leftY); leftY += 6; }
    if (invoiceRecord.buyer_address_line1) { doc.text(invoiceRecord.buyer_address_line1, 20, leftY); leftY += 6; }
    if (invoiceRecord.buyer_address_line2) { doc.text(invoiceRecord.buyer_address_line2, 20, leftY); leftY += 6; }
  }

  let rightY = blockStartY;
  doc.text('Factuurnummer:', 130, rightY);
  doc.text(invoiceRecord.invoice_number || '(concept)', 165, rightY);
  rightY += 6;
  doc.text('Datum:', 130, rightY);
  doc.text(invoiceRecord.invoice_date, 165, rightY);
  rightY += 6;

  y = Math.max(leftY, rightY) + 10;

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text('Product', 20, y);
  doc.text('Prijs p/s', 110, y);
  doc.text('Aantal', 145, y);
  doc.text('Totaal', 172, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  y += 4;
  doc.line(20, y, 190, y);
  y += 6;

  items.forEach(function (item) {
    const lineTotal = item.price * item.qty;
    doc.text(String(item.description), 20, y, { maxWidth: 85 });
    doc.text('€ ' + item.price.toFixed(2), 110, y);
    doc.text(String(item.qty), 145, y);
    doc.text('€ ' + lineTotal.toFixed(2), 172, y);
    y += 8;
  });

  y += 4;
  doc.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.line(100, y, 190, y);
  y += 8;

  const rates = [];
  if (invoiceRecord.sub21 > 0) rates.push('R21');
  if (invoiceRecord.sub9 > 0) rates.push('R9');

  let exclTotal = 0;
  const vatByRate = {};
  rates.forEach(function (rate) {
    const amount = rate === 'R21' ? invoiceRecord.sub21 : invoiceRecord.sub9;
    const frac = taxRateFraction(rate);
    const excl = amount / (1 + frac);
    exclTotal += excl;
    vatByRate[rate] = amount - excl;
  });

  doc.setFontSize(10);
  doc.text('Subtotaal (excl. BTW)', 100, y);
  doc.text('€ ' + exclTotal.toFixed(2), 172, y);
  y += 7;

  rates.forEach(function (rate) {
    const label = rate === 'R21' ? 'BTW hoog 21%' : 'BTW laag 9%';
    doc.text(label, 100, y);
    doc.text('€ ' + vatByRate[rate].toFixed(2), 172, y);
    y += 7;
  });

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text('Totaal (incl. BTW)', 100, y);
  doc.text('€ ' + invoiceRecord.total.toFixed(2), 172, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  y += 14;

  const FOOTER_BG = [234, 241, 251];
  const FOOTER_BORDER = [201, 220, 240];
  const FOOTER_LABEL = [30, 80, 160];
  const FOOTER_TEXT = [26, 26, 26];

  const footerLines = [];
  if (settings.legal_name) footerLines.push({ type: 'plain', text: settings.legal_name });
  const line1Segments = [];
  if (settings.kvk) { line1Segments.push({ text: 'KVK ', color: FOOTER_LABEL, bold: true }); line1Segments.push({ text: settings.kvk + '   ', color: FOOTER_TEXT }); }
  if (settings.vat_number) { line1Segments.push({ text: 'BTW ', color: FOOTER_LABEL, bold: true }); line1Segments.push({ text: settings.vat_number, color: FOOTER_TEXT }); }
  if (line1Segments.length) footerLines.push({ type: 'segments', segments: line1Segments });
  const line2Segments = [];
  if (settings.iban) { line2Segments.push({ text: 'IBAN ', color: FOOTER_LABEL, bold: true }); line2Segments.push({ text: settings.iban + '   ', color: FOOTER_TEXT }); }
  if (settings.bic) { line2Segments.push({ text: 'BIC ', color: FOOTER_LABEL, bold: true }); line2Segments.push({ text: settings.bic, color: FOOTER_TEXT }); }
  if (line2Segments.length) footerLines.push({ type: 'segments', segments: line2Segments });

  const padTop = 6, padBottom = 6, lineHeight = 6;
  const barHeight = padTop + padBottom + Math.max(1, footerLines.length) * lineHeight;

  const PAGE_BOTTOM_MARGIN = 20;
  const pageHeight = doc.internal.pageSize.getHeight();
  const minFooterY = pageHeight - PAGE_BOTTOM_MARGIN - barHeight;
  const footerY = Math.max(y, minFooterY);

  doc.setDrawColor(FOOTER_BORDER[0], FOOTER_BORDER[1], FOOTER_BORDER[2]);
  doc.setFillColor(FOOTER_BG[0], FOOTER_BG[1], FOOTER_BG[2]);
  doc.roundedRect(20, footerY, 170, barHeight, 2, 2, 'FD');

  doc.setFontSize(9);
  let fy = footerY + padTop + 4;
  footerLines.forEach(function (line) {
    if (line.type === 'plain') {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
      doc.text(line.text, 26, fy);
      doc.setFont(undefined, 'normal');
    } else {
      let fx = 26;
      line.segments.forEach(function (seg) {
        doc.setFont(undefined, seg.bold ? 'bold' : 'normal');
        doc.setTextColor(seg.color[0], seg.color[1], seg.color[2]);
        doc.text(seg.text, fx, fy);
        fx += doc.getTextWidth(seg.text);
      });
      doc.setFont(undefined, 'normal');
    }
    fy += lineHeight;
  });
  doc.setTextColor(0, 0, 0);
}

function generateInvoicePDF(invoiceRecord, items, settings) {
  const doc = new window.jspdf.jsPDF();
  buildInvoiceDocContent(doc, invoiceRecord, items, settings);
  const filenamePart = invoiceRecord.invoice_number || ('concept-' + invoiceRecord.id);
  doc.save('factuur-' + filenamePart + '.pdf');
}

document.getElementById('invoice-generate-btn').addEventListener('click', async function () {
  if (invoiceLines.length === 0) {
    invoiceMessageEl.innerHTML = '<div class="msg-box error">Add at least one line before saving.</div>';
    return;
  }
  const sub21 = invoiceLines.filter(function (l) { return l.tax_group === 'R21'; }).reduce(function (t, l) { return t + l.price * l.qty; }, 0);
  const sub9 = invoiceLines.filter(function (l) { return l.tax_group === 'R9'; }).reduce(function (t, l) { return t + l.price * l.qty; }, 0);

  const invoiceId = await db.invoices.add({
    invoice_number: null,
    status: 'pending',
    invoice_date: invoiceDateEl.value,
    buyer_name: document.getElementById('invoice-buyer-name').value.trim(),
    buyer_address_line1: document.getElementById('invoice-buyer-address1').value.trim(),
    buyer_address_line2: document.getElementById('invoice-buyer-address2').value.trim(),
    total: sub21 + sub9,
    sub21: sub21,
    sub9: sub9,
    created_at: new Date().toISOString()
  });
  const itemsSnapshot = invoiceLines.slice();
  for (const line of itemsSnapshot) {
    await db.invoice_items.add({
      invoice_id: invoiceId,
      barcode: line.barcode,
      description: line.description,
      qty: line.qty,
      price: line.price,
      tax_group: line.tax_group
    });
  }

  invoiceMessageEl.innerHTML = '<div class="msg-box success">Saved as pending — review and approve it in History to assign the official invoice number.</div>';
  invoiceLines = [];
  renderInvoiceLines();
  invoiceDateEl.value = new Date().toISOString().slice(0, 10);
  document.getElementById('invoice-buyer-name').value = '';
  document.getElementById('invoice-buyer-address1').value = '';
  document.getElementById('invoice-buyer-address2').value = '';
  refreshInvoiceNumberPreview();
});

// ===================== INVOICE: HISTORY =====================
async function approveInvoice(id) {
  const inv = await db.invoices.get(id);
  if (!inv || inv.status === 'approved') return;
  const s = await getSettings();
  const year = inv.invoice_date.slice(0, 4);
  const seq = (s.counters[year] || 0) + 1;
  const invoiceNumber = formatInvoiceNumber(getYearMonth(inv.invoice_date), seq);

  inv.invoice_number = invoiceNumber;
  inv.status = 'approved';
  await db.invoices.put(inv);

  s.counters[year] = seq;
  await db.settings.put(s);

  renderInvoiceHistory();
}

function csvFromRows(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map(function (r) {
    return columns.map(function (c) {
      let val = r[c];
      if (val === undefined || val === null) val = '';
      const str = String(val).replace(/"/g, '""');
      return /[",\n]/.test(str) ? '"' + str + '"' : str;
    }).join(',');
  });
  return [header].concat(lines).join('\n');
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('invoice-backup-btn').addEventListener('click', async function () {
  const invoices = await db.invoices.toArray();
  const items = await db.invoice_items.toArray();
  const invoiceCols = ['id', 'invoice_number', 'status', 'invoice_date', 'buyer_name', 'buyer_address_line1', 'buyer_address_line2', 'total', 'sub21', 'sub9', 'created_at'];
  const itemCols = ['id', 'invoice_id', 'barcode', 'description', 'qty', 'price', 'tax_group'];
  const dateStamp = new Date().toISOString().slice(0, 10);
  const combined =
    '## INVOICES\n' + csvFromRows(invoices, invoiceCols) +
    '\n\n## INVOICE_ITEMS\n' + csvFromRows(items, itemCols);
  downloadTextFile('invoice-backup-' + dateStamp + '.csv', combined);
});

// ===================== INVOICE: RESTORE FROM BACKUP =====================
let selectedBackupFile = null;

document.getElementById('select-backup-file-btn').addEventListener('click', function () {
  document.getElementById('import-backup-file').click();
});
document.getElementById('import-backup-file').addEventListener('change', function (e) {
  selectedBackupFile = e.target.files[0] || null;
  document.getElementById('backup-file-name').textContent = selectedBackupFile ? selectedBackupFile.name : 'No file selected';
});

document.getElementById('invoice-restore-btn').addEventListener('click', async function () {
  const msgEl = document.getElementById('invoice-restore-message');
  try {
    if (!selectedBackupFile) {
      msgEl.innerHTML = '<div class="msg-box error">Select a backup file before restoring.</div>';
      return;
    }

    const fullText = await selectedBackupFile.text();
    const invoicesMarker = '## INVOICES';
    const itemsMarker = '## INVOICE_ITEMS';
    const invoicesIdx = fullText.indexOf(invoicesMarker);
    const itemsIdx = fullText.indexOf(itemsMarker);
    if (invoicesIdx === -1 || itemsIdx === -1) {
      msgEl.innerHTML = '<div class="msg-box error">This doesn\'t look like a valid invoice backup file.</div>';
      return;
    }
    const invoicesText = fullText.slice(invoicesIdx + invoicesMarker.length, itemsIdx).trim();
    const itemsText = fullText.slice(itemsIdx + itemsMarker.length).trim();

    const invoiceRows = parseCSV(invoicesText);
    const itemRows = parseCSV(itemsText);
    if (invoiceRows.length === 0 || itemRows.length === 0) {
      msgEl.innerHTML = '<div class="msg-box warn">The backup file appears to contain no invoices.</div>';
      return;
    }

    const invHeader = invoiceRows[0];
    const invIdx = {};
    ['id', 'invoice_number', 'status', 'invoice_date', 'buyer_name', 'buyer_address_line1', 'buyer_address_line2', 'total', 'sub21', 'sub9', 'created_at'].forEach(function (c) {
      invIdx[c] = invHeader.indexOf(c);
    });
    if (invIdx.id === -1) {
      msgEl.innerHTML = '<div class="msg-box error">Invoices file is missing an "id" column — is this the right file?</div>';
      return;
    }

    const itemHeader = itemRows[0];
    const itemIdx = {};
    ['id', 'invoice_id', 'barcode', 'description', 'qty', 'price', 'tax_group'].forEach(function (c) {
      itemIdx[c] = itemHeader.indexOf(c);
    });
    if (itemIdx.invoice_id === -1) {
      msgEl.innerHTML = '<div class="msg-box error">Items file is missing an "invoice_id" column — is this the right file?</div>';
      return;
    }

    let invoicesRestored = 0;
    for (let i = 1; i < invoiceRows.length; i++) {
      const r = invoiceRows[i];
      const idVal = parseInt(r[invIdx.id], 10);
      if (isNaN(idVal)) continue;
      await db.invoices.put({
        id: idVal,
        invoice_number: invIdx.invoice_number !== -1 ? (r[invIdx.invoice_number] || null) : null,
        status: invIdx.status !== -1 ? (r[invIdx.status] || 'pending') : 'pending',
        invoice_date: invIdx.invoice_date !== -1 ? r[invIdx.invoice_date] : '',
        buyer_name: invIdx.buyer_name !== -1 ? r[invIdx.buyer_name] : '',
        buyer_address_line1: invIdx.buyer_address_line1 !== -1 ? r[invIdx.buyer_address_line1] : '',
        buyer_address_line2: invIdx.buyer_address_line2 !== -1 ? r[invIdx.buyer_address_line2] : '',
        total: parseFloat(r[invIdx.total]) || 0,
        sub21: parseFloat(r[invIdx.sub21]) || 0,
        sub9: parseFloat(r[invIdx.sub9]) || 0,
        created_at: invIdx.created_at !== -1 ? r[invIdx.created_at] : new Date().toISOString()
      });
      invoicesRestored++;
    }

    let itemsRestored = 0;
    for (let i = 1; i < itemRows.length; i++) {
      const r = itemRows[i];
      const invoiceIdVal = parseInt(r[itemIdx.invoice_id], 10);
      if (isNaN(invoiceIdVal)) continue;
      const record = {
        invoice_id: invoiceIdVal,
        barcode: itemIdx.barcode !== -1 ? (r[itemIdx.barcode] || null) : null,
        description: itemIdx.description !== -1 ? r[itemIdx.description] : '',
        qty: parseInt(r[itemIdx.qty], 10) || 1,
        price: parseFloat(r[itemIdx.price]) || 0,
        tax_group: itemIdx.tax_group !== -1 ? r[itemIdx.tax_group] : ''
      };
      if (itemIdx.id !== -1) {
        const idVal = parseInt(r[itemIdx.id], 10);
        if (!isNaN(idVal)) record.id = idVal;
      }
      await db.invoice_items.put(record);
      itemsRestored++;
    }

    // Reconcile year counters so future approvals never collide with a restored number
    const s = await getSettings();
    const allInvoices = await db.invoices.toArray();
    allInvoices.forEach(function (inv) {
      if (inv.invoice_number) {
        const parts = inv.invoice_number.split('-');
        if (parts.length === 2) {
          const yr = parts[0].slice(0, 4);
          const seq = parseInt(parts[1], 10);
          if (!isNaN(seq)) {
            s.counters[yr] = Math.max(s.counters[yr] || 0, seq);
          }
        }
      }
    });
    await db.settings.put(s);

    msgEl.innerHTML = '<div class="msg-box success">Restored ' + invoicesRestored + ' invoice(s) and ' + itemsRestored + ' line item(s).</div>';
    renderInvoiceHistory();
    refreshInvoiceNumberPreview();
  } catch (err) {
    msgEl.innerHTML = '<div class="msg-box error">Restore failed: ' + (err.message || err) + '</div>';
  }
});

async function renderInvoiceHistory() {
  const invoices = await db.invoices.orderBy('id').reverse().toArray();
  document.getElementById('invoice-history-count').textContent = invoices.length;
  document.getElementById('invoice-history-empty').style.display = invoices.length === 0 ? '' : 'none';
  document.getElementById('invoice-history-body').innerHTML = invoices.map(function (inv) {
    const badge = inv.status === 'approved'
      ? '<span class="status-badge approved">Approved</span>'
      : '<span class="status-badge pending">Pending review</span>';
    const numberDisplay = inv.invoice_number || '—';

    let actions = '<button class="edit-row-btn" data-id="' + inv.id + '" data-action="download">Download</button>';
    if (inv.status !== 'approved') {
      actions =
        '<button class="edit-row-btn" data-id="' + inv.id + '" data-action="approve">Approve</button> ' +
        '<button class="delete-row-btn" data-id="' + inv.id + '" data-action="delete">Delete</button> ' +
        actions;
    }

    return '<tr><td>' + numberDisplay + '</td><td>' + inv.invoice_date + '</td><td>' + fmtDate(inv.created_at) + '</td><td>€' + inv.total.toFixed(2) + '</td>' +
      '<td>' + badge + '</td><td>' + actions + '</td></tr>';
  }).join('');

  document.querySelectorAll('#invoice-history-body button').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const action = btn.getAttribute('data-action');

      if (action === 'download') {
        const invoiceRecord = await db.invoices.get(id);
        const items = await db.invoice_items.where('invoice_id').equals(id).toArray();
        const settings = await getSettings();
        generateInvoicePDF(invoiceRecord, items, settings);
      } else if (action === 'approve') {
        openConfirmModal('Are you sure you want to approve this invoice? This will assign the official invoice number and cannot be undone.', 'Yes, approve', async function () {
          await approveInvoice(id);
        });
      } else if (action === 'delete') {
        openConfirmModal('Are you sure you want to delete this pending invoice? This cannot be undone.', 'Yes, delete', async function () {
          await db.invoice_items.where('invoice_id').equals(id).delete();
          await db.invoices.delete(id);
          renderInvoiceHistory();
        });
      }
    });
  });
}

// ===================== GLOBAL PRICE STEPPER (Add/Manage Product forms) =====================
document.addEventListener('click', function (e) {
  const btn = e.target.closest('.price-stepper-btn');
  if (!btn) return;
  const targetId = btn.getAttribute('data-target');
  const input = document.getElementById(targetId);
  if (!input) return;
  const dir = parseInt(btn.getAttribute('data-dir'), 10);
  const current = parseFloat(String(input.value).replace(',', '.')) || 0;
  const next = Math.max(0, Math.round((current + dir * 0.01) * 100) / 100);
  input.value = next.toFixed(2);
});

// ===================== ORDER HISTORY =====================
let expandedDates = new Set();
let expandedOrderId = null;
let orderEditWorkingCopy = null;
let removedItemIds = [];
let orderEditPaymentMethod = null;
let pendingHistoryMessage = null;

function formatDateLong(dateKey) {
  if (!dateKey) return 'Unknown date';
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: undefined, year: 'numeric', month: 'long', day: 'numeric' });
}

function renderOrderDetailHtml(orderId, items) {
  let html = '<div class="card" style="margin-top:8px; background:var(--surface-tint);">';
  html +=
    '<div style="margin-bottom:8px;">' +
      '<input type="text" class="history-add-scan prominent-input" data-order="' + orderId + '" placeholder="Scan or type a barcode to add a missed item" />' +
    '</div>' +
    '<button type="button" class="btn btn-sm history-search-toggle-btn" data-order="' + orderId + '" style="width:auto; padding:0 14px;">Search by name</button>' +
    '<div class="history-search-body" data-order="' + orderId + '" style="display:none; margin-top:8px;">' +
      '<input type="text" class="history-search-input prominent-input" data-order="' + orderId + '" placeholder="Type a product name..." />' +
      '<div class="history-search-results" data-order="' + orderId + '" style="margin-top:8px;"></div>' +
    '</div>' +
    '<div id="history-add-message-' + orderId + '" style="margin-top:8px;"></div>';
  items.forEach(function (item, idx) {
    const lineTotal = (item.price * item.qty).toFixed(2);
    html +=
      '<div class="invoice-line-card">' +
        '<div class="invoice-line-name">' + (idx + 1) + '. ' + item.name + '</div>' +
        '<div class="invoice-line-price-stepper">' +
          '<button class="history-item-price-btn" data-order="' + orderId + '" data-idx="' + idx + '" data-dir="-1" aria-label="Decrease price">&minus;</button>' +
          '<div class="invoice-line-price-wrap">' +
            '<span class="invoice-line-currency">€</span>' +
            '<input type="text" inputmode="decimal" class="invoice-line-price-input history-item-price-input" data-order="' + orderId + '" data-idx="' + idx + '" value="' + item.price.toFixed(2) + '" />' +
          '</div>' +
          '<button class="history-item-price-btn" data-order="' + orderId + '" data-idx="' + idx + '" data-dir="1" aria-label="Increase price">+</button>' +
        '</div>' +
        '<div class="invoice-line-qty-stepper">' +
          '<button class="history-item-qty-btn" data-order="' + orderId + '" data-idx="' + idx + '" data-dir="-1" aria-label="Decrease quantity">&minus;</button>' +
          '<span class="invoice-line-qty-value">' + item.qty + '</span>' +
          '<button class="history-item-qty-btn" data-order="' + orderId + '" data-idx="' + idx + '" data-dir="1" aria-label="Increase quantity">+</button>' +
        '</div>' +
        '<select class="history-item-tax-select" data-order="' + orderId + '" data-idx="' + idx + '">' +
          '<option value="R21"' + (item.tax_group === 'R21' ? ' selected' : '') + '>21%</option>' +
          '<option value="R9"' + (item.tax_group === 'R9' ? ' selected' : '') + '>9%</option>' +
        '</select>' +
        '<div class="invoice-line-total">€' + lineTotal + '</div>' +
        '<button class="invoice-line-remove-btn history-item-remove-btn" data-order="' + orderId + '" data-idx="' + idx + '" aria-label="Remove line">&times;</button>' +
      '</div>';
  });
  const total = items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
  html +=
    '<div class="row" style="align-items:center; padding:8px 4px;">' +
      '<span>Payment method</span>' +
      '<select class="history-payment-select" data-order="' + orderId + '">' +
        '<option value="cash"' + (orderEditPaymentMethod === 'cash' ? ' selected' : '') + '>Cash</option>' +
        '<option value="pin"' + (orderEditPaymentMethod === 'pin' ? ' selected' : '') + '>PIN</option>' +
      '</select>' +
    '</div>' +
    '<div class="row" style="font-weight:500; color:var(--ink); padding:8px 4px;"><span>Order total</span><span>€' + total.toFixed(2) + '</span></div>' +
    '<div class="split">' +
      '<button class="btn btn-sm history-save-btn" data-order="' + orderId + '">Save</button>' +
      '<button class="btn btn-sm history-delete-btn" data-order="' + orderId + '">Delete</button>' +
    '</div>' +
  '</div>';
  return html;
}

async function renderOrderHistory() {
  const allOrders = await db.orders.where('status').equals('confirmed').toArray();
  allOrders.sort(function (a, b) { return (b.confirmed_at || '').localeCompare(a.confirmed_at || ''); });

  document.getElementById('basket-history-count').textContent = allOrders.length;
  document.getElementById('basket-history-empty').style.display = allOrders.length === 0 ? '' : 'none';

  const msgEl = document.getElementById('basket-history-message');
  if (pendingHistoryMessage) {
    msgEl.innerHTML = '<div class="msg-box success">' + pendingHistoryMessage + '</div>';
    pendingHistoryMessage = null;
  } else {
    msgEl.innerHTML = '';
  }

  const groups = {};
  allOrders.forEach(function (o) {
    const dateKey = (o.confirmed_at || '').slice(0, 10);
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(o);
  });
  const dateKeys = Object.keys(groups).sort().reverse();

  const container = document.getElementById('basket-history-groups');
  container.innerHTML = '';

  dateKeys.forEach(function (dateKey) {
    const ordersForDate = groups[dateKey];
    const dayTotal = ordersForDate.reduce(function (s, o) { return s + o.total; }, 0);
    const isExpanded = expandedDates.has(dateKey);

    const dateDiv = document.createElement('div');
    dateDiv.className = 'card';
    let html =
      '<button class="history-date-toggle" data-date="' + dateKey + '" style="width:100%; text-align:left; background:var(--surface-tint); border:1px solid var(--border); border-radius:var(--radius); padding:12px 14px; font-size:15px; font-weight:500; color:var(--ink); display:flex; justify-content:space-between; cursor:pointer;">' +
        '<span>' + formatDateLong(dateKey) + '</span>' +
        '<span>' + ordersForDate.length + (ordersForDate.length === 1 ? ' order' : ' orders') + ' · €' + dayTotal.toFixed(2) + '</span>' +
      '</button>';

    if (isExpanded) {
      html += '<div style="margin-top:12px;">';
      ordersForDate.forEach(function (o) {
        const timeStr = o.confirmed_at ? new Date(o.confirmed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const payClass = o.payment_method === 'cash' ? 'r9' : 'r21';
        const payLabel = o.payment_method === 'cash' ? 'Cash' : 'PIN';
        const exportedBadge = o.exported ? ' <span class="status-badge approved">Exported</span>' : '';
        const editedBadge = o.edited_at ? ' <span class="status-badge pending">Edited</span>' : '';
        html +=
          '<div class="history-order-row" data-order-id="' + o.id + '" style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border); cursor:pointer;">' +
            '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
              '<span>' + timeStr + '</span>' +
              '<span class="tax-badge ' + payClass + '">' + payLabel + '</span>' +
              exportedBadge + editedBadge +
            '</div>' +
            '<div style="font-weight:500;">€' + o.total.toFixed(2) + '</div>' +
          '</div>';
        if (expandedOrderId === o.id && orderEditWorkingCopy) {
          html += renderOrderDetailHtml(o.id, orderEditWorkingCopy);
        }
      });
      html += '</div>';
    }

    dateDiv.innerHTML = html;
    container.appendChild(dateDiv);
  });

  container.querySelectorAll('.history-date-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const d = btn.getAttribute('data-date');
      if (expandedDates.has(d)) { expandedDates.delete(d); } else { expandedDates.add(d); }
      renderOrderHistory();
    });
  });

  container.querySelectorAll('.history-order-row').forEach(function (row) {
    row.addEventListener('click', async function () {
      const id = parseInt(row.getAttribute('data-order-id'), 10);
      if (expandedOrderId === id) {
        expandedOrderId = null;
        orderEditWorkingCopy = null;
        removedItemIds = [];
        orderEditPaymentMethod = null;
      } else {
        expandedOrderId = id;
        const items = await db.order_items.where('order_id').equals(id).toArray();
        orderEditWorkingCopy = items.map(function (it) { return Object.assign({}, it); });
        removedItemIds = [];
        const orderRecord = await db.orders.get(id);
        orderEditPaymentMethod = orderRecord ? orderRecord.payment_method : null;
      }
      renderOrderHistory();
    });
  });

  container.querySelectorAll('.history-item-price-input').forEach(function (input) {
    input.addEventListener('change', function () {
      const idx = parseInt(input.getAttribute('data-idx'), 10);
      const val = parseFloat(input.value.replace(',', '.'));
      orderEditWorkingCopy[idx].price = isNaN(val) ? 0 : val;
      renderOrderHistory();
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  });

  container.querySelectorAll('.history-item-price-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      const current = orderEditWorkingCopy[idx].price;
      orderEditWorkingCopy[idx].price = Math.max(0, Math.round((current + dir * 0.05) * 100) / 100);
      renderOrderHistory();
    });
  });

  container.querySelectorAll('.history-item-qty-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      orderEditWorkingCopy[idx].qty = Math.max(1, orderEditWorkingCopy[idx].qty + dir);
      renderOrderHistory();
    });
  });

  container.querySelectorAll('.history-item-tax-select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      const idx = parseInt(sel.getAttribute('data-idx'), 10);
      orderEditWorkingCopy[idx].tax_group = sel.value;
      renderOrderHistory();
    });
    sel.addEventListener('click', function (e) { e.stopPropagation(); });
  });

  container.querySelectorAll('.history-item-remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const item = orderEditWorkingCopy[idx];
      openConfirmModal('Are you sure you want to remove "' + (item ? item.name : 'this line') + '" from the order? Click Save afterward to make this permanent.', 'Yes, remove', function () {
        if (item && item.id !== undefined) { removedItemIds.push(item.id); }
        orderEditWorkingCopy.splice(idx, 1);
        renderOrderHistory();
      });
    });
  });

  container.querySelectorAll('.history-payment-select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      orderEditPaymentMethod = sel.value;
    });
    sel.addEventListener('click', function (e) { e.stopPropagation(); });
  });

  container.querySelectorAll('.history-add-scan').forEach(function (input) {
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('keydown', async function (e) {
      if (e.key !== 'Enter') return;
      const orderId = parseInt(input.getAttribute('data-order'), 10);
      const code = input.value.trim();
      input.value = '';
      if (!code) return;
      const product = await db.products.get(code);
      const msgEl = document.getElementById('history-add-message-' + orderId);
      if (!product) {
        if (msgEl) msgEl.innerHTML = '<div class="msg-box warn">Unknown barcode ' + code + '.</div>';
        return;
      }
      const existing = orderEditWorkingCopy.find(function (l) { return l.barcode === code; });
      if (existing) {
        existing.qty += 1;
      } else {
        orderEditWorkingCopy.push({ order_id: orderId, barcode: code, name: product.name, price: product.price, qty: 1, tax_group: product.tax_group });
      }
      renderOrderHistory();
      const refocused = document.querySelector('.history-add-scan[data-order="' + orderId + '"]');
      if (refocused) refocused.focus();
    });
  });

  container.querySelectorAll('.history-search-toggle-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const orderId = btn.getAttribute('data-order');
      const body = document.querySelector('.history-search-body[data-order="' + orderId + '"]');
      if (body) {
        body.style.display = body.style.display === 'none' ? '' : 'none';
        if (body.style.display !== 'none') {
          const searchInput = body.querySelector('.history-search-input');
          if (searchInput) searchInput.focus();
        }
      }
    });
  });

  container.querySelectorAll('.history-search-input').forEach(function (input) {
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('input', async function () {
      const orderId = parseInt(input.getAttribute('data-order'), 10);
      const term = input.value.trim().toLowerCase();
      const resultsEl = document.querySelector('.history-search-results[data-order="' + orderId + '"]');
      if (!resultsEl) return;
      if (!term) { resultsEl.innerHTML = ''; return; }
      const allProducts = await db.products.toArray();
      const matches = allProducts.filter(function (p) { return (p.name || '').toLowerCase().indexOf(term) !== -1; }).slice(0, 8);
      if (matches.length === 0) {
        resultsEl.innerHTML = '<p class="empty" style="padding:8px 0;">No matches.</p>';
        return;
      }
      resultsEl.innerHTML = matches.map(function (p) {
        return '<button type="button" class="history-search-result-btn" data-order="' + orderId + '" data-barcode="' + p.barcode + '" style="display:block; width:100%; text-align:left; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); margin-bottom:6px;">' +
          p.name + ' <span style="color:var(--muted); font-size:12px;">€' + Number(p.price || 0).toFixed(2) + '</span>' +
        '</button>';
      }).join('');
      resultsEl.querySelectorAll('.history-search-result-btn').forEach(function (resultBtn) {
        resultBtn.addEventListener('click', async function (e) {
          e.stopPropagation();
          const barcode = resultBtn.getAttribute('data-barcode');
          const product = await db.products.get(barcode);
          if (!product) return;
          const existing = orderEditWorkingCopy.find(function (l) { return l.barcode === barcode; });
          if (existing) {
            existing.qty += 1;
          } else {
            orderEditWorkingCopy.push({ order_id: orderId, barcode: barcode, name: product.name, price: product.price, qty: 1, tax_group: product.tax_group });
          }
          renderOrderHistory();
        });
      });
    });
  });

  container.querySelectorAll('.history-save-btn').forEach(function (btn) {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      const orderId = parseInt(btn.getAttribute('data-order'), 10);

      if (orderEditWorkingCopy.length === 0) {
        openConfirmModal('This order will have no items left. Delete the order entirely?', 'Yes, delete order', async function () {
          await db.order_items.where('order_id').equals(orderId).delete();
          await db.orders.delete(orderId);
          expandedOrderId = null;
          orderEditWorkingCopy = null;
          removedItemIds = [];
          orderEditPaymentMethod = null;
          pendingHistoryMessage = 'Order deleted.';
          renderOrderHistory();
        });
        return;
      }

      for (const id of removedItemIds) {
        await db.order_items.delete(id);
      }
      for (const item of orderEditWorkingCopy) {
        await db.order_items.put(item);
      }
      const total = orderEditWorkingCopy.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
      await db.orders.update(orderId, { total: total, edited_at: new Date().toISOString(), payment_method: orderEditPaymentMethod });
      expandedOrderId = null;
      orderEditWorkingCopy = null;
      removedItemIds = [];
      orderEditPaymentMethod = null;
      pendingHistoryMessage = 'Order changes saved.';
      renderOrderHistory();
    });
  });

  container.querySelectorAll('.history-delete-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const orderId = parseInt(btn.getAttribute('data-order'), 10);
      openConfirmModal('Are you sure you want to delete this order? This cannot be undone.', 'Yes, delete', async function () {
        await db.order_items.where('order_id').equals(orderId).delete();
        await db.orders.delete(orderId);
        expandedOrderId = null;
        orderEditWorkingCopy = null;
        removedItemIds = [];
        orderEditPaymentMethod = null;
        pendingHistoryMessage = 'Order deleted.';
        renderOrderHistory();
      });
    });
  });
}

// ===================== ORDER EXPORT =====================
async function exportOrders(orderList) {
  const orderCols = ['id', 'created_at', 'confirmed_at', 'total', 'payment_method', 'status', 'edited_at', 'exported', 'exported_at'];
  const itemCols = ['id', 'order_id', 'barcode', 'name', 'price', 'qty', 'tax_group', 'price_excl_tax'];

  const orderIds = orderList.map(function (o) { return o.id; });
  const allItems = await db.order_items.where('order_id').anyOf(orderIds).toArray();
  const itemsWithExclTax = allItems.map(function (it) {
    const frac = taxRateFraction(it.tax_group);
    return Object.assign({}, it, { price_excl_tax: Math.round((it.price / (1 + frac)) * 100) / 100 });
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  const combined =
    '## ORDERS\n' + csvFromRows(orderList, orderCols) +
    '\n\n## ORDER_ITEMS\n' + csvFromRows(itemsWithExclTax, itemCols);
  downloadTextFile('order-backup-' + dateStamp + '.csv', combined);

  for (const id of orderIds) {
    await db.orders.update(id, { exported: true, exported_at: new Date().toISOString() });
  }
}

document.getElementById('order-export-toggle-btn').addEventListener('click', function () {
  const body = document.getElementById('order-export-body');
  body.style.display = body.style.display === 'none' ? '' : 'none';
});

document.getElementById('order-export-new-btn').addEventListener('click', async function () {
  const statusEl = document.getElementById('order-export-status');
  const allOrders = await db.orders.where('status').equals('confirmed').toArray();
  const newOrders = allOrders.filter(function (o) { return !o.exported; });
  if (newOrders.length === 0) {
    statusEl.textContent = 'No new sales to export.';
    setTimeout(function () { statusEl.textContent = ''; }, 2500);
    return;
  }
  await exportOrders(newOrders);
  statusEl.textContent = 'Exported ' + newOrders.length + ' new order(s).';
  setTimeout(function () { statusEl.textContent = ''; }, 2500);
  renderOrderHistory();
});

document.getElementById('order-export-range-btn').addEventListener('click', async function () {
  const statusEl = document.getElementById('order-export-status');
  const from = document.getElementById('order-export-from').value;
  const to = document.getElementById('order-export-to').value;
  if (!from || !to) {
    statusEl.textContent = 'Pick both a from and to date.';
    setTimeout(function () { statusEl.textContent = ''; }, 2500);
    return;
  }
  const allOrders = await db.orders.where('status').equals('confirmed').toArray();
  const rangeOrders = allOrders.filter(function (o) {
    const d = (o.confirmed_at || '').slice(0, 10);
    return d >= from && d <= to;
  });
  if (rangeOrders.length === 0) {
    statusEl.textContent = 'No confirmed orders in that date range.';
    setTimeout(function () { statusEl.textContent = ''; }, 2500);
    return;
  }
  await exportOrders(rangeOrders);
  statusEl.textContent = 'Exported ' + rangeOrders.length + ' order(s) from ' + from + ' to ' + to + '.';
  setTimeout(function () { statusEl.textContent = ''; }, 2500);
  renderOrderHistory();
});

// ===================== ORDER RESTORE FROM BACKUP =====================
let selectedOrderBackupFile = null;

document.getElementById('select-order-backup-file-btn').addEventListener('click', function () {
  document.getElementById('import-order-backup-file').click();
});
document.getElementById('import-order-backup-file').addEventListener('change', function (e) {
  selectedOrderBackupFile = e.target.files[0] || null;
  document.getElementById('order-backup-file-name').textContent = selectedOrderBackupFile ? selectedOrderBackupFile.name : 'No file selected';
});

document.getElementById('order-restore-btn').addEventListener('click', async function () {
  const msgEl = document.getElementById('order-restore-message');
  try {
    if (!selectedOrderBackupFile) {
      msgEl.innerHTML = '<div class="msg-box error">Select a backup file before restoring.</div>';
      return;
    }
    const fullText = await selectedOrderBackupFile.text();
    const ordersMarker = '## ORDERS';
    const itemsMarker = '## ORDER_ITEMS';
    const ordersIdx = fullText.indexOf(ordersMarker);
    const itemsIdx = fullText.indexOf(itemsMarker);
    if (ordersIdx === -1 || itemsIdx === -1) {
      msgEl.innerHTML = '<div class="msg-box error">This doesn\'t look like a valid order backup file.</div>';
      return;
    }
    const ordersText = fullText.slice(ordersIdx + ordersMarker.length, itemsIdx).trim();
    const itemsText = fullText.slice(itemsIdx + itemsMarker.length).trim();

    const orderRows = parseCSV(ordersText);
    const itemRows = parseCSV(itemsText);
    if (orderRows.length === 0) {
      msgEl.innerHTML = '<div class="msg-box warn">The backup file appears to contain no orders.</div>';
      return;
    }

    const orderHeader = orderRows[0];
    const orderIdx = {};
    ['id', 'created_at', 'confirmed_at', 'total', 'payment_method', 'status', 'edited_at', 'exported', 'exported_at'].forEach(function (c) {
      orderIdx[c] = orderHeader.indexOf(c);
    });
    if (orderIdx.id === -1) {
      msgEl.innerHTML = '<div class="msg-box error">Orders section is missing an "id" column — is this the right file?</div>';
      return;
    }

    const itemHeader = itemRows.length ? itemRows[0] : [];
    const itemIdx = {};
    ['id', 'order_id', 'barcode', 'name', 'price', 'qty', 'tax_group'].forEach(function (c) {
      itemIdx[c] = itemHeader.indexOf(c);
    });

    let ordersRestored = 0;
    for (let i = 1; i < orderRows.length; i++) {
      const r = orderRows[i];
      const idVal = parseInt(r[orderIdx.id], 10);
      if (isNaN(idVal)) continue;
      await db.orders.put({
        id: idVal,
        created_at: orderIdx.created_at !== -1 ? r[orderIdx.created_at] : new Date().toISOString(),
        confirmed_at: orderIdx.confirmed_at !== -1 ? r[orderIdx.confirmed_at] : null,
        total: parseFloat(r[orderIdx.total]) || 0,
        payment_method: orderIdx.payment_method !== -1 ? (r[orderIdx.payment_method] || null) : null,
        status: orderIdx.status !== -1 ? (r[orderIdx.status] || 'confirmed') : 'confirmed',
        edited_at: orderIdx.edited_at !== -1 ? (r[orderIdx.edited_at] || null) : null,
        exported: orderIdx.exported !== -1 ? (r[orderIdx.exported] === 'true') : false,
        exported_at: orderIdx.exported_at !== -1 ? (r[orderIdx.exported_at] || null) : null
      });
      ordersRestored++;
    }

    let itemsRestored = 0;
    if (itemIdx.order_id !== -1) {
      for (let i = 1; i < itemRows.length; i++) {
        const r = itemRows[i];
        const orderIdVal = parseInt(r[itemIdx.order_id], 10);
        if (isNaN(orderIdVal)) continue;
        const record = {
          order_id: orderIdVal,
          barcode: itemIdx.barcode !== -1 ? (r[itemIdx.barcode] || null) : null,
          name: itemIdx.name !== -1 ? r[itemIdx.name] : '',
          price: parseFloat(r[itemIdx.price]) || 0,
          qty: parseInt(r[itemIdx.qty], 10) || 1,
          tax_group: itemIdx.tax_group !== -1 ? r[itemIdx.tax_group] : ''
        };
        if (itemIdx.id !== -1) {
          const idVal = parseInt(r[itemIdx.id], 10);
          if (!isNaN(idVal)) record.id = idVal;
        }
        await db.order_items.put(record);
        itemsRestored++;
      }
    }

    msgEl.innerHTML = '<div class="msg-box success">Restored ' + ordersRestored + ' order(s) and ' + itemsRestored + ' line item(s).</div>';
    renderOrderHistory();
  } catch (err) {
    msgEl.innerHTML = '<div class="msg-box error">Restore failed: ' + (err.message || err) + '</div>';
  }
});

// ===================== INIT =====================
(async function init() {
  document.getElementById('header-status').textContent = 'v' + APP_VERSION;
  await seedSuppliers();
  await refreshSupplierMap();
  await getSettings();
  await loadActiveOrCreateOrder();
})();

// ===================== SERVICE WORKER =====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').catch(function () {});
  });
}
