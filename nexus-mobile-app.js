// nexus-mobile-app.js
// Mini panel móvil Nexus Finance
// 🔥 Usa SOLO Firebase/Firestore como fuente de verdad
//    (mismo documento que Nexus Desktop).

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
  serverTimestamp
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

/* ===================== Estado en memoria (no localStorage) ===================== */

const DEFAULT_STATE = {
  settings: {
    businessName: "Mi Negocio",
    logoBase64: "",
    currency: "USD",
    theme: { primary: "#0B0D10", accent: "#C7A24B", text: "#F2F3F5" },
    pinHash: ""
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

let state = null;           // Se llena desde Firestore
let currentUser = null;
let cloudUnsub = null;

let autosyncMobile =
  JSON.parse(localStorage.getItem("nf-autosync-mobile") || "true");

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const todayStr = () => new Date().toISOString().slice(0, 10);
const toDate   = (s) => new Date(s);
const inRange  = (d, from, to) => {
  const t = +toDate(d || "1970-01-01");
  if (from && t < +toDate(from)) return false;
  if (to   && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
};
const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

function normalizeState(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_STATE));
  const merged = { ...base, ...raw };

  const arrays = [
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
  arrays.forEach((k) => {
    if (!Array.isArray(merged[k])) merged[k] = [];
  });
  if (!merged.settings) merged.settings = { ...DEFAULT_STATE.settings };
  if (!merged._cloud) merged._cloud = { updatedAt: 0 };
  return merged;
}

function fmt(n) {
  const cur = (state && state.settings && state.settings.currency) || "USD";
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

function toast(msg) {
  const t = $("#toast");
  if (!t) {
    console.log("[Toast]", msg);
    return;
  }
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

/* ===================== Helpers de sumas (igual que Desktop) ===================== */

function sumRange(list, from, to) {
  if (!Array.isArray(list)) return 0;
  return list
    .filter((r) => inRange(r.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function sumExpensesDailySplit(from, to) {
  let recurrent = 0,
    nonRec = 0;
  if (!state || !Array.isArray(state.expensesDaily)) return {
    total: 0,
    recurrent: 0,
    nonRecurrent: 0
  };

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
  if (!state || !Array.isArray(state.payments)) return 0;
  return state.payments
    .filter((p) => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumPersonalRange(from, to) {
  if (!state || !Array.isArray(state.personal)) return 0;
  return state.personal
    .filter((p) => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

/* ===================== Navegación pantallas ===================== */

function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  // siempre al tope al cambiar
  const app = $(".mobile-app");
  if (app) app.scrollTo({ top: 0, behavior: "smooth" });
}

function wireNavigation() {
  $("#btnGoIncome")?.addEventListener("click", () =>
    showScreen("screen-income")
  );
  $("#btnGoExpense")?.addEventListener("click", () =>
    showScreen("screen-expense")
  );
  $("#btnGoInvoice")?.addEventListener("click", () =>
    showScreen("screen-invoice")
  );

  $$(".btn-back").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.back || "home";
      showScreen(`screen-${target}`);
    });
  });
}

/* ===================== Render KPIs y Facturas ===================== */

function renderKPIs() {
  if (!state) {
    $("#kpi-income-today") && ($("#kpi-income-today").textContent = "—");
    $("#kpi-expenses-today") && ($("#kpi-expenses-today").textContent = "—");
    $("#kpi-balance-today") && ($("#kpi-balance-today").textContent = "—");
    return;
  }

  const now = new Date();
  const today = todayStr();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  // Ingresos hoy
  const incToday = sumRange(state.incomesDaily, today, today);

  // Gastos hoy (gastos + personales + nómina)
  const expTodaySplit = sumExpensesDailySplit(today, today);
  const perToday = sumPersonalRange(today, today);
  const payToday = sumPaymentsRange(today, today);
  const expToday = expTodaySplit.total + perToday + payToday;

  // Balance del mes (igual que Dashboard Desktop)
  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const expMonth = expMonthSplit.total + perMonth + payMonth;
  const balanceMonth = incMonth - expMonth;

  $("#kpi-income-today") &&
    ($("#kpi-income-today").textContent = fmt(incToday));
  $("#kpi-expenses-today") &&
    ($("#kpi-expenses-today").textContent = fmt(expToday));
  $("#kpi-balance-today") &&
    ($("#kpi-balance-today").textContent = fmt(balanceMonth));
}

function renderTodayInvoices() {
  const wrap = $("#todayInvoices");
  if (!wrap) return;
  if (!state) {
    wrap.textContent = "Conéctate para ver tus facturas.";
    wrap.classList.add("list-empty");
    return;
  }

  const today = todayStr();
  const list = (state.invoices || []).filter((f) => f.date === today);

  if (!list.length) {
    wrap.textContent = "No hay facturas registradas hoy.";
    wrap.classList.add("list-empty");
    return;
  }

  wrap.classList.remove("list-empty");
  wrap.innerHTML = "";
  list
    .sort((a, b) => (a.number || "").localeCompare(b.number || ""))
    .forEach((inv) => {
      const row = document.createElement("div");
      row.className = "invoice-row";

      const left = document.createElement("div");
      left.className = "invoice-left";

      const num = document.createElement("div");
      num.className = "invoice-number";
      num.textContent = inv.number || "Sin número";

      const cli = document.createElement("div");
      cli.className = "invoice-client";
      cli.textContent = inv.client?.name || "Sin cliente";

      left.appendChild(num);
      left.appendChild(cli);

      const right = document.createElement("div");
      right.className = "invoice-amount";
      right.textContent = fmt(inv.total || 0);

      row.appendChild(left);
      row.appendChild(right);

      wrap.appendChild(row);
    });
}

function applySettingsToHeader() {
  if (!state || !state.settings) return;
  const name = state.settings.businessName || "Nexus Finance";
  const logo = state.settings.logoBase64 || "assets/logo.png";

  const title = $(".brand-title");
  if (title) title.textContent = name;

  const img = $(".brand-logo");
  if (img) img.src = logo;
}

/* ===================== Formularios: Ingreso, Gasto, Factura ===================== */

function scheduleCloudPush() {
  if (!autosyncMobile || !currentUser || !state) return;
  clearTimeout(scheduleCloudPush._t);
  scheduleCloudPush._t = setTimeout(() => {
    cloudPushMobile().catch((e) => console.error("autosync push:", e));
  }, 800);
}

async function handleIncomeSubmit(ev) {
  ev.preventDefault();
  if (!state) return toast("Conéctate primero para cargar datos.");

  const date = $("#incDateMobile")?.value || todayStr();
  const client = $("#incClientMobile")?.value || "";
  const method = $("#incMethodMobile")?.value || "Efectivo";
  const amount = parseFloat($("#incAmountMobile")?.value || "0") || 0;

  if (!date || !amount) return toast("Fecha y monto son requeridos.");

  const rec = {
    id: uid(),
    date,
    client,
    method,
    amount
  };
  state.incomesDaily.push(rec);

  $("#formIncome")?.reset();
  $("#incDateMobile").value = date;

  renderKPIs();
  renderTodayInvoices();
  toast("Ingreso guardado");
  scheduleCloudPush();
}

async function handleExpenseSubmit(ev) {
  ev.preventDefault();
  if (!state) return toast("Conéctate primero para cargar datos.");

  const date = $("#expDateMobile")?.value || todayStr();
  const category = $("#expCategoryMobile")?.value || "";
  const method = $("#expMethodMobile")?.value || "Efectivo";
  const amount = parseFloat($("#expAmountMobile")?.value || "0") || 0;

  if (!date || !amount) return toast("Fecha y monto son requeridos.");

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

  $("#formExpense")?.reset();
  $("#expDateMobile").value = date;

  renderKPIs();
  renderTodayInvoices();
  toast("Gasto guardado");
  scheduleCloudPush();
}

/* ----- Ítems de factura ----- */

function createItemRow(desc = "", qty = 1, price = 0, tax = 0) {
  const row = document.createElement("div");
  row.className = "inv-item-row";
  row.innerHTML = `
    <input type="text" class="item-desc" placeholder="Descripción" value="${desc}">
    <input type="number" step="0.01" class="item-qty"   value="${qty}">
    <input type="number" step="0.01" class="item-price" value="${price}">
    <input type="number" step="0.01" class="item-tax"   value="${tax}">
    <button type="button" class="btn-small btn-remove">✕</button>
  `;
  row.querySelector(".btn-remove").addEventListener("click", () => {
    row.remove();
    calcInvoiceTotals();
  });
  ["item-desc", "item-qty", "item-price", "item-tax"].forEach((cls) => {
    row.querySelector("." + cls).addEventListener("input", calcInvoiceTotals);
  });
  return row;
}

function readItemsFromDOM() {
  const cont = $("#invItemsContainer");
  if (!cont) return [];
  const items = [];
  cont.querySelectorAll(".inv-item-row").forEach((row) => {
    const desc = row.querySelector(".item-desc")?.value || "";
    const qty = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
    const price =
      parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
    const tax =
      parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;
    items.push({ id: uid(), desc, qty, price, tax });
  });
  return items;
}

function calcTotals(items) {
  let subtotal = 0,
    taxTotal = 0;
  items.forEach((it) => {
    const base = (it.qty || 0) * (it.price || 0);
    const taxAmt = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += taxAmt;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function calcInvoiceTotals() {
  const items = readItemsFromDOM();
  const t = calcTotals(items);
  $("#invSubtotalMobile").textContent = fmt(t.subtotal);
  $("#invTaxMobile").textContent = fmt(t.taxTotal);
  $("#invTotalMobile").textContent = fmt(t.total);
  return t;
}

/* ----- jsPDF para factura individual ----- */

let jsPDFReady = false;
async function ensureJsPDF() {
  if (jsPDFReady) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src =
      "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  jsPDFReady = true;
}

async function generateInvoicePDF(inv) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const business =
    (state && state.settings && state.settings.businessName) ||
    "Mi Negocio";
  const logo = state?.settings?.logoBase64 || "assets/logo.png";

  // Header
  try {
    if (logo && logo.startsWith("data:")) {
      doc.addImage(logo, "PNG", 14, 10, 24, 24);
    }
  } catch (e) {
    console.warn("logo pdf", e);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(business, 42, 18);
  doc.setFontSize(12);
  doc.text("FACTURA", 42, 26);
  doc.line(14, 36, 200, 36);

  // Cliente
  let y = 42;
  doc.setFontSize(10);
  doc.text("Para:", 14, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  if (inv.client?.name) {
    doc.text(inv.client.name, 14, y);
    y += 6;
  }
  if (inv.client?.phone) {
    doc.text(inv.client.phone, 14, y);
    y += 6;
  }

  // Datos factura
  let ry = 42;
  const rx = 200;
  doc.setFont("helvetica", "bold");
  doc.text("Factura #", rx - 70, ry);
  doc.setFont("helvetica", "normal");
  doc.text(String(inv.number || ""), rx - 20, ry, { align: "right" });
  ry += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Fecha", rx - 70, ry);
  doc.setFont("helvetica", "normal");
  doc.text(String(inv.date || ""), rx - 20, ry, { align: "right" });
  ry += 6;

  // Tabla ítems
  y = Math.max(y, 74);
  doc.line(14, y, 200, y);
  y += 6;

  const headers = ["Descripción", "Cant.", "Precio", "Imp %", "Importe"];
  const colW = [90, 20, 30, 20, 20];
  doc.setFont("helvetica", "bold");
  let x = 14;
  headers.forEach((h, i) => {
    doc.text(h, x, y);
    x += colW[i];
  });
  y += 6;
  doc.line(14, y, 200, y);
  y += 6;
  doc.setFont("helvetica", "normal");

  inv.items.forEach((it) => {
    x = 14;
    const base = (it.qty || 0) * (it.price || 0);
    const taxAmt = base * ((it.tax || 0) / 100);
    const amt = base + taxAmt;
    const row = [
      it.desc || "",
      String(it.qty || 0),
      Number(it.price || 0).toFixed(2),
      String(it.tax || 0),
      amt.toFixed(2)
    ];
    row.forEach((c, i) => {
      doc.text(String(c).slice(0, 60), x, y);
      x += colW[i];
    });
    y += 6;
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
  });

  if (y + 30 > 290) {
    doc.addPage();
    y = 20;
  }
  y += 4;
  doc.line(120, y, 200, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Subtotal", 150, y);
  doc.setFont("helvetica", "normal");
  doc.text(fmt(inv.subtotal || 0), 198, y, { align: "right" });
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Impuestos", 150, y);
  doc.setFont("helvetica", "normal");
  doc.text(fmt(inv.taxTotal || 0), 198, y, { align: "right" });
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("TOTAL", 150, y);
  doc.text(fmt(inv.total || 0), 198, y, { align: "right" });
  y += 10;

  if (inv.note) {
    doc.setFont("helvetica", "bold");
    doc.text("Nota:", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(inv.note).slice(0, 240), 14, y + 6);
    y += 12;
  }

  const fileName =
    (business || "Negocio").replace(/\s+/g, "_") +
    "_Factura_" +
    (inv.number || "") +
    ".pdf";
  doc.save(fileName);
}

/* ----- Guardar factura + WhatsApp ----- */

async function handleInvoiceSubmit(ev, openWhatsApp = false) {
  ev.preventDefault();
  if (!state) return toast("Conéctate primero para cargar datos.");

  const date = $("#invDateMobile")?.value || todayStr();
  const number = $("#invNumberMobile")?.value || "";
  const clientName = $("#invClientMobile")?.value || "";
  const phoneRaw = $("#invPhoneMobile")?.value || "";
  const method = $("#invMethodMobile")?.value || "Efectivo";
  const note = $("#invNoteMobile")?.value || "";

  if (!date || !number) return toast("Fecha y número de factura requeridos.");

  const items = readItemsFromDOM();
  const totals = calcTotals(items);

  const inv = {
    id: uid(),
    date,
    dueDate: date,
    number,
    method,
    client: {
      name: clientName,
      phone: phoneRaw,
      email: "",
      address: ""
    },
    items,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    note,
    terms: ""
  };

  // También registramos ingreso (igual que Desktop)
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

  renderKPIs();
  renderTodayInvoices();
  toast("Factura guardada");
  scheduleCloudPush();

  // Limpia form pero mantiene fecha
  $("#formInvoice")?.reset();
  $("#invDateMobile").value = date;
  $("#invItemsContainer").innerHTML = "";
  $("#invSubtotalMobile").textContent = "—";
  $("#invTaxMobile").textContent = "—";
  $("#invTotalMobile").textContent = "—";

  if (openWhatsApp && phoneRaw) {
    const cleanPhone = phoneRaw.replace(/[^\d]/g, "");
    const msg =
      `Hola ${clientName || ""}, te envío el detalle de tu factura #${
        number
      } por ${fmt(totals.total)}.\n\n` +
      `Gracias por preferirnos.`;
    const waUrl =
      "https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent(msg);
    window.open(waUrl, "_blank");
  }

  // PDF al final (el usuario lo guarda/compartirá desde Safari)
  try {
    await generateInvoicePDF(inv);
  } catch (e) {
    console.error("PDF error", e);
  }
}

/* ===================== Firebase Cloud Sync (Mobile) ===================== */

function userDocRef() {
  if (!currentUser) return null;
  return doc(db, "users", currentUser.uid, "state", "app");
}

async function cloudPullMobile() {
  const ref = userDocRef();
  if (!ref) return toast("Inicia sesión con Google primero.");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    state = normalizeState(DEFAULT_STATE);
    toast("No hay datos en la nube todavía.");
  } else {
    state = normalizeState(snap.data());
    toast("Datos cargados desde la nube.");
  }
  applySettingsToHeader();
  renderKPIs();
  renderTodayInvoices();
}

async function cloudPushMobile() {
  const ref = userDocRef();
  if (!ref) return toast("Inicia sesión con Google primero.");
  if (!state) state = normalizeState(DEFAULT_STATE);
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = Date.now();
  await setDoc(
    ref,
    { ...state, _serverUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  toast("Datos enviados a la nube.");
}

function subscribeCloud() {
  const ref = userDocRef();
  if (!ref) return;

  cloudUnsub && cloudUnsub();
  cloudUnsub = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const remote = normalizeState(snap.data());
      // Si remoto es más nuevo, lo aplicamos
      if (
        !state ||
        (remote._cloud?.updatedAt || 0) >= (state._cloud?.updatedAt || 0)
      ) {
        state = remote;
        applySettingsToHeader();
        renderKPIs();
        renderTodayInvoices();
      }
    },
    (err) => {
      console.error("onSnapshot mobile", err);
      toast("Error escuchando cambios en la nube.");
    }
  );
}

/* ===================== UI de Sync en la tarjeta ===================== */

function updateSyncStatusUI() {
  const status = $("#syncStatusMobile");
  const chk = $("#chkAutosyncMobile");
  const signInBtn = $("#btnSignInMobile");
  const signOutBtn = $("#btnSignOutMobile");

  if (chk) chk.checked = !!autosyncMobile;

  if (!status) return;
  if (!currentUser) {
    status.textContent = "Sin conexión";
    signInBtn && (signInBtn.style.display = "block");
    signOutBtn && (signOutBtn.style.display = "none");
  } else {
    status.textContent =
      "Conectado como " +
      (currentUser.displayName || currentUser.email || currentUser.uid);
    signInBtn && (signInBtn.style.display = "none");
    signOutBtn && (signOutBtn.style.display = "block");
  }
}

function wireSyncUI() {
  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch {
        await signInWithRedirect(auth, provider);
      }
    } catch (e) {
      console.error("signIn mobile", e);
      toast("No se pudo iniciar sesión.");
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      state = null;
      cloudUnsub && cloudUnsub();
      cloudUnsub = null;
      renderKPIs();
      renderTodayInvoices();
      toast("Sesión cerrada.");
    } catch (e) {
      console.error("signOut mobile", e);
      toast("Error al cerrar sesión.");
    }
  });

  $("#btnSyncPullMobile")?.addEventListener("click", () => {
    cloudPullMobile().catch((e) =>
      console.error("pull mobile", e)
    );
  });
  $("#btnSyncPushMobile")?.addEventListener("click", () => {
    cloudPushMobile().catch((e) =>
      console.error("push mobile", e)
    );
  });

  $("#chkAutosyncMobile")?.addEventListener("change", (e) => {
    autosyncMobile = !!e.target.checked;
    localStorage.setItem(
      "nf-autosync-mobile",
      JSON.stringify(autosyncMobile)
    );
    updateSyncStatusUI();
  });
}

/* ===================== Arranque ===================== */

function wireForms() {
  $("#formIncome")?.addEventListener("submit", handleIncomeSubmit);
  $("#formExpense")?.addEventListener("submit", handleExpenseSubmit);

  $("#btnAddItem")?.addEventListener("click", () => {
    const cont = $("#invItemsContainer");
    if (!cont) return;
    cont.appendChild(createItemRow());
  });

  $("#btnCalcInvoice")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    calcInvoiceTotals();
  });

  $("#formInvoice")?.addEventListener("submit", (ev) =>
    handleInvoiceSubmit(ev, false)
  );
  $("#btnSaveInvoiceWhatsApp")?.addEventListener("click", (ev) =>
    handleInvoiceSubmit(ev, true)
  );

  // Fechas por defecto = hoy
  if ($("#incDateMobile")) $("#incDateMobile").value = todayStr();
  if ($("#expDateMobile")) $("#expDateMobile").value = todayStr();
  if ($("#invDateMobile")) $("#invDateMobile").value = todayStr();
}

function init() {
  wireNavigation();
  wireForms();
  wireSyncUI();
  updateSyncStatusUI();

  // Auth listener
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    updateSyncStatusUI();
    if (currentUser) {
      subscribeCloud();
    } else {
      cloudUnsub && cloudUnsub();
      cloudUnsub = null;
      state = null;
      renderKPIs();
      renderTodayInvoices();
    }
  });

  // Pantalla inicial
  showScreen("screen-home");
}

document.addEventListener("DOMContentLoaded", init);
