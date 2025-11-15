// ==============================================
// Nexus Finance Móvil — JS
// Usa el mismo localStorage que Nexus original
// ==============================================

const STORAGE_KEY = 'finanzas-state-v10';

// ---------- Estado mínimo compatible ----------
const DEFAULT_STATE = {
  settings: {
    businessName: 'Mi Negocio',
    currency: 'USD',
    logoBase64: ''
  },
  incomesDaily: [],
  expensesDaily: [],
  invoices: []
};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(DEFAULT_STATE);
  try {
    const data = JSON.parse(raw);
    // merge suave
    const st = structuredClone(DEFAULT_STATE);
    Object.assign(st, data);
    // asegurar arrays
    st.incomesDaily = Array.isArray(st.incomesDaily) ? st.incomesDaily : [];
    st.expensesDaily = Array.isArray(st.expensesDaily) ? st.expensesDaily : [];
    st.invoices     = Array.isArray(st.invoices)     ? st.invoices     : [];
    st.settings = Object.assign({}, DEFAULT_STATE.settings, st.settings || {});
    return st;
  } catch (e) {
    console.warn('No se pudo leer el estado, uso default', e);
    return structuredClone(DEFAULT_STATE);
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Utils ----------
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n) {
  const cur = state.settings.currency || 'USD';
  const val = Number(n || 0);
  try {
    return new Intl.NumberFormat('es-PR', { style: 'currency', currency: cur }).format(val);
  } catch {
    return `${cur} ${val.toFixed(2)}`;
  }
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(to + 'T23:59:59')) return false;
  return true;
}

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

// ---------- Navegación simple ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === 'screen-' + id);
  });
}

// ---------- Resumen de HOY ----------
function sumIncomesToday() {
  const t = todayStr();
  return state.incomesDaily
    .filter(r => inRange(r.date, t, t))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function sumExpensesToday() {
  const t = todayStr();
  return state.expensesDaily
    .filter(r => inRange(r.date, t, t))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function refreshTodaySummary() {
  const inc = sumIncomesToday();
  const exp = sumExpensesToday();
  const bal = inc - exp;

  document.getElementById('kpi-income-today').textContent   = fmt(inc);
  document.getElementById('kpi-expenses-today').textContent = fmt(exp);
  document.getElementById('kpi-balance-today').textContent  = fmt(bal);

  renderTodayInvoices();
}

function renderTodayInvoices() {
  const t = todayStr();
  const wrap = document.getElementById('todayInvoices');
  if (!wrap) return;

  const todays = state.invoices.filter(inv => inv.date === t);
  if (!todays.length) {
    wrap.className = 'list-empty';
    wrap.textContent = 'No hay facturas registradas hoy.';
    return;
  }

  wrap.className = '';
  wrap.innerHTML = '';
  todays
    .slice()
    .sort((a, b) => (a.number || '').localeCompare(b.number || ''))
    .forEach(inv => {
      const div = document.createElement('div');
      div.className = 'invoice-pill';
      div.innerHTML = `
        <div><strong>#${inv.number || ''}</strong> · ${fmt(inv.total || 0)}</div>
        <div>${inv.client?.name || 'Sin cliente'}</div>
        <div style="font-size:0.78rem; opacity:.8;">${inv.method || ''}</div>
      `;
      wrap.appendChild(div);
    });
}

// ---------- INGRESO RÁPIDO ----------
function wireIncomeForm() {
  const f = document.getElementById('formIncome');
  if (!f) return;

  document.getElementById('incDateMobile').value = todayStr();

  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: document.getElementById('incDateMobile').value || todayStr(),
      client: document.getElementById('incClientMobile').value || '',
      method: document.getElementById('incMethodMobile').value || 'Efectivo',
      amount: Number(document.getElementById('incAmountMobile').value || 0)
    };

    if (!rec.amount || rec.amount <= 0) {
      toast('Monto inválido');
      return;
    }

    state.incomesDaily.push(rec);
    saveState();
    toast('Ingreso guardado');
    f.reset();
    document.getElementById('incDateMobile').value = todayStr();
    refreshTodaySummary();
  });
}

// ---------- GASTO RÁPIDO ----------
function wireExpenseForm() {
  const f = document.getElementById('formExpense');
  if (!f) return;

  document.getElementById('expDateMobile').value = todayStr();

  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: document.getElementById('expDateMobile').value || todayStr(),
      category: document.getElementById('expCategoryMobile').value || 'Otros',
      method: document.getElementById('expMethodMobile').value || 'Efectivo',
      amount: Number(document.getElementById('expAmountMobile').value || 0),
      desc: '',
      note: ''
    };

    if (!rec.amount || rec.amount <= 0) {
      toast('Monto inválido');
      return;
    }

    state.expensesDaily.push(rec);
    saveState();
    toast('Gasto guardado');
    f.reset();
    document.getElementById('expDateMobile').value = todayStr();
    refreshTodaySummary();
  });
}

// ---------- FACTURA MÓVIL ----------
function addItemRow() {
  const cont = document.getElementById('invItemsContainer');
  if (!cont) return;
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input type="text"  placeholder="Descripción">
    <input type="number" step="0.01" placeholder="Cant." value="1">
    <input type="number" step="0.01" placeholder="Precio" value="0">
    <input type="number" step="0.01" placeholder="%Imp" value="0">
  `;
  cont.appendChild(row);

  // recalc cuando cambien
  row.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', updateInvoiceTotals);
  });

  // botón quitar
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  const btnDel = document.createElement('button');
  btnDel.type = 'button';
  btnDel.className = 'btn-remove-item';
  btnDel.textContent = 'Eliminar ítem';
  btnDel.addEventListener('click', () => {
    row.remove();
    actions.remove();
    updateInvoiceTotals();
  });
  actions.appendChild(btnDel);
  cont.appendChild(actions);
}

function readInvoiceItems() {
  const cont = document.getElementById('invItemsContainer');
  const rows = Array.from(cont.querySelectorAll('.item-row'));
  const items = [];
  rows.forEach(row => {
    const [descEl, qtyEl, priceEl, taxEl] = row.querySelectorAll('input');
    const desc = (descEl.value || '').trim();
    const qty = parseFloat(qtyEl.value || '0') || 0;
    const price = parseFloat(priceEl.value || '0') || 0;
    const tax = parseFloat(taxEl.value || '0') || 0;
    if (!desc && qty === 0 && price === 0) return;
    items.push({ desc, qty, price, tax });
  });
  return items;
}

function calcTotals(items) {
  let subtotal = 0;
  let taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const t = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += t;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function updateInvoiceTotals() {
  const items = readInvoiceItems();
  const t = calcTotals(items);

  document.getElementById('invSubtotalMobile').textContent = items.length ? fmt(t.subtotal) : '—';
  document.getElementById('invTaxMobile').textContent      = items.length ? fmt(t.taxTotal) : '—';
  document.getElementById('invTotalMobile').textContent    = items.length ? fmt(t.total) : '—';

  return t;
}

function buildInvoiceObject() {
  const items = readInvoiceItems();
  const t = calcTotals(items);

  const inv = {
    id: uid(),
    date: document.getElementById('invDateMobile').value || todayStr(),
    dueDate: document.getElementById('invDateMobile').value || todayStr(),
    number: document.getElementById('invNumberMobile').value || '',
    method: document.getElementById('invMethodMobile').value || '',
    client: {
      name: document.getElementById('invClientMobile').value || '',
      phone: document.getElementById('invPhoneMobile').value || '',
      email: '',
      address: ''
    },
    items,
    subtotal: t.subtotal,
    taxTotal: t.taxTotal,
    total: t.total,
    note: document.getElementById('invNoteMobile').value || '',
    terms: ''
  };

  return inv;
}

function validateInvoice(inv) {
  if (!inv.date) {
    toast('Fecha requerida');
    return false;
  }
  if (!inv.number) {
    toast('# de factura requerido');
    return false;
  }
  if (!inv.client.name) {
    toast('Nombre del cliente requerido');
    return false;
  }
  if (!inv.items.length) {
    toast('Añade al menos un ítem');
    return false;
  }
  if (!inv.total || inv.total <= 0) {
    toast('El total debe ser mayor a 0');
    return false;
  }
  return true;
}

function saveInvoice(inv) {
  // guardar factura
  state.invoices.push(inv);

  // también registrar ingreso (como hace Nexus)
  const income = {
    id: uid(),
    date: inv.date,
    client: inv.client.name,
    method: inv.method,
    amount: inv.total,
    invoiceNumber: inv.number
  };
  state.incomesDaily.push(income);

  saveState();
  refreshTodaySummary();
}

function openWhatsAppForInvoice(inv) {
  const phoneRaw = inv.client?.phone || '';
  const digits = phoneRaw.replace(/\D/g, '');
  if (!digits) {
    toast('Factura guardada. No hay número de teléfono para WhatsApp.');
    return;
  }

  const negocio = state.settings.businessName || 'Mi Negocio';
  const msgLines = [
    `Hola ${inv.client.name || ''},`,
    ``,
    `Le comparto el resumen de su factura #${inv.number}:`,
    `Total: ${fmt(inv.total)}`,
    ``,
    `Gracias por su confianza.`,
    `- ${negocio}`
  ];
  const url = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msgLines.join('\n'));
  window.open(url, '_blank');
}

function wireInvoiceForm() {
  const f = document.getElementById('formInvoice');
  if (!f) return;

  document.getElementById('invDateMobile').value = todayStr();

  // al entrar, creamos una línea por defecto
  addItemRow();
  updateInvoiceTotals();

  document.getElementById('btnAddItem').addEventListener('click', () => {
    addItemRow();
    updateInvoiceTotals();
  });

  document.getElementById('btnCalcInvoice').addEventListener('click', () => {
    updateInvoiceTotals();
    toast('Totales actualizados');
  });

  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const inv = buildInvoiceObject();
    if (!validateInvoice(inv)) return;
    saveInvoice(inv);
    toast('Factura guardada');

    f.reset();
    document.getElementById('invDateMobile').value = todayStr();
    document.getElementById('invItemsContainer').innerHTML = '';
    addItemRow();
    updateInvoiceTotals();
  });

  document.getElementById('btnSaveInvoiceWhatsApp')
    .addEventListener('click', (ev) => {
      ev.preventDefault();
      const inv = buildInvoiceObject();
      if (!validateInvoice(inv)) return;
      saveInvoice(inv);
      toast('Factura guardada, abriendo WhatsApp…');
      openWhatsAppForInvoice(inv);

      f.reset();
      document.getElementById('invDateMobile').value = todayStr();
      document.getElementById('invItemsContainer').innerHTML = '';
      addItemRow();
      updateInvoiceTotals();
    });
}

// ---------- Navegación botones ----------
function wireNav() {
  document.getElementById('btnGoIncome')
    .addEventListener('click', () => showScreen('income'));
  document.getElementById('btnGoExpense')
    .addEventListener('click', () => showScreen('expense'));
  document.getElementById('btnGoInvoice')
    .addEventListener('click', () => showScreen('invoice'));

  document.querySelectorAll('.btn-back[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-back');
      showScreen(target);
    });
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  // si no hay logo guardado, tratamos de usar assets/logo.png sin más
  // (la mini app no cambia el tema; solo lee moneda y nombre si existen)
  wireNav();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  refreshTodaySummary();
});
