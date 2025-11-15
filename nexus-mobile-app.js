// =========================================================
// Nexus Finance Móvil
// - Lee y escribe DIRECTO en Firestore (misma data que Desktop)
// - Sin usar localStorage para datos (solo para la preferencia de AutoSync)
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ===== Firebase (MISMO PROYECTO QUE NEXUS DESKTOP) ==================
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

// Cache offline (igual que Desktop)
enableIndexedDbPersistence(db).catch(() => {});

// ===== Helpers UI ========================================
const $  = (sel, r = document) => r.querySelector(sel);
const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));

const todayStr = () => new Date().toISOString().slice(0, 10);
const nowMs    = () => Date.now();

function toast(msg) {
  const el = $("#toast");
  if (!el) { console.log("[Toast]", msg); return; }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function fmtCurrency(n, currency = "USD") {
  const val = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-PR", {
      style: "currency",
      currency
    }).format(val);
  } catch {
    return `${currency} ${val.toFixed(2)}`;
  }
}

// ===== Estado en memoria (MISMOS CAMPOS QUE NEXUS DESKTOP) =========
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

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

let cloudUser = null;   // usuario autenticado
let state     = clone(DEFAULT_STATE); // se sobrescribe con Firestore
let unsubSnap = null;

// ====== Firestore helpers ==========================================
function ensureStateStructure(raw) {
  let s = raw && typeof raw === "object" ? raw : {};
  // completar llaves que falten para ser compatible con Desktop
  for (const [k, defVal] of Object.entries(DEFAULT_STATE)) {
    if (!(k in s)) {
      s[k] = Array.isArray(defVal) ? [] : clone(defVal);
    }
  }
  s._cloud = s._cloud || { updatedAt: 0 };
  return s;
}

function userDocRef() {
  if (!cloudUser) return null;
  return doc(db, "users", cloudUser.uid, "state", "app");
}

async function pushStateToCloud(reason = "Datos guardados en la nube") {
  const ref = userDocRef();
  if (!ref) {
    toast("Inicia sesión con Google primero");
    return;
  }
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = nowMs();

  await setDoc(
    ref,
    { ...state, _serverUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  toast(reason);
}

async function manualPullFromCloud() {
  const ref = userDocRef();
  if (!ref) {
    toast("Inicia sesión con Google primero");
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("No hay datos guardados en la nube todavía");
    return;
  }
  state = ensureStateStructure(snap.data());
  renderAll();
  toast("Datos cargados desde la nube");
}

// ===== Cálculos (MISMA LÓGICA QUE NEXUS DESKTOP) ===================
function toDate(str) {
  return new Date(str || "1970-01-01");
}
function inRange(dateStr, from, to) {
  const t = +toDate(dateStr);
  if (from && t < +toDate(from)) return false;
  if (to && t > +toDate(to) + 86400000 - 1) return false;
  return true;
}

function sumRange(list, from, to) {
  if (!Array.isArray(list)) return 0;
  return list
    .filter(r => inRange(r.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

// En Desktop el balance mensual incluye:
//  - expensesDaily
//  - personal
//  - payments
function sumExpensesDailySplit(from, to) {
  let recurrent = 0, nonRec = 0;
  const isRec = e =>
    e.method === "Automático" ||
    (e.desc || "").toLowerCase().startsWith("recurrente");

  (state.expensesDaily || [])
    .filter(e => inRange(e.date, from, to))
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (isRec(e)) recurrent += amt; else nonRec += amt;
    });

  return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec };
}

function sumPersonalRange(from, to) {
  return (state.personal || [])
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function sumPaymentsRange(from, to) {
  return (state.payments || [])
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

// ===== Render: header y KPIs =======================================
function applySettingsToHeader() {
  const name  = state.settings?.businessName || "Nexus Finance";
  const logoB = state.settings?.logoBase64 || "assets/logo.png";
  const brandTitle = $(".brand-title");
  const brandSub   = $(".brand-sub");
  const logoImg    = $(".brand-logo");

  if (brandTitle) brandTitle.textContent = name;
  if (brandSub)   brandSub.textContent   = "Panel rápido móvil";
  if (logoImg)    logoImg.src = logoB;
}

function renderKPIs() {
  const currency = state.settings?.currency || "USD";
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  // HOY
  const incToday = sumRange(state.incomesDaily || [], today, today);
  const expTodaySplit = sumExpensesDailySplit(today, today);
  const perToday = sumPersonalRange(today, today);
  const payToday = sumPaymentsRange(today, today);
  const expToday = expTodaySplit.total + perToday + payToday;

  // MES (igual que Desktop)
  const incMonth = sumRange(state.incomesDaily || [], monthStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const expMonth = expMonthSplit.total + perMonth + payMonth;
  const balMonth = incMonth - expMonth;

  const elIncToday = $("#kpi-income-today");
  const elExpToday = $("#kpi-expenses-today");
  const elBalToday = $("#kpi-balance-today");

  if (elIncToday) elIncToday.textContent = fmtCurrency(incToday, currency);
  if (elExpToday) elExpToday.textContent = fmtCurrency(expToday, currency);
  if (elBalToday) elBalToday.textContent = fmtCurrency(balMonth, currency); // OJO: aquí va BALANCE MES

  // Por si quieres que el label diga "Balance mes" en HTML,
  // déjalo fijo en el HTML. Aquí sólo mandamos el número correcto.
}

// ===== Facturas de hoy (lista) =====================================
function renderTodayInvoices() {
  const wrap = $("#todayInvoices");
  if (!wrap) return;

  const today = todayStr();
  const currency = state.settings?.currency || "USD";
  const invoices = (state.invoices || []).filter(inv =>
    inRange(inv.date, today, today)
  );

  if (invoices.length === 0) {
    wrap.className = "list-empty";
    wrap.textContent = "No hay facturas registradas hoy.";
    return;
  }

  wrap.className = "list-list";
  wrap.innerHTML = "";

  invoices
    .sort((a, b) => +toDate(b.date) - +toDate(a.date))
    .forEach(inv => {
      const row = document.createElement("div");
      row.className = "invoice-row";
      const clientName = (inv.client && inv.client.name) || "Sin cliente";
      row.innerHTML = `
        <div class="invoice-main">
          <div class="invoice-number">${inv.number || "—"}</div>
          <div class="invoice-client">${clientName}</div>
        </div>
        <div class="invoice-amount">${fmtCurrency(inv.total || 0, currency)}</div>
      `;
      wrap.appendChild(row);
    });
}

// ===== Navegación de pantallas (home, ingreso, gasto, factura) =====
function goScreen(id) {
  $$(".screen").forEach(s => {
    s.classList.toggle("active", s.id === `screen-${id}`);
  });
}

function wireNavigation() {
  $("#btnGoIncome")?.addEventListener("click", () => {
    $("#incDateMobile").value = todayStr();
    goScreen("income");
  });
  $("#btnGoExpense")?.addEventListener("click", () => {
    $("#expDateMobile").value = todayStr();
    goScreen("expense");
  });
  $("#btnGoInvoice")?.addEventListener("click", () => {
    $("#invDateMobile").value = todayStr();
    goScreen("invoice");
  });

  $$(".btn-back[data-back]").forEach(btn => {
    btn.addEventListener("click", () => goScreen(btn.dataset.back));
  });
}

// ===== Formularios: Ingreso rápido =================================
function wireIncomeForm() {
  const form = $("#formIncome");
  if (!form) return;
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!cloudUser) {
      toast("Conéctate con Google para guardar en la nube");
      return;
    }

    const rec = {
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
      date: $("#incDateMobile").value || todayStr(),
      client: $("#incClientMobile").value || "",
      method: $("#incMethodMobile").value || "Efectivo",
      amount: Number($("#incAmountMobile").value || 0)
    };
    if (!rec.date) {
      toast("Fecha requerida");
      return;
    }

    state.incomesDaily = state.incomesDaily || [];
    state.incomesDaily.push(rec);

    renderAll();
    await pushStateToCloud("Ingreso guardado en la nube");
    form.reset();
    $("#incDateMobile").value = todayStr();
    goScreen("home");
  });
}

// ===== Formularios: Gasto rápido ===================================
function wireExpenseForm() {
  const form = $("#formExpense");
  if (!form) return;
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!cloudUser) {
      toast("Conéctate con Google para guardar en la nube");
      return;
    }

    const rec = {
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
      date: $("#expDateMobile").value || todayStr(),
      category: $("#expCategoryMobile").value || "",
      method: $("#expMethodMobile").value || "Efectivo",
      amount: Number($("#expAmountMobile").value || 0),
      desc: "",
      note: ""
    };
    if (!rec.date) {
      toast("Fecha requerida");
      return;
    }

    state.expensesDaily = state.expensesDaily || [];
    state.expensesDaily.push(rec);

    renderAll();
    await pushStateToCloud("Gasto guardado en la nube");
    form.reset();
    $("#expDateMobile").value = todayStr();
    goScreen("home");
  });
}

// ===== Factura: items, totales, guardar ============================

function addItemRow() {
  const container = $("#invItemsContainer");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text" class="item-desc" placeholder="Descripción" />
    <input type="number" step="0.01" class="item-qty"   placeholder="Cant." />
    <input type="number" step="0.01" class="item-price" placeholder="Precio" />
    <input type="number" step="0.01" class="item-tax"   placeholder="% Imp." />
    <button type="button" class="btn-outline btn-small btn-del-item">✕</button>
  `;

  row.querySelector(".btn-del-item").addEventListener("click", () => {
    row.remove();
    calcInvoiceTotals();
  });

  ["item-qty","item-price","item-tax"].forEach(cls => {
    row.querySelector("." + cls).addEventListener("input", calcInvoiceTotals);
  });

  container.appendChild(row);
}

function readInvoiceItems() {
  const container = $("#invItemsContainer");
  if (!container) return [];
  const items = [];
  container.querySelectorAll(".item-row").forEach(row => {
    const desc  = row.querySelector(".item-desc").value || "";
    const qty   = parseFloat(row.querySelector(".item-qty").value || "0") || 0;
    const price = parseFloat(row.querySelector(".item-price").value || "0") || 0;
    const tax   = parseFloat(row.querySelector(".item-tax").value || "0") || 0;
    if (!desc && qty === 0 && price === 0) return;
    items.push({ id: Math.random().toString(36).slice(2, 7), desc, qty, price, tax });
  });
  return items;
}

function calcInvoiceTotals() {
  const items = readInvoiceItems();
  let subtotal = 0, taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const tx   = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tx;
  });
  const total = subtotal + taxTotal;

  const currency = state.settings?.currency || "USD";
  $("#invSubtotalMobile").textContent = items.length
    ? fmtCurrency(subtotal, currency)
    : "—";
  $("#invTaxMobile").textContent = items.length
    ? fmtCurrency(taxTotal, currency)
    : "—";
  $("#invTotalMobile").textContent = items.length
    ? fmtCurrency(total, currency)
    : "—";

  return { items, subtotal, taxTotal, total };
}

function wireInvoiceForm() {
  $("#btnAddItem")?.addEventListener("click", () => addItemRow());
  $("#btnCalcInvoice")?.addEventListener("click", () => calcInvoiceTotals());

  const form = $("#formInvoice");
  if (!form) return;

  async function saveInvoice(openWhatsApp) {
    if (!cloudUser) {
      toast("Conéctate con Google para guardar en la nube");
      return;
    }

    const { items, subtotal, taxTotal, total } = calcInvoiceTotals();
    const date    = $("#invDateMobile").value || todayStr();
    const number  = $("#invNumberMobile").value || "";
    const client  = $("#invClientMobile").value || "";
    const phone   = $("#invPhoneMobile").value || "";
    const method  = $("#invMethodMobile").value || "Efectivo";
    const note    = $("#invNoteMobile").value || "";

    if (!date || !number) {
      toast("Fecha y número de factura son requeridos");
      return;
    }
    if (items.length === 0) {
      toast("Agrega al menos 1 ítem");
      return;
    }

    const inv = {
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
      date,
      dueDate: "",
      number,
      method,
      client: {
        name: client,
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

    // Guardar en invoices
    state.invoices = state.invoices || [];
    state.invoices.push(inv);

    // Registrar ingreso automático (igual que Desktop)
    state.incomesDaily = state.incomesDaily || [];
    state.incomesDaily.push({
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
      date,
      client,
      method,
      amount: total,
      invoiceNumber: number
    });

    renderAll();
    await pushStateToCloud("Factura guardada en la nube");

    if (openWhatsApp && phone) {
      const clean = phone.replace(/[^\d]/g, "");
      const currency = state.settings?.currency || "USD";
      const msg = [
        `Saludos ${client || ""}`,
        `Adjunto el detalle de la factura #${number}.`,
        `Total: ${fmtCurrency(total, currency)}.`,
        note ? `Nota: ${note}` : ""
      ].filter(Boolean).join("\n");
      const url = `https://wa.me/${clean}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    }

    form.reset();
    $("#invItemsContainer").innerHTML = "";
    $("#invDateMobile").value = todayStr();
    $("#invSubtotalMobile").textContent = "—";
    $("#invTaxMobile").textContent      = "—";
    $("#invTotalMobile").textContent    = "—";
    goScreen("home");
  }

  $("#btnSaveInvoice")?.addEventListener("click", ev => {
    ev.preventDefault();
    saveInvoice(false);
  });

  $("#btnSaveInvoiceWhatsApp")?.addEventListener("click", ev => {
    ev.preventDefault();
    saveInvoice(true);
  });
}

// ===== Sync UI (botones de la tarjeta de sincronización) ============
let autoSync = JSON.parse(localStorage.getItem("nexus-mobile-autosync") || "false");

function updateSyncUI() {
  const signInBtn  = $("#btnSignInMobile");
  const signOutBtn = $("#btnSignOutMobile");
  const chkAuto    = $("#chkAutosyncMobile");
  const status     = $("#syncStatusMobile");

  if (chkAuto) {
    chkAuto.checked = autoSync;
  }

  if (!cloudUser) {
    if (signInBtn)  signInBtn.style.display  = "block";
    if (signOutBtn) signOutBtn.style.display = "none";
    if (status)     status.textContent = "Sin conexión";
    return;
  }

  if (signInBtn)  signInBtn.style.display  = "none";
  if (signOutBtn) signOutBtn.style.display = "block";
  if (status)     status.textContent = `Conectado como ${cloudUser.displayName || cloudUser.email || cloudUser.uid}`;
}

function wireSyncButtons() {
  const provider = new GoogleAuthProvider();

  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      // iOS / pop-up bloqueado → redirect
      await signInWithRedirect(auth, provider);
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    await signOut(auth);
  });

  $("#btnSyncPullMobile")?.addEventListener("click", async () => {
    await manualPullFromCloud();
  });

  $("#btnSyncPushMobile")?.addEventListener("click", async () => {
    await pushStateToCloud("Datos enviados a la nube");
  });

  $("#chkAutosyncMobile")?.addEventListener("change", ev => {
    autoSync = !!ev.target.checked;
    localStorage.setItem("nexus-mobile-autosync", JSON.stringify(autoSync));
  });
}

// ===== Render general ===============================================
function renderAll() {
  applySettingsToHeader();
  renderKPIs();
  renderTodayInvoices();
}

// ===== Arranque: listeners y Auth ==================================
function initMobileApp() {
  wireNavigation();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  wireSyncButtons();

  // Observador de login
  onAuthStateChanged(auth, user => {
    cloudUser = user || null;
    updateSyncUI();

    if (unsubSnap) {
      unsubSnap();
      unsubSnap = null;
    }

    if (!cloudUser) {
      // Sin usuario → estado por defecto solo para mostrar algo vacío
      state = clone(DEFAULT_STATE);
      renderAll();
      return;
    }

    const ref = userDocRef();
    unsubSnap = onSnapshot(ref, snap => {
      if (snap.exists()) {
        state = ensureStateStructure(snap.data());
      } else {
        state = clone(DEFAULT_STATE);
      }
      renderAll();
    }, err => {
      console.error("Error snapshot móvil:", err);
      toast("Error leyendo datos de la nube");
    });

    // Por si venimos de signInWithRedirect
    getRedirectResult(auth).catch(() => {});
  });

  // Pantalla inicial
  goScreen("home");
  renderAll();
}

document.addEventListener("DOMContentLoaded", initMobileApp);
