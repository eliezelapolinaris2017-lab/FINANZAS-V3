/* =========================================================
   Nexus Finance Móvil — nexus-mobile-app.js
   - Comparte estado con Desktop (STORAGE_KEY v10)
   - Firebase mismo proyecto / mismo doc
   - KPIs: Ingresos MES / Gastos MES / Balance MES
   - Ingreso rápido, Gasto rápido, Nueva factura
   ========================================================= */

/* ===================== Firebase ===================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot,
  serverTimestamp, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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

/* ===================== Estado compartido ===================== */
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

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clone = (o) => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowMs = () => Date.now();
const toDate = (s) => new Date(s);
function inRange(d, from, to) {
  const t = +toDate(d || "1970-01-01");
  if (from && t < +toDate(from)) return false;
  if (to && t > +toDate(to) + 86400000 - 1) return false;
  return true;
}
const byDateDesc = (a, b) =>
  +toDate(b.date || "1970-01-01") - +toDate(a.date || "1970-01-01");
const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const uidItem = () => Math.random().toString(36).slice(2, 7);

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE));
    return clone(DEFAULT_STATE);
  }
  try {
    const st = JSON.parse(raw);
    for (const k of Object.keys(DEFAULT_STATE)) {
      if (!(k in st)) st[k] = clone(DEFAULT_STATE[k]);
    }
    return st;
  } catch {
    return clone(DEFAULT_STATE);
  }
}
let state = loadState();

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

/* ===================== Toast simple ===================== */
function toast(msg) {
  const el = $("#toast");
  if (!el) {
    console.log("[Toast]", msg);
    return;
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2500);
}

/* ===================== Sumas (misma lógica que Desktop) ===================== */
function sumRange(list, from, to) {
  if (!Array.isArray(list)) return 0;
  return list
    .filter((r) => inRange(r.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumExpensesDailySplit(from, to) {
  let recurrent = 0,
    nonRec = 0;
  const isRec = (e) =>
    e.method === "Automático" ||
    (e.desc || "").toLowerCase().startsWith("recurrente");
  state.expensesDaily
    .filter((e) => inRange(e.date, from, to))
    .forEach((e) => {
      const amt = Number(e.amount || 0);
      if (isRec(e)) recurrent += amt;
      else nonRec += amt;
    });
  return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec };
}
function sumPaymentsRange(from, to) {
  return state.payments
    .filter((p) => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumPersonalRange(from, to) {
  return state.personal
    .filter((p) => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

/* ===================== Guardar + AutoSync ===================== */
const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem("autosync") || "false"),
  unsub: null
};

function saveState({ skipCloud = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderKPIsMonth();
  renderTodayInvoices();
  if (!skipCloud && cloud.autosync && cloud.user) {
    cloudPushDebounced();
  }
}

/* ===================== KPI Home (MES, igual Desktop) ===================== */
function renderKPIsMonth() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  )
    .toISOString()
    .slice(0, 10);

  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const totalExpMonth = expMonthSplit.total + perMonth + payMonth;
  const balanceMonth = incMonth - totalExpMonth;

  const incEl = $("#kpi-income-today");
  const expEl = $("#kpi-expenses-today");
  const balEl = $("#kpi-balance-today");

  if (incEl) incEl.textContent = fmt(incMonth);
  if (expEl) expEl.textContent = fmt(totalExpMonth);
  if (balEl) balEl.textContent = fmt(balanceMonth);
}

/* ===================== Facturas de HOY (lista) ===================== */
function renderTodayInvoices() {
  const wrap = $("#todayInvoices");
  if (!wrap) return;

  const today = todayStr();
  const list = (state.invoices || [])
    .filter((inv) => inv.date === today)
    .sort(byDateDesc);

  if (!list.length) {
    wrap.classList.add("list-empty");
    wrap.textContent = "No hay facturas registradas hoy.";
    return;
  }

  wrap.classList.remove("list-empty");
  wrap.innerHTML = "";
  list.forEach((inv) => {
    const div = document.createElement("div");
    div.className = "today-invoice";
    div.innerHTML = `
      <div class="ti-main">
        <span class="ti-client">${inv.client?.name || "Sin nombre"}</span>
        <span class="ti-total">${fmt(inv.total || 0)}</span>
      </div>
      <div class="ti-sub">
        <span>#${inv.number || "—"}</span>
        <span>${inv.method || ""}</span>
      </div>
    `;
    wrap.appendChild(div);
  });
}

/* ===================== Quick forms: Ingreso / Gasto ===================== */
function wireQuickIncome() {
  const form = $("#formIncome");
  if (!form) return;
  const dateEl = $("#incDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const date = dateEl?.value || todayStr();
    const client = $("#incClientMobile")?.value || "";
    const method = $("#incMethodMobile")?.value || "";
    const amount = Number($("#incAmountMobile")?.value || 0);

    if (!date) return toast("Fecha requerida");
    if (!amount) return toast("Monto requerido");

    const rec = {
      id: uid(),
      date,
      client,
      method,
      amount
    };
    state.incomesDaily.push(rec);
    saveState();
    form.reset();
    if (dateEl) dateEl.value = todayStr();
    toast("Ingreso guardado");
    renderKPIsMonth();
  });
}

function wireQuickExpense() {
  const form = $("#formExpense");
  if (!form) return;
  const dateEl = $("#expDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const date = dateEl?.value || todayStr();
    const category = $("#expCategoryMobile")?.value || "";
    const method = $("#expMethodMobile")?.value || "";
    const amount = Number($("#expAmountMobile")?.value || 0);

    if (!date) return toast("Fecha requerida");
    if (!amount) return toast("Monto requerido");

    const rec = {
      id: uid(),
      date,
      category,
      desc: category,
      method,
      amount,
      note: ""
    };
    state.expensesDaily.push(rec);
    saveState();
    form.reset();
    if (dateEl) dateEl.value = todayStr();
    toast("Gasto guardado");
    renderKPIsMonth();
  });
}

/* ===================== Items factura (MÓVIL) ===================== */
function addItemRowMobile() {
  const container = $("#invItemsContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text" class="item-desc" placeholder="Descripción">
    <input type="number" step="0.01" class="item-qty"   value="1">
    <input type="number" step="0.01" class="item-price" value="0">
    <input type="number" step="0.01" class="item-tax"   value="0">
    <button type="button" class="btn-outline btn-small btn-del-item">✕</button>
  `;
  container.appendChild(row);

  const del = row.querySelector(".btn-del-item");
  if (del) {
    del.addEventListener("click", () => {
      row.remove();
      calcInvoiceTotalsMobile();
    });
  }
  ["item-qty", "item-price", "item-tax"].forEach((cls) => {
    const inp = row.querySelector("." + cls);
    if (inp) inp.addEventListener("input", calcInvoiceTotalsMobile);
  });
}

function readItemsFromContainer() {
  const container = $("#invItemsContainer");
  const items = [];
  if (!container) return items;
  container.querySelectorAll(".item-row").forEach((row) => {
    const desc = row.querySelector(".item-desc")?.value || "";
    const qty =
      parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
    const price =
      parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
    const tax =
      parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;
    items.push({ id: uidItem(), desc, qty, price, tax });
  });
  return items;
}
function calcTotals(items) {
  let subtotal = 0,
    taxTotal = 0;
  items.forEach((it) => {
    const base = (it.qty || 0) * (it.price || 0);
    const tax = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tax;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}
function calcInvoiceTotalsMobile() {
  const items = readItemsFromContainer();
  const t = calcTotals(items);
  const subEl = $("#invSubtotalMobile");
  const taxEl = $("#invTaxMobile");
  const totEl = $("#invTotalMobile");
  if (subEl) subEl.textContent = items.length ? fmt(t.subtotal) : "—";
  if (taxEl) taxEl.textContent = items.length ? fmt(t.taxTotal) : "—";
  if (totEl) totEl.textContent = items.length ? fmt(t.total) : "—";
  return t;
}

/* ===================== Factura móvil ===================== */
function openWhatsAppForInvoice(inv) {
  const rawPhone = $("#invPhoneMobile")?.value || "";
  const phone = rawPhone.replace(/[^\d]/g, "");
  if (!phone) {
    toast("Número de WhatsApp requerido");
    return;
  }
  const msg = `Hola ${inv.client?.name || ""}, aquí el detalle de su factura #${
    inv.number || ""
  } por ${fmt(inv.total || 0)}.`;
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

function wireInvoiceMobile() {
  const form = $("#formInvoice");
  if (!form) return;

  const dateEl = $("#invDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  const btnAddItem = $("#btnAddItem");
  if (btnAddItem) btnAddItem.addEventListener("click", () => {
    addItemRowMobile();
  });

  const btnCalc = $("#btnCalcInvoice");
  if (btnCalc) btnCalc.addEventListener("click", (e) => {
    e.preventDefault();
    calcInvoiceTotalsMobile();
  });

  // Asegurar al menos 1 fila al abrir
  if (!$("#invItemsContainer")?.querySelector(".item-row")) {
    addItemRowMobile();
  }

  function saveInvoice({ openWhats = false } = {}) {
    const date = dateEl?.value || todayStr();
    const number = $("#invNumberMobile")?.value.trim();
    const method = $("#invMethodMobile")?.value || "";
    const clientName = $("#invClientMobile")?.value || "";
    const phone = $("#invPhoneMobile")?.value || "";
    const note = $("#invNoteMobile")?.value || "";

    if (!date) return toast("Fecha requerida");
    if (!number) return toast("Número de factura requerido");

    const items = readItemsFromContainer();
    if (!items.length) return toast("Agrega al menos un ítem");

    const totals = calcInvoiceTotalsMobile();

    const inv = {
      id: uid(),
      date,
      dueDate: "",
      number,
      method,
      client: {
        name: clientName,
        email: "",
        phone,
        address: ""
      },
      items,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      note,
      terms: ""
    };

    const income = {
      id: uid(),
      date,
      client: clientName,
      method,
      amount: totals.total,
      invoiceNumber: number
    };

    state.incomesDaily.push(income);
    inv.incomeId = income.id;
    state.invoices.push(inv);
    saveState();

    toast("Factura guardada");
    renderTodayInvoices();
    renderKPIsMonth();

    if (openWhats) {
      openWhatsAppForInvoice(inv);
    }

    form.reset();
    if (dateEl) dateEl.value = todayStr();
    const cont = $("#invItemsContainer");
    if (cont) cont.innerHTML = "";
    addItemRowMobile();
    $("#invSubtotalMobile").textContent = "—";
    $("#invTaxMobile").textContent = "—";
    $("#invTotalMobile").textContent = "—";
    showScreen("screen-home");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveInvoice({ openWhats: false });
  });

  const btnSaveWhats = $("#btnSaveInvoiceWhatsApp");
  if (btnSaveWhats) {
    btnSaveWhats.addEventListener("click", (e) => {
      e.preventDefault();
      saveInvoice({ openWhats: true });
    });
  }
}

/* ===================== Navegación de pantallas ===================== */
function showScreen(id) {
  $$(".screen").forEach((s) => {
    s.classList.toggle("active", s.id === id);
  });
  window.scrollTo(0, 0);
}
function wireNavigation() {
  $("#btnGoIncome")?.addEventListener("click", () => {
    showScreen("screen-income");
    const d = $("#incDateMobile");
    if (d && !d.value) d.value = todayStr();
  });
  $("#btnGoExpense")?.addEventListener("click", () => {
    showScreen("screen-expense");
    const d = $("#expDateMobile");
    if (d && !d.value) d.value = todayStr();
  });
  $("#btnGoInvoice")?.addEventListener("click", () => {
    showScreen("screen-invoice");
    const d = $("#invDateMobile");
    if (d && !d.value) d.value = todayStr();
  });

  $$(".btn-back[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.back || "home";
      showScreen(`screen-${target}`);
    });
  });
}

/* ===================== Cloud / Firebase Sync (igual doc que Desktop) ===================== */
function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}
function uiCloudMobile() {
  const st = $("#syncStatusMobile");
  if (st) {
    st.textContent = cloud.user
      ? `Conectado como ${cloud.user.displayName || cloud.user.email || cloud.user.uid}`
      : "Sin conexión";
  }
  const signInBtn = $("#btnSignInMobile");
  const signOutBtn = $("#btnSignOutMobile");
  if (signInBtn) signInBtn.style.display = cloud.user ? "none" : "block";
  if (signOutBtn) signOutBtn.style.display = cloud.user ? "block" : "none";

  const chk = $("#chkAutosyncMobile");
  if (chk) chk.checked = !!cloud.autosync;
}
function setAutosyncMobile(v) {
  cloud.autosync = !!v;
  localStorage.setItem("autosync", JSON.stringify(cloud.autosync));
  uiCloudMobile();
}

async function cloudPull(replace = true) {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Inicia sesión primero");
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("No hay datos en la nube");
    return;
  }
  const remote = snap.data();
  const rU = remote?._cloud?.updatedAt || 0;
  const lU = state?._cloud?.updatedAt || 0;

  if (replace || rU >= lU) {
    state = remote;
  } else {
    state.settings = Object.assign({}, state.settings, remote.settings || {});
    [
      "expensesDaily",
      "incomesDaily",
      "payments",
      "ordinary",
      "budgets",
      "personal",
      "invoices",
      "quotes",
      "reconciliations"
    ].forEach((k) => {
      if (Array.isArray(remote[k])) state[k] = state[k].concat(remote[k]);
    });
    state._cloud = state._cloud || {};
    state._cloud.updatedAt = Math.max(lU, rU);
  }
  saveState({ skipCloud: true });
  toast("Datos cargados desde la nube");
  renderKPIsMonth();
  renderTodayInvoices();
}

async function cloudPush() {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Inicia sesión primero");
    return;
  }
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = nowMs();
  await setDoc(
    ref,
    { ...state, _serverUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  saveState({ skipCloud: true });
  toast("Datos guardados en la nube");
}

let pushTimer;
function cloudPushDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPush, 600);
}
function cloudSubscribe() {
  if (!cloud.user) return;
  const ref = cloudDocRef();
  cloud.unsub?.();
  cloud.unsub = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const remote = snap.data();
    if ((remote?._cloud?.updatedAt || 0) > (state?._cloud?.updatedAt || 0)) {
      state = remote;
      saveState({ skipCloud: true });
      toast("Actualizado desde la nube");
      renderKPIsMonth();
      renderTodayInvoices();
    }
  });
}

function wireCloudMobile() {
  const provider = new GoogleAuthProvider();

  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      await signInWithRedirect(auth, provider);
    }
  });
  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    await signOut(auth);
  });
  $("#btnSyncPullMobile")?.addEventListener("click", () => cloudPull(true));
  $("#btnSyncPushMobile")?.addEventListener("click", () => cloudPush());
  $("#chkAutosyncMobile")?.addEventListener("change", (e) =>
    setAutosyncMobile(e.target.checked)
  );

  uiCloudMobile();
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, (user) => {
    cloud.user = user || null;
    uiCloudMobile();
    if (user) {
      cloudSubscribe();
    } else {
      cloud.unsub?.();
      cloud.unsub = null;
    }
  });
}

/* ===================== INIT ===================== */
function initMobileApp() {
  // estado ya cargado arriba
  wireNavigation();
  wireQuickIncome();
  wireQuickExpense();
  wireInvoiceMobile();
  wireCloudMobile();

  renderKPIsMonth();
  renderTodayInvoices();
}

document.addEventListener("DOMContentLoaded", initMobileApp);

// Opcional para consola
window.nexusMobile = {
  get state() { return state; },
  cloudPull,
  cloudPush,
  renderKPIsMonth
};
