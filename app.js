// ===================== APP VERSION =====================
const APP_VERSION = '0.7';

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
    basketScan.focus();
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
let basket = []; // { barcode, name, price, tax_group, qty }
const basketScan = document.getElementById('basket-scan');
const basketLines = document.getElementById('basket-lines');
const basketEmpty = document.getElementById('basket-empty');
const basketCount = document.getElementById('basket-count');
const basketTotal = document.getElementById('basket-total');
const basketStatus = document.getElementById('basket-status');

function renderBasket() {
  basketLines.innerHTML = '';
  basketEmpty.style.display = basket.length === 0 ? '' : 'none';
  basket.forEach(function (line) {
    const div = document.createElement('div');
    div.className = 'basket-line';
    const lineTotal = (line.price * line.qty).toFixed(2);
    div.innerHTML =
      '<div><div class="name">' + line.name + '</div><div class="meta">' + line.qty + ' x €' + line.price.toFixed(2) + ' · ' + taxLabel(line.tax_group) + '</div></div>' +
      '<div class="line-total">€' + lineTotal + '</div>';
    basketLines.appendChild(div);
  });
  const total = basket.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const items = basket.reduce(function (s, l) { return s + l.qty; }, 0);
  basketTotal.textContent = '€' + total.toFixed(2);
  basketCount.textContent = items + (items === 1 ? ' item' : ' items');
}

function setStatus(el, msg) {
  el.textContent = msg;
  setTimeout(function () { el.textContent = ''; }, 2000);
}

basketScan.addEventListener('keydown', async function (e) {
  if (e.key !== 'Enter') return;
  const code = basketScan.value.trim();
  basketScan.value = '';
  if (!code) return;
  const product = await db.products.get(code);
  if (!product) {
    setStatus(basketStatus, 'Unknown barcode ' + code + ' — add it in Products first');
    return;
  }
  const existing = basket.find(function (l) { return l.barcode === code; });
  if (existing) {
    existing.qty += 1;
    setStatus(basketStatus, product.name + ' quantity increased');
  } else {
    basket.push({ barcode: code, name: product.name, price: product.price, tax_group: product.tax_group, qty: 1 });
    setStatus(basketStatus, product.name + ' added');
  }
  renderBasket();
});

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
    field('Price (€)', prefix + 'f-price', p.price != null ? p.price : '', readOnly, 'number') +
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
const exportColumnsEl = document.getElementById('export-columns');
const exportBtn = document.getElementById('export-btn');
const exportStatus = document.getElementById('export-status');

function renderExportCheckboxes() {
  exportColumnsEl.innerHTML = ALL_COLUMNS.map(function (c) {
    return '<label><input type="checkbox" class="export-col" value="' + c.key + '" checked /> ' + c.label + '</label>';
  }).join('');
}

let pendingListMessage = null;

async function renderProductList() {
  await refreshSupplierMap();
  const products = await db.products.toArray();
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
      if (c.key === 'price' || c.key === 'cost_price') val = val != null ? '€' + Number(val).toFixed(2) : '';
      return '<td>' + (val === undefined || val === null ? '' : val) + '</td>';
    }).join('') +
    '<td><button class="edit-row-btn" data-barcode="' + p.barcode + '">Edit</button>' +
    '<button class="delete-row-btn" data-barcode="' + p.barcode + '">Delete</button></td></tr>';
  }).join('');

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
  a.download = 'product-catalog-export.csv';
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
  iban: '',
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

function formatInvoiceNumber(year, seq) {
  return year + '-' + String(seq).padStart(4, '0');
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
  const currentYear = String(new Date().getFullYear());
  const nextSeq = (s.counters[currentYear] || 0) + 1;
  document.getElementById('settings-next-number').textContent = formatInvoiceNumber(currentYear, nextSeq);
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
    a.download = 'settings-backup.json';
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
  const year = (invoiceDateEl.value || new Date().toISOString().slice(0, 10)).slice(0, 4);
  const nextSeq = (s.counters[year] || 0) + 1;
  document.getElementById('invoice-number-preview').textContent =
    formatInvoiceNumber(year, nextSeq) + ' (assigned on approval)';
}

function renderInvoiceLines() {
  invoiceLinesEl.innerHTML = '';
  invoiceEmptyEl.style.display = invoiceLines.length === 0 ? '' : 'none';
  invoiceLines.forEach(function (line) {
    const div = document.createElement('div');
    div.className = 'basket-line';
    const lineTotal = (line.price * line.qty).toFixed(2);
    div.innerHTML =
      '<div><div class="name">' + line.description + '</div><div class="meta">' + line.qty + ' x €' + line.price.toFixed(2) + ' · ' + taxLabel(line.tax_group) + '</div></div>' +
      '<div class="line-total">€' + lineTotal + '</div>';
    invoiceLinesEl.appendChild(div);
  });
  const sub21 = invoiceLines.filter(function (l) { return l.tax_group === 'R21'; }).reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const sub9 = invoiceLines.filter(function (l) { return l.tax_group === 'R9'; }).reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  const items = invoiceLines.reduce(function (s, l) { return s + l.qty; }, 0);
  invoiceSub21El.textContent = '€' + sub21.toFixed(2);
  invoiceSub9El.textContent = '€' + sub9.toFixed(2);
  invoiceTotalEl.textContent = '€' + (sub21 + sub9).toFixed(2);
  invoiceCountEl.textContent = items + (items === 1 ? ' line' : ' lines');
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
  y += 8;

  doc.text('Factuurnummer: ' + (invoiceRecord.invoice_number || '(concept)'), 20, y);
  doc.text('Datum: ' + invoiceRecord.invoice_date, 130, y);
  y += 18;

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
  refreshInvoiceNumberPreview();
});

// ===================== INVOICE: HISTORY =====================
async function approveInvoice(id) {
  const inv = await db.invoices.get(id);
  if (!inv || inv.status === 'approved') return;
  const s = await getSettings();
  const year = inv.invoice_date.slice(0, 4);
  const seq = (s.counters[year] || 0) + 1;
  const invoiceNumber = formatInvoiceNumber(year, seq);

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
  const invoiceCols = ['id', 'invoice_number', 'status', 'invoice_date', 'total', 'sub21', 'sub9', 'created_at'];
  const itemCols = ['id', 'invoice_id', 'barcode', 'description', 'qty', 'price', 'tax_group'];
  downloadTextFile('invoices-backup.csv', csvFromRows(invoices, invoiceCols));
  downloadTextFile('invoice-items-backup.csv', csvFromRows(items, itemCols));
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

// ===================== INIT =====================
(async function init() {
  document.getElementById('header-status').textContent = 'v' + APP_VERSION;
  await seedSuppliers();
  await refreshSupplierMap();
  await getSettings();
})();

// ===================== SERVICE WORKER =====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').catch(function () {});
  });
}
