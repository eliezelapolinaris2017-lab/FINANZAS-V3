// nexus-mobile-app.js (MODO PRO)
// Versión móvil conectada a mismo STATE que Desktop
// UID fijo: 7Si5WwQQLWRt4bhlQ59duPVVqSB2

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  enableIndexedDbPersistence,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ==================== Firebase ====================

const firebaseConfig = {
  apiKey: "AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE",
  authDomain: "finanzas-web-f4e05.firebaseapp.com",
  projectId: "finanzas-web-f4e05",
  storageBucket: "finanzas-web-f4e05.firebasestorage.app",
  messagingSenderId: "1047152523619",
  appId: "1:1047152523619:web:7d8f7d1f7a5ccc6090bb56"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
enableIndexedDbPersistence(db).catch(() => {});

// UID FIJO (el que me diste)
const FIXED_UID = "7Si5WwQQLWRt4bhlQ59duPVVqSB2";

// ==================== Estado base igual a Desktop ====================

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

let state = clone(DEFAULT_STATE);
let autosyncMobile = false;

// ==================== Utils ====================

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function toDate(s) {
  return new Date(s || "1970-01-01");
}
function inRange(d, from, to) {
  const t = +toDate(d);
  if (from && t < +toDate(from)) return false;
  if (to && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
}

function ensureStateShape(raw) {
  const base = clone(DEFAULT_STATE);
  const incoming = raw && typeof raw === "object" ? raw : {};
  for (const k of Object.keys(base)) {
    if (Array.isArray(base[k])) {
      base[k] = Array.isArray(incoming[k]) ? incoming[k] : [];
    } else if (typeof base[k] === "object") {
      base[k] = Object.assign({}, base[k], incoming[k] || {});
    } else {
      base[k] = k in incoming ? incoming[k] : base[k];
    }
  }
  // si los arrays existen pero no están, los creamos vacíos
  const arrKeys = [
    "expensesDaily",
    "incomesDaily",
    "payments",
    "ordinary",
    "budgets",
    "personal",
    "invoices",
    "quotes",
    "reconciliations"
  ];
  arrKeys.forEach(k => {
    if (!Array.isArray(base[k])) base[k] = [];
  });
  base._cloud = incoming._cloud || { updatedAt: 0 };
  return base;
}

function fmt(n) {
  const cur = (state.settings && state.settings.currency) || "USD";
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

function uid() {
  return (
    Math.random().toString(36).slice(2, 9) + Date.now().toString(36)
  );
}

function toast(msg) {
  const box = $("#toast");
  if (!box) {
    console.log("[Toast]", msg);
    return;
  }
  box.textContent = msg;
  box.classList.add("visible");
  setTimeout(() => box.classList.remove("visible"), 2200);
}

// ==================== Lógica de KPIs (MISMA QUE DESKTOP) ====================

// Suma genérica de incomesDaily
function sumRange(list, from, to) {
  if (!Array.isArray(list)) return 0;
  return list
    .filter(r => inRange(r.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

// Gasto diario separado recurrente / no recurrente (igual que Desktop)
function sumExpensesDailySplit(from, to) {
  let recurrent = 0;
  let nonRec = 0;
  const isRec = e =>
    e.method === "Automático" ||
    (e.desc || "").toLowerCase().startsWith("recurrente");

  (state.expensesDaily || [])
    .filter(e => inRange(e.date, from, to))
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (isRec(e)) recurrent += amt;
      else nonRec += amt;
    });

  return {
    total: recurrent + nonRec,
    recurrent,
    nonRecurrent: nonRec
  };
}

function sumPaymentsRange(from, to) {
  return (state.payments || [])
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function sumPersonalRange(from, to) {
  return (state.personal || [])
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

// 👉 KPIs DEL MES: Ingresos / Gastos / Balance (igual a Desktop)
function renderKpiMonthMobile() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const totalExpMonth = expMonthSplit.total + perMonth + payMonth;
  const balanceMonth = incMonth - totalExpMonth;

  const $inc = $("#kpi-income-today");
  const $exp = $("#kpi-expenses-today");
  const $bal = $("#kpi-balance-today");

  if ($inc) $inc.textContent = fmt(incMonth);
  if ($exp) $exp.textContent = fmt(totalExpMonth);
  if ($bal) $bal.textContent = fmt(balanceMonth);

  // Opcional: cambiar texto "hoy" → "mes" (solo UI)
  const labels = $all(".kpi-card .kpi-label");
  if (labels.length === 3) {
    labels[0].textContent = "Ingresos del mes";
    labels[1].textContent = "Gastos del mes";
    labels[2].textContent = "Balance del mes";
  }
}

// ==================== Lista de facturas de HOY ====================

function renderTodayInvoices() {
  const box = $("#todayInvoices");
  if (!box) return;

  const today = todayStr();
  const list = (state.invoices || []).filter(inv => inv.date === today);

  if (!list.length) {
    box.className = "list-empty";
    box.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  box.className = "list";
  box.innerHTML = "";
  list
    .slice()
    .sort((a, b) => (a.number || "").localeCompare(b.number || ""))
    .forEach(inv => {
      const div = document.createElement("div");
      div.className = "list-item";
      const name = inv.client?.name || "Sin nombre";
      const num = inv.number || "—";
      const total = fmt(inv.total || 0);
      div.innerHTML = `
        <div class="item-main">
          <strong>#${num}</strong> — ${name}
        </div>
        <div class="item-sub">
          Total: ${total} · Método: ${inv.method || "—"}
        </div>
      `;
      box.appendChild(div);
    });
}

// ==================== Sync con Firebase (UID fijo) ====================

function cloudDocRef() {
  return doc(db, "users", FIXED_UID, "state", "app");
}

function setSyncStatus(text) {
  const el = $("#syncStatusMobile");
  if (el) el.textContent = text;
}

async function cloudPullMobile() {
  try {
    setSyncStatus("Cargando de la nube…");
    const snap = await getDoc(cloudDocRef());
    if (!snap.exists()) {
      state = clone(DEFAULT_STATE);
      setSyncStatus("Sin datos en la nube (usando estado vacío)");
      renderAllMobile();
      return;
    }
    const remote = snap.data();
    state = ensureStateShape(remote || {});
    setSyncStatus("Sincronizado (pull ok)");
    renderAllMobile();
  } catch (err) {
    console.error("cloudPullMobile error:", err);
    toast("Error al traer datos de la nube");
    setSyncStatus("Error al sincronizar");
  }
}

async function cloudPushMobile() {
  try {
    setSyncStatus("Enviando a la nube…");
    state._cloud = state._cloud || {};
    state._cloud.updatedAt = Date.now();
    await setDoc(
      cloudDocRef(),
      { ...state, _serverUpdatedAt: serverTimestamp() },
      { merge: true }
    );
    setSyncStatus("Sincronizado (push ok)");
  } catch (err) {
    console.error("cloudPushMobile error:", err);
    toast("Error al enviar datos a la nube");
    setSyncStatus("Error al sincronizar");
  }
}

let pushTimerMobile = null;
function saveAndMaybeSync() {
  // Aquí solo recalculamos vistas; almacén real está en Firestore (push)
  renderAllMobile();
  if (autosyncMobile) {
    clearTimeout(pushTimerMobile);
    pushTimerMobile = setTimeout(() => {
      cloudPushMobile();
    }, 600);
  }
}

function wireCloudMobile() {
  const btnSignIn = $("#btnSignInMobile");
  const btnSignOut = $("#btnSignOutMobile");
  const btnPull = $("#btnSyncPullMobile");
  const btnPush = $("#btnSyncPushMobile");
  const chkAuto = $("#chkAutosyncMobile");

  // Como usamos UID fijo, los botones de login no hacen nada real
  if (btnSignIn) {
    btnSignIn.textContent = "UID fijo conectado";
    btnSignIn.disabled = true;
  }
  if (btnSignOut) {
    btnSignOut.style.display = "none";
  }

  if (btnPull) {
    btnPull.addEventListener("click", () => {
      cloudPullMobile();
    });
  }
  if (btnPush) {
    btnPush.addEventListener("click", () => {
      cloudPushMobile();
    });
  }
  if (chkAuto) {
    autosyncMobile = !!JSON.parse(localStorage.getItem("autosyncMobile") || "false");
    chkAuto.checked = autosyncMobile;
    chkAuto.addEventListener("change", e => {
      autosyncMobile = !!e.target.checked;
      localStorage.setItem("autosyncMobile", JSON.stringify(autosyncMobile));
    });
  }

  // Suscripción a cambios remotos
  try {
    onSnapshot(cloudDocRef(), snap => {
      if (!snap.exists()) return;
      const remote = snap.data();
      const rU = remote?._cloud?.updatedAt || 0;
      const lU = state?._cloud?.updatedAt || 0;
      if (rU > lU) {
        state = ensureStateShape(remote || {});
        setSyncStatus("Actualizado desde la nube");
        renderAllMobile();
      }
    });
  } catch (e) {
    console.warn("onSnapshot móvil falló:", e);
  }
}

// ==================== Formularios: Ingreso rápido ====================

function wireIncomeFormMobile() {
  const form = $("#formIncome");
  if (!form) return;

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const date = $("#incDateMobile")?.value || todayStr();
    const client = $("#incClientMobile")?.value || "";
    const method = $("#incMethodMobile")?.value || "Efectivo";
    const amount = Number($("#incAmountMobile")?.value || 0);

    if (!date || !amount) {
      toast("Fecha y monto requeridos");
      return;
    }

    const rec = {
      id: uid(),
      date,
      client,
      method,
      amount
    };

    state.incomesDaily.push(rec);
    toast("Ingreso guardado");
    form.reset();
    saveAndMaybeSync();
  });
}

// ==================== Formularios: Gasto rápido ====================

function wireExpenseFormMobile() {
  const form = $("#formExpense");
  if (!form) return;

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const date = $("#expDateMobile")?.value || todayStr();
    const category = $("#expCategoryMobile")?.value || "";
    const method = $("#expMethodMobile")?.value || "Efectivo";
    const amount = Number($("#expAmountMobile")?.value || 0);

    if (!date || !amount) {
      toast("Fecha y monto requeridos");
      return;
    }

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
    toast("Gasto guardado");
    form.reset();
    saveAndMaybeSync();
  });
}

// ==================== Facturas: ítems + totales ====================

function addMobileItemRow() {
  const container = $("#invItemsContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "inv-item-row";
  row.innerHTML = `
    <input type="text" class="inv-desc" placeholder="Descripción">
    <input type="number" class="inv-qty"   step="1"   value="1">
    <input type="number" class="inv-price" step="0.01" value="0">
    <input type="number" class="inv-tax"   step="0.01" value="0">
    <span class="inv-amount">0.00</span>
    <button type="button" class="btn-outline btn-small btn-del-item">✕</button>
  `;
  container.appendChild(row);

  const btnDel = row.querySelector(".btn-del-item");
  if (btnDel) {
    btnDel.addEventListener("click", () => {
      row.remove();
      calcInvoiceTotalsMobile();
    });
  }

  ["input", "change"].forEach(evt => {
    row.addEventListener(evt, () => calcInvoiceTotalsMobile());
  });
}

function readInvoiceItemsMobile() {
  const container = $("#invItemsContainer");
  if (!container) return [];
  const rows = $all(".inv-item-row", container);
  return rows.map(r => {
    const desc = r.querySelector(".inv-desc")?.value || "";
    const qty = parseFloat(r.querySelector(".inv-qty")?.value || "0") || 0;
    const price = parseFloat(r.querySelector(".inv-price")?.value || "0") || 0;
    const tax = parseFloat(r.querySelector(".inv-tax")?.value || "0") || 0;
    return { id: uid(), desc, qty, price, tax };
  });
}

function calcTotals(items) {
  let subtotal = 0;
  let taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const taxAmt = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += taxAmt;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function calcInvoiceTotalsMobile() {
  const items = readInvoiceItemsMobile();
  const container = $("#invItemsContainer");
  if (container) {
    const rows = $all(".inv-item-row", container);
    rows.forEach((r, idx) => {
      const it = items[idx];
      if (!it) return;
      const base = (it.qty || 0) * (it.price || 0);
      const taxAmt = base * ((it.tax || 0) / 100);
      const amt = base + taxAmt;
      const span = r.querySelector(".inv-amount");
      if (span) span.textContent = amt.toFixed(2);
    });
  }

  const totals = calcTotals(items);
  const $sub = $("#invSubtotalMobile");
  const $tax = $("#invTaxMobile");
  const $tot = $("#invTotalMobile");
  if ($sub) $sub.textContent = fmt(totals.subtotal);
  if ($tax) $tax.textContent = fmt(totals.taxTotal);
  if ($tot) $tot.textContent = fmt(totals.total);
}

// ==================== Facturas: guardar ====================

function wireInvoiceFormMobile() {
  const btnAddItem = $("#btnAddItem");
  const btnCalc = $("#btnCalcInvoice");
  const form = $("#formInvoice");
  const btnWA = $("#btnSaveInvoiceWhatsApp");

  if (btnAddItem) {
    btnAddItem.addEventListener("click", () => {
      addMobileItemRow();
      calcInvoiceTotalsMobile();
    });
  }
  if (btnCalc) {
    btnCalc.addEventListener("click", () => {
      calcInvoiceTotalsMobile();
    });
  }

  if (form) {
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const date = $("#invDateMobile")?.value || todayStr();
      const number = ($("#invNumberMobile")?.value || "").trim();
      const clientName = $("#invClientMobile")?.value || "";
      const phone = $("#invPhoneMobile")?.value || "";
      const method = $("#invMethodMobile")?.value || "Efectivo";
      const note = $("#invNoteMobile")?.value || "";

      if (!date || !number) {
        toast("Fecha y número requeridos");
        return;
      }

      const items = readInvoiceItemsMobile();
      const totals = calcTotals(items);

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

      // Igual que Desktop: crear ingreso automático
      const income = {
        id: uid(),
        date,
        client: clientName,
        method,
        amount: totals.total,
        invoiceNumber: number
      };

      state.incomesDaily.push(income);
      state.invoices.push(inv);

      toast("Factura guardada y registrada en ingresos");
      form.reset();
      const container = $("#invItemsContainer");
      if (container) container.innerHTML = "";
      $("#invSubtotalMobile") && ($("#invSubtotalMobile").textContent = "—");
      $("#invTaxMobile") && ($("#invTaxMobile").textContent = "—");
      $("#invTotalMobile") && ($("#invTotalMobile").textContent = "—");

      saveAndMaybeSync();
    });
  }

  // Paso B: WhatsApp PRO → aquí solo dejamos placeholder por ahora
  if (btnWA) {
    btnWA.addEventListener("click", () => {
      toast("WhatsApp PRO lo hacemos en el paso B 😉");
    });
  }
}

// ==================== Render global móvil ====================

function renderAllMobile() {
  renderKpiMonthMobile();
  renderTodayInvoices();
}

// ==================== Navegación interna (botones Home/Ingreso/Gasto/Factura) ====================

function wireNavigationMobile() {
  const goIncome = $("#btnGoIncome");
  const goExpense = $("#btnGoExpense");
  const goInvoice = $("#btnGoInvoice");

  function showScreen(id) {
    const screens = $all(".screen");
    screens.forEach(s => s.classList.remove("active"));
    const target = $("#" + id);
    if (target) target.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (goIncome) goIncome.addEventListener("click", () => showScreen("screen-income"));
  if (goExpense) goExpense.addEventListener("click", () => showScreen("screen-expense"));
  if (goInvoice) goInvoice.addEventListener("click", () => showScreen("screen-invoice"));

  $all(".btn-back").forEach(btn => {
    btn.addEventListener("click", () => showScreen("screen-home"));
  });
}

// ==================== Init ====================

function initMobileApp() {
  wireNavigationMobile();
  wireCloudMobile();
  wireIncomeFormMobile();
  wireExpenseFormMobile();
  wireInvoiceFormMobile();

  // Primer render con estado vacío mientras llega la nube
  renderAllMobile();
  // Pull inicial
  cloudPullMobile();
}

document.addEventListener("DOMContentLoaded", initMobileApp);
