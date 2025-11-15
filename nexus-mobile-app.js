/* =========================================================
   Nexus Finance Móvil — nexus-mobile-app.js
   - Usa mismo STORAGE_KEY, estructura y Firestore que Desktop
   - KPIs: INGRESOS MES / GASTOS MES / BALANCE MES
   ========================================================= */

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
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/* ===================== Firebase ===================== */
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
enableIndexedDbPersistence(db).catch(() => {});

/* ===================== Estado compartido con Desktop ===================== */
const STORAGE_KEY = "finanzas-state-v10";   // MISMO QUE DESKTOP
const DEFAULT_STATE = {
  settings: {
    businessName: "Mi Negocio",
    logoBase64: "",
    theme: { primary: "#0B0D10", accent: "#C7A24B", text: "#F2F3F5" },
    pinHash: "",
    currency: "USD"
  },
  expensesDaily: [],
  incomesDaily: [],
  payments: [],
  ordinary: [],
  budgets: [],
  personal: [],
  invoices: [],
  quotes: [],
  reconciliations: [],
  _cloud: { updatedAt: 0 }
};

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clone = (o) => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowMs = () => Date.now();

/* -------------------- Toast simple -------------------- */
function toast(msg) {
  const t = $("#toast");
  if (!t) { console.log("[Toast]", msg); return; }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("show"), 2500);
}

/* -------------------- Utils de fechas / rangos -------------------- */
const toDate = (s) => new Date(s);
function inRange(d, from, to) {
  const t = +toDate(d || "1970-01-01");
  if (from && t < +toDate(from)) return false;
  if (to && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
}
const byDateDesc = (a, b) =>
  (+toDate(b.date || "1970-01-01")) - (+toDate(a.date || "1970-01-01"));

/* -------------------- Formato moneda ================== */
function fmt(n) {
  const cur = state.settings?.currency || "USD";
  const val = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-PR", {
      style: "currency",
      currency: cur
    }).format(val);
  } catch {
    return `${cur} ${val.toFixed(2)}`;
  }
}

/* -------------------- Carga / guardado de state ------- */
function normalizeState(raw) {
  let st = {};
  try { st = raw && typeof raw === "object" ? raw : {}; } catch { st = {}; }
  const base = clone(DEFAULT_STATE);

  // merge básico
  const merged = Object.assign(base, st);

  // asegurar arrays y settings
  const arrKeys = [
    "expensesDaily","incomesDaily","payments","ordinary",
    "budgets","personal","invoices","quotes","reconciliations"
  ];
  arrKeys.forEach(k => { if (!Array.isArray(merged[k])) merged[k] = []; });
  if (!merged.settings) merged.settings = clone(DEFAULT_STATE.settings);
  if (!merged._cloud)   merged._cloud   = { updatedAt: 0 };

  return merged;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const base = clone(DEFAULT_STATE);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
    return base;
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    const base = clone(DEFAULT_STATE);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
    return base;
  }
}

let state = loadState();

function saveState({ skipCloud = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateKPI();           // 🔁 Refrescar KPIs mes
  renderTodayInvoices(); // 🔁 Refrescar lista facturas de hoy
  if (!skipCloud && cloud.autosync && cloud.user) {
    cloudPushDebounced();
  }
}

/* -------------------- Helpers numéricos de reportes --- */
function sumRange(list, from, to) {
  if (!Array.isArray(list)) return 0;
  return list
    .filter(r => inRange(r.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumExpensesDailySplit(from, to) {
  let recurrent = 0, nonRec = 0;
  const isRec = e =>
    (e.method === "Automático") ||
    (e.desc || "").toLowerCase().startsWith("recurrente");
  state.expensesDaily
    .filter(e => inRange(e.date, from, to))
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (isRec(e)) recurrent += amt; else nonRec += amt;
    });
  return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec };
}
function sumPaymentsRange(from, to) {
  return state.payments
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumPersonalRange(from, to) {
  return state.personal
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

/* ===================== KPIs — MES (igual filosofía Desktop) ===================== */
function updateKPI() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  // INGRESOS MES
  const incMonth = sumRange(state.incomesDaily, monthStart, today);

  // GASTOS MES (operativos + personales + nómina)
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const totalExpMonth = expMonthSplit.total + perMonth + payMonth;

  // BALANCE MES
  const balanceMonth = incMonth - totalExpMonth;

  const incEl = $("#kpi-income-today");
  const expEl = $("#kpi-expenses-today");
  const balEl = $("#kpi-balance-today");

  if (incEl) incEl.textContent = fmt(incMonth);
  if (expEl) expEl.textContent = fmt(totalExpMonth);
  if (balEl) balEl.textContent = fmt(balanceMonth);
}

/* ===================== Lista: Facturas de HOY ===================== */
function renderTodayInvoices(forDate) {
  const container = $("#todayInvoices");
  if (!container) return;
  const d = forDate || todayStr();

  const list = (state.invoices || [])
    .filter(inv => inv.date === d)
    .slice()
    .sort((a, b) => (a.number || "").localeCompare(b.number || ""));

  if (!list.length) {
    container.className = "list-empty";
    container.textContent = "No hay facturas registradas hoy.";
    return;
  }

  container.className = "list-list";
  container.innerHTML = "";
  list.forEach(inv => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="li-main">
        <strong>${inv.client?.name || "Sin nombre"}</strong>
        <span>${fmt(inv.total || 0)}</span>
      </div>
      <div class="li-sub">
        <span>#${inv.number || "—"} · ${inv.method || ""}</span>
      </div>
    `;
    container.appendChild(row);
  });
}

/* ===================== Navegación entre pantallas ===================== */
function showScreen(id) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
}

function wireNavigation() {
  $("#btnGoIncome")  ?.addEventListener("click", () => showScreen("screen-income"));
  $("#btnGoExpense") ?.addEventListener("click", () => showScreen("screen-expense"));
  $("#btnGoInvoice") ?.addEventListener("click", () => showScreen("screen-invoice"));

  $$(".btn-back[data-back]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.back || "home";
      showScreen(`screen-${target}`);
    });
  });
}

/* ===================== Ingreso rápido ===================== */
function wireIncomeForm() {
  const form = $("#formIncome");
  if (!form) return;
  const dateEl = $("#incDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const date   = $("#incDateMobile")?.value || todayStr();
    const client = $("#incClientMobile")?.value || "";
    const method = $("#incMethodMobile")?.value || "";
    const amount = parseFloat($("#incAmountMobile")?.value || "0") || 0;

    if (!date) return toast("Fecha requerida");
    if (!amount) return toast("Monto requerido");

    const rec = {
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
      date,
      client,
      method,
      amount
    };
    state.incomesDaily.push(rec);
    saveState();
    toast("Ingreso guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
    showScreen("screen-home");
  });
}

/* ===================== Gasto rápido ===================== */
function wireExpenseForm() {
  const form = $("#formExpense");
  if (!form) return;
  const dateEl = $("#expDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const date     = $("#expDateMobile")?.value || todayStr();
    const category = $("#expCategoryMobile")?.value || "";
    const method   = $("#expMethodMobile")?.value || "";
    const amount   = parseFloat($("#expAmountMobile")?.value || "0") || 0;

    if (!date) return toast("Fecha requerida");
    if (!amount) return toast("Monto requerido");

    const rec = {
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
      date,
      category,
      desc: "",
      method,
      amount,
      note: ""
    };
    state.expensesDaily.push(rec);
    saveState();
    toast("Gasto guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
    showScreen("screen-home");
  });
}

/* ===================== Factura rápida ===================== */
function uidItem() {
  return Math.random().toString(36).slice(2, 7);
}

function addItemRow() {
  const container = $("#invItemsContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text"  class="item-desc" placeholder="Descripción">
    <input type="number" class="item-qty"  step="0.01" value="1">
    <input type="number" class="item-price" step="0.01" value="0">
    <input type="number" class="item-tax"   step="0.01" value="0">
    <button type="button" class="btn-outline btn-small btn-del-item">✕</button>
  `;
  container.appendChild(row);

  row.querySelector(".btn-del-item")?.addEventListener("click", () => {
    row.remove();
    recalcInvoiceTotals();
  });

  ["input", "change"].forEach(evName => {
    row.querySelectorAll("input").forEach(inp => {
      inp.addEventListener(evName, recalcInvoiceTotals);
    });
  });
}

function readItemsFromDOM() {
  const items = [];
  $$("#invItemsContainer .item-row").forEach(row => {
    const desc = row.querySelector(".item-desc")?.value || "";
    const qty  = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
    const price= parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
    const tax  = parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;
    items.push({ id: uidItem(), desc, qty, price, tax });
  });
  return items;
}

function calcTotals(items) {
  let subtotal = 0, taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const tx   = base * ((it.tax || 0) / 100);
    subtotal  += base;
    taxTotal  += tx;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function recalcInvoiceTotals() {
  const items = readItemsFromDOM();
  const { subtotal, taxTotal, total } = calcTotals(items);
  const s = $("#invSubtotalMobile");
  const t = $("#invTaxMobile");
  const g = $("#invTotalMobile");
  if (s) s.textContent = items.length ? fmt(subtotal) : "—";
  if (t) t.textContent = items.length ? fmt(taxTotal) : "—";
  if (g) g.textContent = items.length ? fmt(total) : "—";
  return { items, subtotal, taxTotal, total };
}

function saveInvoice({ openWhatsApp } = { openWhatsApp: false }) {
  const dateEl = $("#invDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  const date   = $("#invDateMobile")?.value || todayStr();
  const number = $("#invNumberMobile")?.value || "";
  const client = $("#invClientMobile")?.value || "";
  const phone  = $("#invPhoneMobile")?.value || "";
  const method = $("#invMethodMobile")?.value || "";
  const note   = $("#invNoteMobile")?.value || "";

  if (!date)   { toast("Fecha requerida"); return; }
  if (!number) { toast("# Factura requerido"); return; }

  const { items, subtotal, taxTotal, total } = recalcInvoiceTotals();
  if (!items.length) { toast("Agrega al menos un ítem"); return; }

  const inv = {
    id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    date,
    dueDate: "",
    number,
    method,
    client: {
      name:  client,
      email: "",
      phone,
      address: ""
    },
    items,
    subtotal,
    taxTotal,
    total,
    note,
    terms: ""
  };

  // Como Desktop: crear ingreso ligado a factura
  const income = {
    id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    date: inv.date,
    client: inv.client.name,
    method: inv.method,
    amount: inv.total,
    invoiceNumber: inv.number
  };
  inv.incomeId = income.id;

  state.invoices.push(inv);
  state.incomesDaily.push(income);
  saveState();
  toast("Factura guardada y registrada en Ingresos");

  // Abrir WhatsApp opcional
  if (openWhatsApp) {
    if (!phone) {
      toast("No hay teléfono de WhatsApp");
    } else {
      const msg = `Hola ${client || ""}, aquí el resumen de su factura #${number}.\nTotal: ${fmt(total)}.`;
      const cleanPhone = String(phone).replace(/[^\d]/g, "");
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    }
  }

  // limpiar formulario
  const form = $("#formInvoice");
  if (form) form.reset();
  $("#invItemsContainer") && ($("#invItemsContainer").innerHTML = "");
  recalcInvoiceTotals();
  if (dateEl) dateEl.value = todayStr();
  showScreen("screen-home");
}

function wireInvoiceForm() {
  const form = $("#formInvoice");
  if (!form) return;
  const dateEl = $("#invDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  $("#btnAddItem")?.addEventListener("click", () => {
    addItemRow();
    recalcInvoiceTotals();
  });

  $("#btnCalcInvoice")?.addEventListener("click", () => {
    recalcInvoiceTotals();
    toast("Totales calculados");
  });

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    saveInvoice({ openWhatsApp: false });
  });

  $("#btnSaveInvoiceWhatsApp")?.addEventListener("click", () => {
    saveInvoice({ openWhatsApp: true });
  });
}

/* ===================== Cloud / Firestore (mismo doc que Desktop) ===================== */
const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem("autosync") || "false"),
  unsub: null
};

function uiCloudMobile() {
  const statusEl = $("#syncStatusMobile");
  const btnIn    = $("#btnSignInMobile");
  const btnOut   = $("#btnSignOutMobile");
  const chkAuto  = $("#chkAutosyncMobile");

  if (cloud.user) {
    if (statusEl) statusEl.textContent =
      `Conectado como ${cloud.user.displayName || cloud.user.email || cloud.user.uid}`;
    if (btnIn)  btnIn.style.display  = "none";
    if (btnOut) btnOut.style.display = "inline-block";
  } else {
    if (statusEl) statusEl.textContent = "Sin conexión";
    if (btnIn)  btnIn.style.display  = "inline-block";
    if (btnOut) btnOut.style.display = "none";
  }
  if (chkAuto) chkAuto.checked = !!cloud.autosync;
}

function setAutosyncMobile(v) {
  cloud.autosync = !!v;
  localStorage.setItem("autosync", JSON.stringify(cloud.autosync));
  uiCloudMobile();
}

function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}

async function cloudPullMobile(replace = true) {
  const ref = cloudDocRef();
  if (!ref) { toast("Inicia sesión primero"); return; }
  const snap = await getDoc(ref);
  if (!snap.exists()) { toast("No hay datos en la nube"); return; }

  const remote = snap.data();
  const rU = remote?._cloud?.updatedAt || 0;
  const lU = state?._cloud?.updatedAt || 0;

  if (replace || rU >= lU) {
    state = normalizeState(remote);
  } else {
    // merge suave
    const arrKeys = [
      "expensesDaily","incomesDaily","payments","ordinary",
      "budgets","personal","invoices","quotes","reconciliations"
    ];
    state.settings = Object.assign({}, state.settings, remote.settings || {});
    arrKeys.forEach(k => {
      if (Array.isArray(remote[k])) {
        state[k] = (state[k] || []).concat(remote[k]);
      }
    });
    state._cloud.updatedAt = Math.max(lU, rU);
  }
  saveState({ skipCloud: true });
  toast("Datos cargados desde la nube");
}

async function cloudPushMobile() {
  const ref = cloudDocRef();
  if (!ref) { toast("Inicia sesión primero"); return; }
  state._cloud.updatedAt = nowMs();
  await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge: true });
  saveState({ skipCloud: true });
  toast("Datos enviados a la nube");
}

let pushTimer;
function cloudPushDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPushMobile, 600);
}

function cloudSubscribeMobile() {
  if (!cloud.user) return;
  const ref = cloudDocRef();
  cloud.unsub?.();
  cloud.unsub = onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    const remote = snap.data();
    if ((remote?._cloud?.updatedAt || 0) > (state?._cloud?.updatedAt || 0)) {
      state = normalizeState(remote);
      saveState({ skipCloud: true });
      toast("Actualizado desde la nube");
    }
  });
}

function wireCloudUI() {
  const provider = new GoogleAuthProvider();

  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      try { await signInWithRedirect(auth, provider); }
      catch { toast("Error al iniciar sesión"); }
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    try { await signOut(auth); } catch { /* ignore */ }
  });

  $("#btnSyncPullMobile")?.addEventListener("click", () => cloudPullMobile(true));
  $("#btnSyncPushMobile")?.addEventListener("click", () => cloudPushMobile());
  $("#chkAutosyncMobile")?.addEventListener("change", e => {
    setAutosyncMobile(e.target.checked);
  });

  uiCloudMobile();
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, user => {
    cloud.user = user || null;
    uiCloudMobile();
    if (user) {
      cloudSubscribeMobile();
    } else {
      cloud.unsub?.();
      cloud.unsub = null;
    }
  });
}

/* ===================== Arranque ===================== */
function initMobileApp() {
  wireNavigation();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  wireCloudUI();
  updateKPI();
  renderTodayInvoices();
  showScreen("screen-home");
  // por si vienes de un estado raro
  setTimeout(() => {
    updateKPI();
    renderTodayInvoices();
  }, 200);
}

// Exponer para debug si quieres
window.NexusMobile = {
  getState: () => state,
  saveState,
  updateKPI,
  renderTodayInvoices,
  cloudPullMobile,
  cloudPushMobile
};

document.addEventListener("DOMContentLoaded", initMobileApp);
