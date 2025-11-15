/* =========================================================
   Nexus Finance Móvil — nexus-mobile-app.js v3
   - Lee el MISMO estado que Desktop (finanzas-state-v10)
   - KPIs de HOY con misma fórmula que Desktop
   - Soporte de Firebase (pull / push / autosync)
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

/* ===================== Firebase config (MISMO PROYECTO) ===================== */
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
enableIndexedDbPersistence(db).catch(() => {});

/* ===================== Estado compartido con Desktop ===================== */

const STORAGE_KEY = "finanzas-state-v10";

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

const clone = o => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0, 10);
const toDate   = s => new Date(s);
const inRange  = (d, from, to) => {
  const t = +toDate(d || "1970-01-01");
  if (from && t < +toDate(from)) return false;
  if (to && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_STATE);
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

function saveState({ skipCloud = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderHomeKPIs();
  renderTodayInvoices();
  if (!skipCloud && cloud.autosync && cloud.user) {
    cloudPushDebounced();
  }
}

/* ===================== Utils formato ===================== */
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

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function toast(msg) {
  const t = $("#toast");
  if (!t) { console.log("[toast]", msg); return; }
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

/* ===================== SUMATORIAS (MISMA LÓGICA QUE DESKTOP) ===================== */

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

/* =========================================================
   🔹 HOME KPIs — HOY (igual fórmula que Desktop para el día)
   ========================================================= */

function renderHomeKPIs() {
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);

  // Ingresos HOY
  const incToday = sumRange(state.incomesDaily, today, today);

  // Gastos HOY (gastos + personales + nómina) — MISMA LÓGICA
  const expSplitToday = sumExpensesDailySplit(today, today);
  const perToday      = sumPersonalRange(today, today);
  const payToday      = sumPaymentsRange(today, today);
  const totalExpToday = expSplitToday.total + perToday + payToday;

  const balanceToday = incToday - totalExpToday;

  const elInc = $("#kpi-income-today");
  const elExp = $("#kpi-expenses-today");
  const elBal = $("#kpi-balance-today");

  if (elInc) elInc.textContent = fmt(incToday);
  if (elExp) elExp.textContent = fmt(totalExpToday);
  if (elBal) elBal.textContent = fmt(balanceToday);
}

/* =========================================================
   🔹 LISTA: Facturas de HOY
   ========================================================= */

function renderTodayInvoices() {
  const wrap = $("#todayInvoices");
  if (!wrap) return;

  const today = todayStr();
  const list = (state.invoices || []).filter(inv =>
    inv.date && inv.date.slice(0, 10) === today
  );

  if (!list.length) {
    wrap.className = "list-empty";
    wrap.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  wrap.className = "list-list";
  wrap.innerHTML = "";

  list
    .slice()
    .sort((a, b) => (a.number || "").localeCompare(b.number || ""))
    .forEach(inv => {
      const div = document.createElement("div");
      div.className = "invoice-row";
      div.innerHTML = `
        <div class="invoice-main">
          <strong>${inv.number || "—"}</strong>
          <span>${inv.client?.name || "Sin cliente"}</span>
        </div>
        <div class="invoice-right">
          <span class="invoice-amount">${fmt(inv.total || 0)}</span>
          <span class="invoice-method">${inv.method || ""}</span>
        </div>
      `;
      wrap.appendChild(div);
    });
}

/* =========================================================
   🔹 Navegación simple entre pantallas
   ========================================================= */

function showScreen(id) {
  $$(".screen").forEach(s =>
    s.classList.toggle("active", s.id === `screen-${id}`)
  );
}

function wireNavigation() {
  $("#btnGoIncome")  ?.addEventListener("click", () => showScreen("income"));
  $("#btnGoExpense") ?.addEventListener("click", () => showScreen("expense"));
  $("#btnGoInvoice") ?.addEventListener("click", () => showScreen("invoice"));

  $$(".btn-back").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.back || "home";
      showScreen(target);
    });
  });
}

/* =========================================================
   🔹 Formularios rápidos (Ingreso / Gasto)
   ========================================================= */

function wireQuickIncome() {
  const form = $("#formIncome");
  if (!form) return;

  const dateEl = $("#incDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const rec = {
      id:   "m" + Date.now().toString(36),
      date: dateEl?.value || todayStr(),
      client: $("#incClientMobile")?.value || "",
      method: $("#incMethodMobile")?.value || "Efectivo",
      amount: Number($("#incAmountMobile")?.value || 0)
    };
    if (!rec.date) return toast("Fecha requerida");
    if (!rec.amount) return toast("Monto requerido");

    state.incomesDaily.push(rec);
    saveState();
    toast("Ingreso guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
  });
}

function wireQuickExpense() {
  const form = $("#formExpense");
  if (!form) return;

  const dateEl = $("#expDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const rec = {
      id:   "e" + Date.now().toString(36),
      date: dateEl?.value || todayStr(),
      category: $("#expCategoryMobile")?.value || "",
      method:   $("#expMethodMobile")?.value || "Efectivo",
      amount:   Number($("#expAmountMobile")?.value || 0),
      desc:     $("#expCategoryMobile")?.value || ""
    };
    if (!rec.date) return toast("Fecha requerida");
    if (!rec.amount) return toast("Monto requerido");

    state.expensesDaily.push(rec);
    saveState();
    toast("Gasto guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
  });
}

/* =========================================================
   🔹 Factura rápida móvil
   ========================================================= */

function addInvoiceItemRow() {
  const container = $("#invItemsContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text"  class="item-desc"  placeholder="Descripción">
    <input type="number" step="0.01" class="item-qty"   placeholder="Cant." value="1">
    <input type="number" step="0.01" class="item-price" placeholder="Precio">
    <input type="number" step="0.01" class="item-tax"   placeholder="% Imp." value="0">
    <button type="button" class="btn-outline btn-small btn-del-item">✕</button>
  `;
  row.querySelector(".btn-del-item")?.addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function readInvoiceItems() {
  const container = $("#invItemsContainer");
  if (!container) return [];
  const items = [];
  container.querySelectorAll(".item-row").forEach(row => {
    const desc  = row.querySelector(".item-desc")?.value || "";
    const qty   = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
    const price = parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
    const tax   = parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;
    if (!desc && !qty && !price) return;
    items.push({ desc, qty, price, tax });
  });
  return items;
}

function calcTotals(items) {
  let subtotal = 0, taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0) / 100);
    subtotal  += base;
    taxTotal  += tax;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function paintInvoiceTotals() {
  const items = readInvoiceItems();
  const t = calcTotals(items);
  const sSub = $("#invSubtotalMobile");
  const sTax = $("#invTaxMobile");
  const sTot = $("#invTotalMobile");
  if (sSub) sSub.textContent = fmt(t.subtotal);
  if (sTax) sTax.textContent = fmt(t.taxTotal);
  if (sTot) sTot.textContent = fmt(t.total);
  return t;
}

function wireInvoiceForm() {
  const btnAdd = $("#btnAddItem");
  const btnCalc = $("#btnCalcInvoice");
  const form = $("#formInvoice");
  const btnSave = $("#btnSaveInvoice");
  const btnSaveWA = $("#btnSaveInvoiceWhatsApp");

  if (btnAdd) btnAdd.addEventListener("click", () => addInvoiceItemRow());
  if (btnCalc) btnCalc.addEventListener("click", () => paintInvoiceTotals());

  const dateEl = $("#invDateMobile");
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  function saveInvoice(openWhatsApp) {
    const items = readInvoiceItems();
    const t = calcTotals(items);

    const inv = {
      id: "f" + Date.now().toString(36),
      date: dateEl?.value || todayStr(),
      dueDate: "", // móvil simple
      number: $("#invNumberMobile")?.value || "",
      method: $("#invMethodMobile")?.value || "",
      client: {
        name: $("#invClientMobile")?.value || "",
        phone: $("#invPhoneMobile")?.value || "",
        email: "",
        address: ""
      },
      items,
      subtotal: t.subtotal,
      taxTotal: t.taxTotal,
      total: t.total,
      note: $("#invNoteMobile")?.value || "",
      terms: ""
    };

    if (!inv.date || !inv.number) {
      toast("Fecha y número requeridos");
      return;
    }

    // Registrar ingreso igual que en Desktop
    const income = {
      id: "i" + Date.now().toString(36),
      date: inv.date,
      client: inv.client.name,
      method: inv.method,
      amount: inv.total,
      invoiceNumber: inv.number
    };
    state.incomesDaily.push(income);
    inv.incomeId = income.id;

    state.invoices.push(inv);
    saveState();
    toast("Factura guardada");

    paintInvoiceTotals();
    form?.reset();
    $("#invItemsContainer").innerHTML = "";
    addInvoiceItemRow();
    if (dateEl) dateEl.value = todayStr();

    if (openWhatsApp && inv.client.phone) {
      const phone = String(inv.client.phone).replace(/\D/g, "");
      const msg = encodeURIComponent(
        `Hola ${inv.client.name || ""},\n` +
        `Aquí el detalle de su factura #${inv.number} por un total de ${fmt(inv.total)}.\n` +
        `Gracias por su confianza.`
      );
      const url = `https://wa.me/${phone}?text=${msg}`;
      window.open(url, "_blank");
    }
  }

  if (form) {
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      saveInvoice(false);
    });
  }
  if (btnSave) {
    btnSave.addEventListener("click", ev => {
      ev.preventDefault();
      saveInvoice(false);
    });
  }
  if (btnSaveWA) {
    btnSaveWA.addEventListener("click", ev => {
      ev.preventDefault();
      saveInvoice(true);
    });
  }

  // Crear una fila por defecto
  addInvoiceItemRow();
}

/* =========================================================
   🔹 Sync con Firebase (mismo documento que Desktop)
   ========================================================= */

const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem("autosyncMobile") || "false"),
  unsub: null
};

function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}

function uiCloudMobile() {
  const status = $("#syncStatusMobile");
  const btnIn  = $("#btnSignInMobile");
  const btnOut = $("#btnSignOutMobile");
  const chk    = $("#chkAutosyncMobile");

  if (status) {
    status.textContent = cloud.user
      ? `Conectado como ${cloud.user.displayName || cloud.user.email || cloud.user.uid}`
      : "Sin conexión";
  }
  if (btnIn)  btnIn.style.display  = cloud.user ? "none" : "block";
  if (btnOut) btnOut.style.display = cloud.user ? "block" : "none";
  if (chk)    chk.checked = !!cloud.autosync;
}

function setAutosyncMobile(v) {
  cloud.autosync = !!v;
  localStorage.setItem("autosyncMobile", JSON.stringify(cloud.autosync));
  uiCloudMobile();
}

async function cloudPullMobile() {
  const ref = cloudDocRef();
  if (!ref) return toast("Inicia sesión primero");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("No hay datos en la nube");
    return;
  }
  const remote = snap.data();
  const rU = remote?._cloud?.updatedAt || 0;
  const lU = state?._cloud?.updatedAt || 0;

  // Si remoto es más nuevo o se fuerza, reemplazamos
  if (rU >= lU) {
    state = remote;
  } else {
    // Fusión básica
    state.settings = Object.assign({}, state.settings, remote.settings || {});
    ["expensesDaily","incomesDaily","payments","ordinary","budgets","personal","invoices","quotes","reconciliations"]
      .forEach(k => {
        if (Array.isArray(remote[k])) {
          state[k] = state[k].concat(remote[k]);
        }
      });
    state._cloud = state._cloud || {};
    state._cloud.updatedAt = Math.max(lU, rU);
  }

  saveState({ skipCloud: true });
  renderHomeKPIs();
  renderTodayInvoices();
  toast("Datos cargados desde la nube");
}

async function cloudPushMobile() {
  const ref = cloudDocRef();
  if (!ref) return toast("Inicia sesión primero");
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = Date.now();
  await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge: true });
  saveState({ skipCloud: true });
  toast("Datos enviados a la nube");
}

let pushTimerMobile;
function cloudPushDebounced() {
  clearTimeout(pushTimerMobile);
  pushTimerMobile = setTimeout(cloudPushMobile, 600);
}

function cloudSubscribeMobile() {
  if (!cloud.user) return;
  const ref = cloudDocRef();
  cloud.unsub?.();
  cloud.unsub = onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    const remote = snap.data();
    if ((remote?._cloud?.updatedAt || 0) > (state?._cloud?.updatedAt || 0)) {
      state = remote;
      saveState({ skipCloud: true });
      renderHomeKPIs();
      renderTodayInvoices();
      toast("Actualizado desde la nube");
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

  $("#btnSyncPullMobile")?.addEventListener("click", () => cloudPullMobile());
  $("#btnSyncPushMobile")?.addEventListener("click", () => cloudPushMobile());
  $("#chkAutosyncMobile")?.addEventListener("change", ev => {
    setAutosyncMobile(ev.target.checked);
  });

  uiCloudMobile();
  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, user => {
    cloud.user = user || null;
    uiCloudMobile();
    if (user) cloudSubscribeMobile();
    else { cloud.unsub?.(); cloud.unsub = null; }
  });
}

/* =========================================================
   🔹 INIT
   ========================================================= */

function initMobileApp() {
  // Estado ya cargado arriba
  renderHomeKPIs();
  renderTodayInvoices();

  wireNavigation();
  wireQuickIncome();
  wireQuickExpense();
  wireInvoiceForm();
  wireCloudMobile();
}

document.addEventListener("DOMContentLoaded", initMobileApp);

// Para depuración en consola
window.nexusMobile = { state, renderHomeKPIs, renderTodayInvoices, cloudPullMobile, cloudPushMobile };
