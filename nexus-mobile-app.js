// ======================================================
// Nexus Finance Móvil
// - Lee y escribe el MISMO state que la versión Desktop
// - No borra la BD al iniciar
// - Balance del mes = Ingresos (Mes) - Gastos (Mes) igual que Desktop
// - Quick ingreso / gasto / factura desde el teléfono
// ======================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ======== Firebase config (el mismo de Desktop) ========
const firebaseConfig = {
  apiKey: "AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE",
  authDomain: "finanzas-web-f4e05.firebaseapp.com",
  projectId: "finanzas-web-f4e05",
  storageBucket: "finanzas-web-f4e05.firebasestorage.app",
  messagingSenderId: "1047152523619",
  appId: "1:1047152523619:web:7d8f7d1f7a5ccc6090bb56"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db   = getFirestore(fbApp);

// ======================================================
// Estado COMPATIBLE con Desktop
// ======================================================

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

const MOBILE_CACHE_KEY   = "finanzas-mobile-cache-v1";
const MOBILE_AUTOSYNC_KEY = "finanzas-mobile-autosync";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clone = (obj) => JSON.parse(JSON.stringify(obj));
const todayStr = () => new Date().toISOString().slice(0, 10);
const toDate   = (s) => new Date(s || "1970-01-01");
const inRange = (d, from, to) => {
  const t = +toDate(d);
  if (from && t < +toDate(from)) return false;
  if (to && t > +toDate(to) + 86400000 - 1) return false;
  return true;
};

let state = clone(DEFAULT_STATE);   // Se sobreescribe al leer de la nube
let cloud  = {
  user: null,
  autosync: JSON.parse(localStorage.getItem(MOBILE_AUTOSYNC_KEY) || "false"),
  ready: false,     // true cuando YA leyó una vez desde la nube
  unsub: null
};

// ======================================================
// Toast
// ======================================================
function toast(msg) {
  const el = $("#toast");
  if (!el) { console.log("[Toast]", msg); return; }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

// ======================================================
// Formato moneda (igual que Desktop: es-PR)
// ======================================================
function fmt(n) {
  const cur = state?.settings?.currency || "USD";
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

// ======================================================
// Helpers de sumas (copiados de Desktop)
// ======================================================
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

// ======================================================
// UI: Header (nombre y logo) + KPIs
// ======================================================
function renderHeader() {
  const name = state.settings?.businessName || "Nexus Finance";
  const logo = state.settings?.logoBase64 || "assets/logo.png";

  const brandTitle = $(".brand-title");
  const brandSub   = $(".brand-sub");
  const logoImg    = $(".brand-logo");

  if (brandTitle) brandTitle.textContent = name;
  if (brandSub)   brandSub.textContent   = "Panel rápido móvil";
  if (logoImg)    logoImg.src            = logo;
}

function renderKPIs() {
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  // Ingresos hoy (solo incomesDaily)
  const incToday = sumRange(state.incomesDaily, today, today);

  // Gastos hoy (solo expensesDaily – seguimos como lo tenías en móvil)
  const expToday = state.expensesDaily
    .filter((e) => inRange(e.date, today, today))
    .reduce((a, b) => a + Number(b.amount || 0), 0);

  // ===== Balance del MES, igual que Desktop =====
  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const expMonth = expMonthSplit.total + perMonth + payMonth;
  const balanceMonth = incMonth - expMonth; // MISMA fórmula que Desktop

  $("#kpi-income-today")  && ($("#kpi-income-today").textContent  = fmt(incToday));
  $("#kpi-expenses-today")&& ($("#kpi-expenses-today").textContent= fmt(expToday));
  $("#kpi-balance-today") && ($("#kpi-balance-today").textContent = fmt(balanceMonth));
}

// ======================================================
// UI: facturas de hoy
// ======================================================
function renderTodayInvoices() {
  const container = $("#todayInvoices");
  if (!container) return;

  const today = todayStr();
  const todays = (state.invoices || []).filter((inv) =>
    inRange(inv.date, today, today)
  );

  if (!todays.length) {
    container.classList.add("list-empty");
    container.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  container.classList.remove("list-empty");
  container.innerHTML = "";

  todays
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((inv) => {
      const div = document.createElement("div");
      div.className = "invoice-row";
      const client = inv.client?.name || "Sin cliente";
      div.innerHTML = `
        <div class="invoice-main">
          <span class="inv-number">${inv.number || "—"}</span>
          <span class="inv-client">${client}</span>
        </div>
        <div class="invoice-amount">${fmt(inv.total || 0)}</div>
      `;
      container.appendChild(div);
    });
}

// ======================================================
// Navegación entre pantallas móviles
// ======================================================
function showScreen(id) {
  $$(".screen").forEach((s) => {
    if (s.id === `screen-${id}`) s.classList.add("active");
    else s.classList.remove("active");
  });
}

function setupNavigation() {
  $("#btnGoIncome")  ?.addEventListener("click", () => {
    $("#incDateMobile").value = todayStr();
    showScreen("income");
  });

  $("#btnGoExpense") ?.addEventListener("click", () => {
    $("#expDateMobile").value = todayStr();
    showScreen("expense");
  });

  $("#btnGoInvoice") ?.addEventListener("click", () => {
    $("#invDateMobile").value = todayStr();
    resetInvoiceFormTotals();
    showScreen("invoice");
  });

  $$(".btn-back").forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back || "home"));
  });
}

// ======================================================
// Guardar LOCAL + disparar envio a la nube (si aplica)
// ======================================================
function saveLocal() {
  try {
    localStorage.setItem(MOBILE_CACHE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("No se pudo guardar cache móvil:", e);
  }
}

let pushTimer = null;
function pushCloudDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToCloud, 600);
}

function saveAndRefresh() {
  saveLocal();
  renderHeader();
  renderKPIs();
  renderTodayInvoices();

  if (cloud.autosync && cloud.user && cloud.ready) {
    pushCloudDebounced();
  }
}

// ======================================================
// Firebase: Cloud Sync (mismo doc que Desktop)
// ======================================================
function userDocRef() {
  if (!cloud.user) return null;
  // Mismo path de Desktop: users/<uid>/state/app
  return doc(db, "users", cloud.user.uid, "state", "app");
}

async function pullFromCloud({ silent = false } = {}) {
  const ref = userDocRef();
  if (!ref) {
    if (!silent) toast("Inicia sesión con Google primero.");
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    if (!silent) {
      toast("No hay datos en la nube. Usa la versión Desktop para subirlos primero.");
    }
    cloud.ready = false;
    return;
  }
  const remote = snap.data();
  state = remote || clone(DEFAULT_STATE);
  cloud.ready = true;
  saveAndRefresh();
  if (!silent) toast("Datos cargados desde la nube.");
}

async function pushToCloud() {
  const ref = userDocRef();
  if (!ref) {
    toast("Inicia sesión con Google primero.");
    return;
  }
  if (!cloud.ready) {
    // Protección: no sobre-escribir si nunca se ha hecho un pull
    toast("Primero trae los datos de la nube (para evitar sobrescribir).");
    return;
  }
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = Date.now();
  await setDoc(
    ref,
    { ...state, _serverUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  toast("Datos enviados a la nube.");
}

function startCloudListener() {
  const ref = userDocRef();
  if (!ref) return;
  cloud.unsub?.();
  cloud.unsub = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const remote = snap.data();
    // Si remote es más nuevo que local, lo aplicamos
    const rU = remote?._cloud?.updatedAt || 0;
    const lU = state?._cloud?.updatedAt || 0;
    if (rU > lU) {
      state = remote;
      cloud.ready = true;
      saveAndRefresh();
      toast("Actualizado desde la nube.");
    }
  });
}

function updateCloudUI() {
  const status = $("#syncStatusMobile");
  const signInBtn  = $("#btnSignInMobile");
  const signOutBtn = $("#btnSignOutMobile");
  const chkAuto    = $("#chkAutosyncMobile");

  if (cloud.user) {
    if (status)
      status.textContent =
        "Conectado como " +
        (cloud.user.displayName || cloud.user.email || cloud.user.uid);
    if (signInBtn)  signInBtn.style.display = "none";
    if (signOutBtn) signOutBtn.style.display = "block";
  } else {
    if (status) status.textContent = "Sin conexión";
    if (signInBtn)  signInBtn.style.display = "block";
    if (signOutBtn) signOutBtn.style.display = "none";
  }

  if (chkAuto) chkAuto.checked = cloud.autosync;
}

function setupCloudButtons() {
  const provider = new GoogleAuthProvider();

  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      toast("No se pudo iniciar sesión.");
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      cloud.user = null;
      cloud.ready = false;
      cloud.unsub?.();
      cloud.unsub = null;
      updateCloudUI();
      toast("Sesión cerrada.");
    } catch (e) {
      console.error(e);
      toast("No se pudo cerrar sesión.");
    }
  });

  $("#btnSyncPullMobile")?.addEventListener("click", () => {
    pullFromCloud({ silent: false }).catch((e) => {
      console.error(e);
      toast("Error al traer datos.");
    });
  });

  $("#btnSyncPushMobile")?.addEventListener("click", () => {
    pushToCloud().catch((e) => {
      console.error(e);
      toast("Error al enviar datos.");
    });
  });

  $("#chkAutosyncMobile")?.addEventListener("change", (ev) => {
    cloud.autosync = !!ev.target.checked;
    localStorage.setItem(MOBILE_AUTOSYNC_KEY, JSON.stringify(cloud.autosync));
  });
}

// ======================================================
// Quick Ingreso / Gasto
// ======================================================
function setupQuickIncome() {
  const form = $("#formIncome");
  if (!form) return;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const rec = {
      id: Math.random().toString(36).slice(2, 9),
      date: $("#incDateMobile").value || todayStr(),
      client: $("#incClientMobile").value || "Sin cliente",
      method: $("#incMethodMobile").value || "Efectivo",
      amount: Number($("#incAmountMobile").value || 0)
    };
    if (!rec.date || !rec.amount) {
      toast("Fecha y monto son requeridos.");
      return;
    }
    state.incomesDaily.push(rec);
    form.reset();
    $("#incDateMobile").value = todayStr();
    saveAndRefresh();
    toast("Ingreso guardado.");
    showScreen("home");
  });
}

function setupQuickExpense() {
  const form = $("#formExpense");
  if (!form) return;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const rec = {
      id: Math.random().toString(36).slice(2, 9),
      date: $("#expDateMobile").value || todayStr(),
      category: $("#expCategoryMobile").value || "Gasto",
      desc: $("#expCategoryMobile").value || "Gasto móvil",
      method: $("#expMethodMobile").value || "Efectivo",
      amount: Number($("#expAmountMobile").value || 0),
      note: ""
    };
    if (!rec.date || !rec.amount) {
      toast("Fecha y monto son requeridos.");
      return;
    }
    state.expensesDaily.push(rec);
    form.reset();
    $("#expDateMobile").value = todayStr();
    saveAndRefresh();
    toast("Gasto guardado.");
    showScreen("home");
  });
}

// ======================================================
// Factura rápida + WhatsApp
// ======================================================
function createItemRow() {
  const div = document.createElement("div");
  div.className = "item-row";
  div.innerHTML = `
    <input type="text"  class="item-desc"  placeholder="Descripción">
    <input type="number" step="0.01" class="item-qty"   value="1">
    <input type="number" step="0.01" class="item-price" value="0">
    <input type="number" step="0.01" class="item-tax"   value="0">
    <button type="button" class="btn-outline btn-small btnDelItem">✕</button>
  `;
  div.querySelector(".btnDelItem").addEventListener("click", () => div.remove());
  return div;
}

function readItemsFromUI() {
  const rows = $$(".item-row", $("#invItemsContainer"));
  const items = [];
  rows.forEach((r) => {
    const desc  = r.querySelector(".item-desc")?.value || "";
    const qty   = parseFloat(r.querySelector(".item-qty")?.value || "0") || 0;
    const price = parseFloat(r.querySelector(".item-price")?.value || "0") || 0;
    const tax   = parseFloat(r.querySelector(".item-tax")?.value || "0") || 0;
    items.push({
      id: Math.random().toString(36).slice(2, 7),
      desc,
      qty,
      price,
      tax
    });
  });
  return items;
}

function calcTotals(items) {
  let subtotal = 0;
  let taxTotal = 0;
  items.forEach((it) => {
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tax;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function resetInvoiceFormTotals() {
  $("#invSubtotalMobile") && ($("#invSubtotalMobile").textContent = "—");
  $("#invTaxMobile")      && ($("#invTaxMobile").textContent      = "—");
  $("#invTotalMobile")    && ($("#invTotalMobile").textContent    = "—");
  const cont = $("#invItemsContainer");
  if (cont) {
    cont.innerHTML = "";
    cont.appendChild(createItemRow());
  }
}

function setupInvoiceForm() {
  const btnAddItem = $("#btnAddItem");
  const btnCalc    = $("#btnCalcInvoice");
  const btnSave    = $("#btnSaveInvoice");
  const btnSaveWA  = $("#btnSaveInvoiceWhatsApp");
  const form       = $("#formInvoice");

  if (btnAddItem) {
    btnAddItem.addEventListener("click", () => {
      $("#invItemsContainer").appendChild(createItemRow());
    });
  }

  function computeAndPaintTotals() {
    const items = readItemsFromUI();
    const t = calcTotals(items);
    $("#invSubtotalMobile").textContent = fmt(t.subtotal);
    $("#invTaxMobile").textContent      = fmt(t.taxTotal);
    $("#invTotalMobile").textContent    = fmt(t.total);
    return t;
  }

  if (btnCalc) btnCalc.addEventListener("click", computeAndPaintTotals);

  function saveInvoice({ openWhatsApp } = { openWhatsApp: false }) {
    const items = readItemsFromUI();
    const t = calcTotals(items);
    const date   = $("#invDateMobile").value || todayStr();
    const number = $("#invNumberMobile").value || "";
    const client = $("#invClientMobile").value || "Sin cliente";
    const phone  = $("#invPhoneMobile").value || "";
    const method = $("#invMethodMobile").value || "Efectivo";
    const note   = $("#invNoteMobile").value || "";

    if (!date || !number) {
      toast("Fecha y # de factura son requeridos.");
      return;
    }

    // Creamos ingreso automático igual que Desktop
    const income = {
      id: Math.random().toString(36).slice(2, 9),
      date,
      client,
      method,
      amount: t.total,
      invoiceNumber: number
    };

    const inv = {
      id: Math.random().toString(36).slice(2, 9),
      date,
      dueDate: "",
      number,
      method,
      client: { name: client, email: "", phone, address: "" },
      items,
      subtotal: t.subtotal,
      taxTotal: t.taxTotal,
      total: t.total,
      note,
      terms: "",
      incomeId: income.id
    };

    state.incomesDaily.push(income);
    state.invoices.push(inv);
    saveAndRefresh();
    toast("Factura guardada.");

    if (openWhatsApp && phone) {
      const business = state.settings?.businessName || "Mi Negocio";
      const mensaje =
        `Saludos ${client},\n` +
        `Aquí el detalle de su factura #${number} de ${business}:\n` +
        `TOTAL: ${fmt(t.total)}\n` +
        `Gracias por su preferencia.`;
      const url =
        "https://wa.me/" +
        encodeURIComponent(phone.replace(/\D/g, "")) +
        "?text=" +
        encodeURIComponent(mensaje);
      window.open(url, "_blank");
    }

    form.reset();
    $("#invDateMobile").value = todayStr();
    resetInvoiceFormTotals();
    showScreen("home");
  }

  if (btnSave)
    btnSave.addEventListener("click", (e) => {
      e.preventDefault();
      saveInvoice({ openWhatsApp: false });
    });
  if (btnSaveWA)
    btnSaveWA.addEventListener("click", (e) => {
      e.preventDefault();
      saveInvoice({ openWhatsApp: true });
    });
}

// ======================================================
// Arranque
// ======================================================
function initFromCache() {
  try {
    const raw = localStorage.getItem(MOBILE_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && typeof cached === "object") {
        state = cached;
      }
    }
  } catch (e) {
    console.warn("No se pudo leer cache móvil:", e);
  }
}

function init() {
  initFromCache();
  renderHeader();
  renderKPIs();
  renderTodayInvoices();
  setupNavigation();
  setupCloudButtons();
  setupQuickIncome();
  setupQuickExpense();
  setupInvoiceForm();

  updateCloudUI();

  onAuthStateChanged(auth, async (user) => {
    cloud.user = user || null;
    updateCloudUI();
    if (user) {
      // Al conectar, TRAEMOS primero para no sobre-escribir
      try {
        await pullFromCloud({ silent: true });
        cloud.ready = true;
        startCloudListener();
      } catch (e) {
        console.error(e);
      }
    } else {
      cloud.ready = false;
      cloud.unsub?.();
      cloud.unsub = null;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
