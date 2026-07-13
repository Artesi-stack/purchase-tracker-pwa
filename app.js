// ===================== DATA LAYER =====================
const db = new Dexie('purchase-tracker');
db.version(1).stores({
  products: 'barcode, sku, name, tax_group, category, supplier_id',
  suppliers: 'supplier_id'
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
const viewBasket = document.getElementById('view-basket');
const viewProducts = document.getElementById('view-products');

function focusActiveScanField() {
  if (viewBasket.style.display !== 'none') {
    basketScan.focus();
  } else if (subManage.style.display !== 'none') {
    manageScan.focus();
  } else if (subAdd.style.display !== 'none') {
    addScan.focus();
  }
}

tabBasket.addEventListener('click', function () {
  tabBasket.classList.add('active');
  tabProducts.classList.remove('active');
  viewBasket.style.display = '';
  viewProducts.style.display = 'none';
  focusActiveScanField();
});
tabProducts.addEventListener('click', function () {
  tabProducts.classList.add('active');
  tabBasket.classList.remove('active');
  viewProducts.style.display = '';
  viewBasket.style.display = 'none';
  renderProductList();
  focusActiveScanField();
});

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
        '</div>' +
        '<div id="' + prefix + 'cancel-confirm" style="display:none; margin-top:10px;">' +
          '<p style="font-size:13px; margin:0 0 8px;">Are you sure? This will clear what you\'ve entered.</p>' +
          '<div class="btn split">' +
            '<button id="' + prefix + 'cancel-yes-btn" class="btn primary">Yes</button>' +
            '<button id="' + prefix + 'cancel-no-btn" class="btn">No</button>' +
          '</div>' +
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
    document.getElementById(p + 'cancel-confirm').style.display = '';
  });
  document.getElementById(p + 'cancel-yes-btn').addEventListener('click', function () {
    managePanel.innerHTML = '';
    if (returnTo === 'list') {
      showSubtab('list');
    } else {
      manageScan.focus();
    }
  });
  document.getElementById(p + 'cancel-no-btn').addEventListener('click', function () {
    document.getElementById(p + 'cancel-confirm').style.display = 'none';
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
    document.getElementById(p + 'cancel-confirm').style.display = '';
  });
  document.getElementById(p + 'cancel-yes-btn').addEventListener('click', function () {
    addPanel.innerHTML = '';
    addScan.focus();
  });
  document.getElementById(p + 'cancel-no-btn').addEventListener('click', function () {
    document.getElementById(p + 'cancel-confirm').style.display = 'none';
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
    }).join('') + '<td><button class="edit-row-btn" data-barcode="' + p.barcode + '">Edit</button></td></tr>';
  }).join('');

  document.querySelectorAll('.edit-row-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const barcode = btn.getAttribute('data-barcode');
      const product = await db.products.get(barcode);
      showSubtab('manage');
      renderManageForm(product, 'list');
    });
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
});

// ===================== INIT =====================
(async function init() {
  await seedSuppliers();
  await refreshSupplierMap();
})();

// ===================== SERVICE WORKER =====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').catch(function () {});
  });
}
