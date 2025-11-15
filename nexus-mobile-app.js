/* =========================================================
   Nexus Finance Móvil — nexus-mobile-app.js
   - Usa el MISMO state que Desktop (finanzas-state-v10)
   - KPI = BALANCE DEL MES (igual que Desktop)
   - Ingreso rápido / Gasto rápido / Factura rápida
   - Sync con Firebase (mismo usuario / mismo doc)
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp,
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

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clone = (o) => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

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

/* ===================== Utils numéricos ===================== */
function fmt(n) {
  const cur = state.settings?.currency || "USD";
  const val = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-PR", { style: "currency", currency: cur }).format(val);
  } catch {
    return `${cur} ${val.toFixed(2)}`;
  }
}

function toast(msg) {
  const box = $("#toast");
  if (!box) {
    console.log("[Toast]", msg);
    return;
  }
  box.textContent = msg;
  box.classList.remove("show");
  // retrigger
  void box.offsetWidth;
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 2300);
}

/* ===================== Helpers de fechas / rangos ===================== */
const toDate = (s) => new Date(s || "1970-01-01");
function inRange(d, from, to) {
  const t = +toDate(d);
  if (from && t < +toDate(from)) return false;
  if (to && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
}

/* ===== SUMATORIAS IGUALES A DESKTOP ===== */
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
    ((e.desc || "").toLowerCase().startsWith("recurrente"));
  state.expensesDaily
    .filter(e => inRange(e.date, from, to))
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (isRec(e)) recurrent += amt; else nonRec += amt;
    });
  return {
    total: recurrent + nonRec,
    recurrent,
    nonRecurrent: nonRec
  };
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

/* ===================== Guardar + autosync ===================== */
const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem("autosyncMobile") || "false"),
  unsub: null
};

let pushTimer = null;
function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}

async function cloudPush() {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Inicia sesión para sincronizar");
    return;
  }
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = Date.now();
  await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge: true });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  toast("Datos enviados a la nube");
}
function cloudPushDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPush, 600);
}

async function cloudPull(replace = true) {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Inicia sesión para traer datos");
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("No hay datos en la nube");
    return;
  }
  const remote = snap.data() || {};
  const rU = remote?._cloud?.updatedAt || 0;
  const lU = state?._cloud?.updatedAt || 0;

  if (replace || rU >= lU) {
    state = remote;
  } else {
    // merge simple
    state.settings = Object.assign({}, state.settings, remote.settings || {});
    ["expensesDaily", "incomesDaily", "payments", "ordinary",
     "budgets", "personal", "invoices", "quotes", "reconciliations"]
      .forEach(k => {
        if (Array.isArray(remote[k])) {
          state[k] = state[k].concat(remote[k]);
        }
      });
    state._cloud = state._cloud || {};
    state._cloud.updatedAt = Math.max(lU, rU);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  refreshHome();
  toast("Datos cargados desde la nube");
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  refreshHome();
  if (cloud.user && cloud.autosync) {
    cloudPushDebounced();
  }
}

/* ===================== UI NAV: pantallas ===================== */
function goScreen(screenId) {
  $$(".screen").forEach(sec => {
    sec.classList.toggle("active", sec.id === screenId);
  });
}

function wireNavigation() {
  const btnGoIncome  = $("#btnGoIncome");
  const btnGoExpense = $("#btnGoExpense");
  const btnGoInvoice = $("#btnGoInvoice");

  if (btnGoIncome) {
    btnGoIncome.addEventListener("click", () => {
      const d = $("#incDateMobile");
      if (d && !d.value) d.value = todayStr();
      goScreen("screen-income");
    });
  }
  if (btnGoExpense) {
    btnGoExpense.addEventListener("click", () => {
      const d = $("#expDateMobile");
      if (d && !d.value) d.value = todayStr();
      goScreen("screen-expense");
    });
  }
  if (btnGoInvoice) {
    btnGoInvoice.addEventListener("click", () => {
      const d = $("#invDateMobile");
      if (d && !d.value) d.value = todayStr();
      goScreen("screen-invoice");
    });
  }

  $$(".btn-back[data-back]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-back");
      if (target === "home") goScreen("screen-home");
    });
  });
}

/* ===================== KPI Home: BALANCE DEL MES ===================== */
/*
   Lógica copiada del Desktop:
   - ingresosMes = sumRange(incomesDaily, monthStart, today)
   - gastosMes   = expensesDaily + personal + payments
   - balanceMes  = ingresosMes – gastosMes
*/
function renderHomeKPIs() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const monthStart = `${yyyy}-${mm}-01`;
  const today = now.toISOString().slice(0, 10);

  const ingresosMes = sumRange(state.incomesDaily, monthStart, today);

  const expSplitMes = sumExpensesDailySplit(monthStart, today);
  const personalesMes = sumPersonalRange(monthStart, today);
  const pagosMes = sumPaymentsRange(monthStart, today);

  const gastosMesTotal = expSplitMes.total + personalesMes + pagosMes;
  const balanceMes = ingresosMes - gastosMesTotal;

  const elInc = $("#kpi-income-today");
  const elExp = $("#kpi-expenses-today");
  const elBal = $("#kpi-balance-today");

  if (elInc) elInc.textContent = fmt(ingresosMes);
  if (elExp) elExp.textContent = fmt(gastosMesTotal);
  if (elBal) elBal.textContent = fmt(balanceMes);
}

/* ===================== Lista: facturas de HOY ===================== */
function renderTodayInvoices() {
  const box = $("#todayInvoices");
  if (!box) return;

  const today = todayStr();
  const todayInv = (state.invoices || []).filter(inv => inv.date === today);

  if (!todayInv.length) {
    box.className = "list-empty";
    box.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  box.className = "list-list";
  box.innerHTML = "";

  todayInv
    .sort((a, b) => (a.number || "").localeCompare(b.number || ""))
    .forEach(inv => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <div class="line-1">
          <strong>#${inv.number || "—"}</strong> · ${inv.client?.name || "Sin cliente"}
        </div>
        <div class="line-2">
          <span>${fmt(inv.total || 0)}</span>
          <span class="method">${inv.method || ""}</span>
        </div>
      `;
      box.appendChild(div);
    });
}

/* ===================== Ingreso rápido ===================== */
function wireIncomeForm() {
  const form = $("#formIncome");
  if (!form) return;

  const dateEl   = $("#incDateMobile");
  const clientEl = $("#incClientMobile");
  const methodEl = $("#incMethodMobile");
  const amountEl = $("#incAmountMobile");

  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();

    const date   = dateEl?.value || "";
    const client = (clientEl?.value || "").trim();
    const method = methodEl?.value || "";
    const amt    = parseFloat(amountEl?.value || "0") || 0;

    if (!date) return toast("Fecha requerida");
    if (!amt)  return toast("Monto debe ser mayor que 0");

    const rec = {
      id: uid(),
      date,
      client,
      method,
      amount: amt
    };
    state.incomesDaily.push(rec);
    saveState();
    toast("Ingreso guardado");

    form.reset();
    if (dateEl) dateEl.value = todayStr();
    goScreen("screen-home");
  });
}

/* ===================== Gasto rápido ===================== */
function wireExpenseForm() {
  const form = $("#formExpense");
  if (!form) return;

  const dateEl   = $("#expDateMobile");
  const catEl    = $("#expCategoryMobile");
  const methodEl = $("#expMethodMobile");
  const amountEl = $("#expAmountMobile");

  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();

    const date   = dateEl?.value || "";
    const cat    = (catEl?.value || "").trim();
    const method = methodEl?.value || "";
    const amt    = parseFloat(amountEl?.value || "0") || 0;

    if (!date) return toast("Fecha requerida");
    if (!amt)  return toast("Monto debe ser mayor que 0");

    const rec = {
      id: uid(),
      date,
      category: cat || "Sin categoría",
      desc: cat || "",
      method,
      amount: amt,
      note: ""
    };
    state.expensesDaily.push(rec);
    saveState();
    toast("Gasto guardado");

    form.reset();
    if (dateEl) dateEl.value = todayStr();
    goScreen("screen-home");
  });
}

/* ===================== Factura rápida ===================== */
function createItemRow(container) {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text" class="item-desc"  placeholder="Descripción">
    <input type="number" step="0.01" class="item-qty"   placeholder="Cant." value="1">
    <input type="number" step="0.01" class="item-price" placeholder="Precio" value="0">
    <input type="number" step="0.01" class="item-tax"   placeholder="%Imp" value="0">
    <button type="button" class="btn-small btn-remove">✕</button>
  `;
  const btnRemove = $(".btn-remove", row);
  if (btnRemove) {
    btnRemove.addEventListener("click", () => {
      row.remove();
      calcInvoiceTotals();
    });
  }
  container.appendChild(row);
}

function readInvoiceItems() {
  const cont = $("#invItemsContainer");
  if (!cont) return [];

  const rows = $$(".item-row", cont);
  const items = [];

  rows.forEach(r => {
    const desc  = $(".item-desc", r)?.value || "";
    const qty   = parseFloat($(".item-qty", r)?.value || "0") || 0;
    const price = parseFloat($(".item-price", r)?.value || "0") || 0;
    const tax   = parseFloat($(".item-tax", r)?.value || "0") || 0;

    if (!desc.trim() && !qty && !price && !tax) return;
    items.push({ desc: desc.trim(), qty, price, tax });
  });
  return items;
}

function calcTotalsFromItems(items) {
  let subtotal = 0, taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const taxAmt = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += taxAmt;
  });
  return {
    subtotal,
    taxTotal,
    total: subtotal + taxTotal
  };
}

function calcInvoiceTotals() {
  const items = readInvoiceItems();
  const { subtotal, taxTotal, total } = calcTotalsFromItems(items);

  const sEl = $("#invSubtotalMobile");
  const tEl = $("#invTaxMobile");
  const gEl = $("#invTotalMobile");

  if (sEl) sEl.textContent = items.length ? fmt(subtotal) : "—";
  if (tEl) tEl.textContent = items.length ? fmt(taxTotal) : "—";
  if (gEl) gEl.textContent = items.length ? fmt(total) : "—";

  return { items, subtotal, taxTotal, total };
}

function wireInvoiceForm() {
  const form    = $("#formInvoice");
  const btnAdd  = $("#btnAddItem");
  const btnCalc = $("#btnCalcInvoice");
  const btnSave = $("#btnSaveInvoice");
  const btnWA   = $("#btnSaveInvoiceWhatsApp");
  const cont    = $("#invItemsContainer");

  if (!form || !cont) return;

  const dateEl   = $("#invDateMobile");
  const numEl    = $("#invNumberMobile");
  const cliEl    = $("#invClientMobile");
  const phoneEl  = $("#invPhoneMobile");
  const methodEl = $("#invMethodMobile");
  const noteEl   = $("#invNoteMobile");

  if (dateEl && !dateEl.value) dateEl.value = todayStr();
  if (!cont.children.length) createItemRow(cont);

  if (btnAdd) {
    btnAdd.addEventListener("click", () => {
      createItemRow(cont);
    });
  }
  if (btnCalc) {
    btnCalc.addEventListener("click", () => {
      calcInvoiceTotals();
      toast("Totales calculados");
    });
  }

  function saveInvoiceCore(openWhatsApp = false) {
    const date = dateEl?.value || "";
    const number = (numEl?.value || "").trim();
    const clientName = (cliEl?.value || "").trim();
    const phone = (phoneEl?.value || "").trim();
    const method = methodEl?.value || "";
    const note = (noteEl?.value || "").trim();

    if (!date) return toast("Fecha requerida");
    if (!number) return toast("# de factura requerido");

    const { items, subtotal, taxTotal, total } = calcInvoiceTotals();
    if (!items.length) return toast("Agrega al menos un ítem");

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
      subtotal,
      taxTotal,
      total,
      note,
      terms: ""
    };

    // Igual que Desktop: guardar también en Ingresos
    const income = {
      id: uid(),
      date,
      client: clientName || `Factura ${number}`,
      method,
      amount: total,
      invoiceNumber: number
    };
    state.incomesDaily.push(income);
    inv.incomeId = income.id;

    state.invoices.push(inv);
    saveState();
    toast("Factura guardada (y registrada en ingresos)");

    // WhatsApp
    if (openWhatsApp && phone) {
      const totalTxt = fmt(total);
      const msg = encodeURIComponent(
        `Hola ${clientName || ""}, aquí el detalle de su factura #${number} por ${totalTxt}. ` +
        `Gracias por su confianza.`
      );
      const phoneClean = phone.replace(/\D/g, "");
      const url = `https://wa.me/${phoneClean}?text=${msg}`;
      window.open(url, "_blank");
    }

    // Reset
    form.reset();
    cont.innerHTML = "";
    createItemRow(cont);
    $("#invSubtotalMobile").textContent = "—";
    $("#invTaxMobile").textContent = "—";
    $("#invTotalMobile").textContent = "—";
    if (dateEl) dateEl.value = todayStr();
    goScreen("screen-home");
  }

  if (btnSave) {
    btnSave.addEventListener("click", (ev) => {
      ev.preventDefault();
      saveInvoiceCore(false);
    });
  }
  if (btnWA) {
    btnWA.addEventListener("click", (ev) => {
      ev.preventDefault();
      saveInvoiceCore(true);
    });
  }
}

/* ===================== Firebase / Cloud UI móvil ===================== */
function updateCloudUI() {
  const status = $("#syncStatusMobile");
  const btnIn  = $("#btnSignInMobile");
  const btnOut = $("#btnSignOutMobile");
  const chk    = $("#chkAutosyncMobile");

  if (chk) chk.checked = !!cloud.autosync;

  if (!cloud.user) {
    if (status) status.textContent = "Sin conexión";
    if (btnIn)  btnIn.style.display = "block";
    if (btnOut) btnOut.style.display = "none";
  } else {
    const name = cloud.user.displayName || cloud.user.email || cloud.user.uid;
    if (status) status.textContent = `Conectado como ${name}`;
    if (btnIn)  btnIn.style.display = "none";
    if (btnOut) btnOut.style.display = "block";
  }
}

function cloudSubscribe() {
  const ref = cloudDocRef();
  cloud.unsub?.();
  if (!ref) return;
  cloud.unsub = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const remote = snap.data();
    const rU = remote?._cloud?.updatedAt || 0;
    const lU = state?._cloud?.updatedAt || 0;
    if (rU > lU) {
      state = remote;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      refreshHome();
      toast("Actualizado desde la nube");
    }
  });
}

function wireCloudMobile() {
  const provider = new GoogleAuthProvider();
  const btnIn    = $("#btnSignInMobile");
  const btnOut   = $("#btnSignOutMobile");
  const btnPull  = $("#btnSyncPullMobile");
  const btnPush  = $("#btnSyncPushMobile");
  const chk      = $("#chkAutosyncMobile");

  if (btnIn) {
    btnIn.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch {
        await signInWithRedirect(auth, provider);
      }
    });
  }
  if (btnOut) {
    btnOut.addEventListener("click", async () => {
      await signOut(auth);
    });
  }
  if (btnPull) {
    btnPull.addEventListener("click", () => cloudPull(true));
  }
  if (btnPush) {
    btnPush.addEventListener("click", () => cloudPush());
  }
  if (chk) {
    chk.addEventListener("change", (e) => {
      cloud.autosync = !!e.target.checked;
      localStorage.setItem("autosyncMobile", JSON.stringify(cloud.autosync));
      updateCloudUI();
    });
  }

  updateCloudUI();

  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, (user) => {
    cloud.user = user || null;
    updateCloudUI();
    if (user) {
      cloudSubscribe();
    } else {
      cloud.unsub?.();
      cloud.unsub = null;
    }
  });
}

/* ===================== REFRESH HOME ===================== */
function refreshHome() {
  renderHomeKPIs();
  renderTodayInvoices();
}

/* ===================== Arranque ===================== */
document.addEventListener("DOMContentLoaded", () => {
  wireNavigation();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  wireCloudMobile();
  refreshHome();
  goScreen("screen-home");
  // Exponer para debug si quieres
  window.nexusMobile = { state, refreshHome, cloudPull, cloudPush };
});
