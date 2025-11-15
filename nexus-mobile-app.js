// ==============================================
// Nexus Finance Móvil — JS (con Firebase)
// ==============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// 🔐 MISMO CONFIG QUE NEXUS COMPLETO
const firebaseConfig = {
  apiKey: "AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE",
  authDomain: "finanzas-web-f4e05.firebaseapp.com",
  projectId: "finanzas-web-f4e05",
  storageBucket: "finanzas-web-f4e05.firebasestorage.app",
  messagingSenderId: "1047152523619",
  appId: "1:1047152523619:web:7d8f7d1f7a5ccc6090bb56"
};

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

// ---------- Cloud state ----------
const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem('autosync') || 'false')
};

// ---------- Estado local (mismo STORAGE_KEY) ----------
const STORAGE_KEY = 'finanzas-state-v10';

const DEFAULT_STATE = {
  settings: {
    businessName: 'Mi Negocio',
    currency: 'USD',
    logoBase64: ''
  },
  incomesDaily: [],
  expensesDaily: [],
  invoices: [],
  // para compatibilidad con el Nexus grande:
  payments: [],
  ordinary: [],
  budgets: [],
  personal: [],
  reconciliations: [],
  _cloud: { updatedAt: 0 }
};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(DEFAULT_STATE);
  try {
    const data = JSON.parse(raw);
    const st = structuredClone(DEFAULT_STATE);
    Object.assign(st, data);
    // asegurar arrays
    ['incomesDaily','expensesDaily','invoices','payments','ordinary','budgets','personal','reconciliations']
      .forEach(k => { if (!Array.isArray(st[k])) st[k] = []; });
    st.settings = Object.assign({}, DEFAULT_STATE.settings, st.settings || {});
    st._cloud = Object.assign({}, DEFAULT_STATE._cloud, st._cloud || {});
    return st;
  } catch (e) {
    console.warn('No se pudo leer el estado, uso default', e);
    return structuredClone(DEFAULT_STATE);
  }
}

let state = loadState();

// SAVE con AutoSync
let pushTimer;
function cloudPushDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    cloudPush().catch(err => console.warn('cloudPush error (debounced):', err));
  }, 800);
}

function saveState({ skipCloud = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!skipCloud && cloud.autosync && cloud.user) {
    cloudPushDebounced();
  }
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

// ---------- Resumen HOY ----------
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

  row.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', updateInvoiceTotals);
  });

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
  if (!inv.date)      { toast('Fecha requerida'); return false; }
  if (!inv.number)    { toast('# de factura requerido'); return false; }
  if (!inv.client.name){ toast('Nombre del cliente requerido'); return false; }
  if (!inv.items.length){ toast('Añade al menos un ítem'); return false; }
  if (!inv.total || inv.total <= 0){ toast('El total debe ser mayor a 0'); return false; }
  return true;
}

function saveInvoice(inv) {
  state.invoices.push(inv);

  const income = {
    id: uid(),
    date: inv.date,
    client: inv.client.name,
    method: inv.method,
    amount: inv.total,
    invoiceNumber: inv.number
  };
  state.incomesDaily.push(income);

  // 🔁 guarda y dispara Sync si está activo
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

// ---------- Firebase / Firestore: helpers ----------
function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, 'users', cloud.user.uid, 'state', 'app');
}

async function cloudPull(replace = true) {
  const ref = cloudDocRef();
  if (!ref) {
    toast('Primero conecta con Google');
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast('Aún no hay datos en la nube');
    return;
  }
  const remote = snap.data() || {};
  if (replace) {
    state = remote;
  } else {
    // fusión suave (igual que en Nexus grande)
    state.settings = Object.assign({}, state.settings, remote.settings || {});
    ['expensesDaily','incomesDaily','payments','ordinary','budgets','personal','invoices','quotes','reconciliations']
      .forEach(k => {
        if (Array.isArray(remote[k])) {
          state[k] = state[k].concat(remote[k]);
        }
      });
    const rU = remote?._cloud?.updatedAt || 0;
    const lU = state?._cloud?.updatedAt || 0;
    state._cloud = { updatedAt: Math.max(rU, lU) };
  }
  saveState({ skipCloud: true });
  toast('Datos cargados desde la nube');
  refreshTodaySummary();
}

async function cloudPush() {
  const ref = cloudDocRef();
  if (!ref) {
    // si no está logeado, no reventamos nada
    console.warn('Sin usuario, no se puede hacer cloudPush');
    return;
  }
  if (!state._cloud) state._cloud = { updatedAt: 0 };
  state._cloud.updatedAt = Date.now();
  await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge: true });
  saveState({ skipCloud: true });
  toast('Datos enviados a la nube');
}

// ---------- UI Sync ----------
function setAutosync(val) {
  cloud.autosync = !!val;
  localStorage.setItem('autosync', JSON.stringify(cloud.autosync));
  const chk = document.getElementById('chkAutosyncMobile');
  if (chk) chk.checked = cloud.autosync;
}

function updateSyncUI() {
  const statusEl = document.getElementById('syncStatusMobile');
  const btnIn    = document.getElementById('btnSignInMobile');
  const btnOut   = document.getElementById('btnSignOutMobile');
  const chk      = document.getElementById('chkAutosyncMobile');

  if (chk) chk.checked = cloud.autosync;

  if (!statusEl || !btnIn || !btnOut) return;

  if (cloud.user) {
    statusEl.textContent = `Conectado como ${cloud.user.displayName || cloud.user.email || 'usuario'}`;
    btnIn.style.display  = 'none';
    btnOut.style.display = 'block';
  } else {
    statusEl.textContent = 'Sin conexión (inicia sesión con Google)';
    btnIn.style.display  = 'block';
    btnOut.style.display = 'none';
  }
}

function wireCloudUI() {
  const btnIn   = document.getElementById('btnSignInMobile');
  const btnOut  = document.getElementById('btnSignOutMobile');
  const btnPull = document.getElementById('btnSyncPullMobile');
  const btnPush = document.getElementById('btnSyncPushMobile');
  const chk     = document.getElementById('chkAutosyncMobile');

  if (btnIn) {
    btnIn.addEventListener('click', async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        // si Popup falla (Safari iOS, etc.) → Redirect
        await signInWithRedirect(auth, provider);
      }
    });
  }

  if (btnOut) {
    btnOut.addEventListener('click', async () => {
      try {
        await signOut(auth);
        toast('Sesión cerrada');
      } catch (e) {
        console.warn('Error al cerrar sesión', e);
      }
    });
  }

  if (btnPull) {
    btnPull.addEventListener('click', () => {
      cloudPull(true).catch(err => {
        console.error('cloudPull error', err);
        toast('Error al traer datos de la nube');
      });
    });
  }

  if (btnPush) {
    btnPush.addEventListener('click', () => {
      cloudPush().catch(err => {
        console.error('cloudPush error', err);
        toast('Error al enviar datos a la nube');
      });
    });
  }

  if (chk) {
    chk.addEventListener('change', (e) => {
      setAutosync(e.target.checked);
      toast(cloud.autosync ? 'AutoSync activado' : 'AutoSync desactivado');
    });
  }

  updateSyncUI();

  // para completar login por redirect (iOS)
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, (user) => {
    cloud.user = user || null;
    updateSyncUI();
  });
}

// ---------- Navegación botones ----------
function wireNav() {
  document.getElementById('btnGoIncome')
    ?.addEventListener('click', () => showScreen('income'));
  document.getElementById('btnGoExpense')
    ?.addEventListener('click', () => showScreen('expense'));
  document.getElementById('btnGoInvoice')
    ?.addEventListener('click', () => showScreen('invoice'));

  document.querySelectorAll('.btn-back[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-back');
      showScreen(target);
    });
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  wireNav();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  wireCloudUI();
  refreshTodaySummary();
});
