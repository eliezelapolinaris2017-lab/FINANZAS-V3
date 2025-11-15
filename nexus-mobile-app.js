// nexus-mobile-app.js  (VERSIÓN CORREGIDA)

/* =================== Firebase (mismo proyecto que Desktop) =================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
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

/* =================== Helpers base =================== */
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
const toDate   = (s) => new Date(s || "1970-01-01");

function inRange(dateStr, from, to) {
  const t = +toDate(dateStr);
  if (from && t < +toDate(from)) return false;
  if (to   && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
}

/* ===== cargar / guardar estado compartido con Desktop ===== */
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
  const cur = state.settings.currency || "USD";
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

function saveState({ skipCloud = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  refreshHome();
  renderTodayInvoices();
  if (!skipCloud && cloud.autosync && cloud.user) {
    cloudPushDebounced();
  }
}

/* ===== toast pequeño ===== */
function showToast(msg) {
  const el = $("#toast");
  if (!el) {
    console.log("[Toast]", msg);
    return;
  }
  el.textContent = msg;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 2600);
}

/* =================== Cálculos (idénticos a Desktop) =================== */
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

/* =================== HOME: KPIs + facturas de hoy =================== */
function refreshHome() {
  const today = todayStr();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  // === Ingresos / gastos HOY (igual Reportes Desktop) ===
  const incToday = sumRange(state.incomesDaily, today, today);

  const expTodaySplit = sumExpensesDailySplit(today, today);
  const perToday = sumPersonalRange(today, today);
  const payToday = sumPaymentsRange(today, today);
  const expToday = expTodaySplit.total + perToday + payToday;

  // === Balance del MES (igual Reportes Desktop, no YTD) ===
  const incMonth = sumRange(state.incomesDaily, monthStart, today);

  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const expMonth = expMonthSplit.total + perMonth + payMonth;
  const balanceMonth = incMonth - expMonth;

  const incEl = $("#kpi-income-today");
  const expEl = $("#kpi-expenses-today");
  const balEl = $("#kpi-balance-today");

  if (incEl) incEl.textContent = fmt(incToday);
  if (expEl) expEl.textContent = fmt(expToday);
  if (balEl) balEl.textContent = fmt(balanceMonth);

  // Cambiar etiqueta a "Balance mes" sin tocar tu HTML
  const balLabel = balEl?.closest(".kpi-card")?.querySelector(".kpi-label");
  if (balLabel) balLabel.textContent = "Balance mes";
}

function renderTodayInvoices() {
  const wrap = $("#todayInvoices");
  if (!wrap) return;

  const today = todayStr();
  const list = state.invoices
    .filter((inv) => (inv.date || "").slice(0, 10) === today)
    .sort((a, b) => (b.number || "").localeCompare(a.number || ""));

  if (!list.length) {
    wrap.className = "list-empty";
    wrap.textContent = "No hay facturas registradas hoy.";
    return;
  }

  wrap.className = "today-invoice-list";
  wrap.innerHTML = "";
  list.forEach((inv) => {
    const row = document.createElement("div");
    row.className = "invoice-row";
    row.innerHTML = `
      <div class="invoice-main">
        <div class="inv-number">${inv.number || "—"}</div>
        <div class="inv-client">${inv.client?.name || "Sin cliente"}</div>
      </div>
      <div class="inv-total">${fmt(inv.total || 0)}</div>
    `;
    wrap.appendChild(row);
  });
}

/* =================== Navegación entre pantallas =================== */
function showScreen(id) {
  $$(".screen").forEach((s) =>
    s.classList.toggle("active", s.id === `screen-${id}`)
  );
}

function wireNavigation() {
  $("#btnGoIncome")?.addEventListener("click", () => showScreen("income"));
  $("#btnGoExpense")?.addEventListener("click", () => showScreen("expense"));
  $("#btnGoInvoice")?.addEventListener("click", () => showScreen("invoice"));

  $$(".btn-back").forEach((btn) => {
    const back = btn.dataset.back || "home";
    btn.addEventListener("click", () => showScreen(back));
  });
}

/* =================== Formularios rápidos ingreso / gasto =================== */
function wireQuickIncome() {
  const form = $("#formIncome");
  if (!form) return;

  $("#incDateMobile").value = todayStr();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const date = $("#incDateMobile").value || todayStr();
    const client = $("#incClientMobile").value || "";
    const method = $("#incMethodMobile").value || "Efectivo";
    const amount = parseFloat($("#incAmountMobile").value || "0") || 0;

    if (!amount) {
      showToast("Monto requerido");
      return;
    }

    const rec = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      date,
      client,
      method,
      amount
    };

    state.incomesDaily.push(rec);
    saveState();
    form.reset();
    $("#incDateMobile").value = todayStr();
    showToast("Ingreso guardado");
    showScreen("home");
  });
}

function wireQuickExpense() {
  const form = $("#formExpense");
  if (!form) return;

  $("#expDateMobile").value = todayStr();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const date = $("#expDateMobile").value || todayStr();
    const category = $("#expCategoryMobile").value || "";
    const method = $("#expMethodMobile").value || "Efectivo";
    const amount = parseFloat($("#expAmountMobile").value || "0") || 0;

    if (!amount) {
      showToast("Monto requerido");
      return;
    }

    const rec = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      date,
      category,
      desc: category || "Gasto rápido",
      method,
      amount,
      note: ""
    };

    state.expensesDaily.push(rec);
    saveState();
    form.reset();
    $("#expDateMobile").value = todayStr();
    showToast("Gasto guardado");
    showScreen("home");
  });
}

/* =================== FACTURA MÓVIL =================== */
function addItemRow() {
  const cont = $("#invItemsContainer");
  if (!cont) return;
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text" class="item-desc" placeholder="Descripción">
    <input type="number" step="0.01" class="item-qty"   placeholder="Cant." value="1">
    <input type="number" step="0.01" class="item-price" placeholder="Precio" value="0">
    <input type="number" step="0.01" class="item-tax"   placeholder="% Imp." value="0">
    <button type="button" class="btn-remove-item">✕</button>
  `;
  cont.appendChild(row);
  row.querySelector(".btn-remove-item").addEventListener("click", () => {
    row.remove();
    calcInvoiceTotals();
  });

  ["item-qty", "item-price", "item-tax"].forEach((cls) => {
    row.querySelector("." + cls).addEventListener("input", calcInvoiceTotals);
  });
}

function readItems() {
  const cont = $("#invItemsContainer");
  if (!cont) return [];
  const rows = $$(".item-row", cont);
  const items = [];
  rows.forEach((row) => {
    const desc = row.querySelector(".item-desc").value || "";
    const qty = parseFloat(row.querySelector(".item-qty").value || "0") || 0;
    const price = parseFloat(row.querySelector(".item-price").value || "0") || 0;
    const tax = parseFloat(row.querySelector(".item-tax").value || "0") || 0;
    items.push({ desc, qty, price, tax });
  });
  return items;
}

function calcTotals(items) {
  let subtotal = 0,
    taxTotal = 0;
  items.forEach((it) => {
    const base = (it.qty || 0) * (it.price || 0);
    const tx = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tx;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function calcInvoiceTotals() {
  const items = readItems();
  const t = calcTotals(items);
  $("#invSubtotalMobile").textContent = items.length ? fmt(t.subtotal) : "—";
  $("#invTaxMobile").textContent = items.length ? fmt(t.taxTotal) : "—";
  $("#invTotalMobile").textContent = items.length ? fmt(t.total) : "—";
  return t;
}

/* ===== PDF Factura (mismo estilo Desktop, con logo) ===== */
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
  const docPDF = new jsPDF({ unit: "mm", format: "a4" });

  const business = state.settings.businessName || "Mi Negocio";
  const logo = state.settings.logoBase64; // mismo logo Desktop

  function header(title) {
    try {
      if (logo && logo.startsWith("data:")) {
        docPDF.addImage(logo, "PNG", 14, 10, 24, 24);
      }
    } catch (e) {
      console.warn("Logo PDF móvil:", e);
    }
    docPDF.setFont("helvetica", "bold");
    docPDF.setTextColor(0);
    docPDF.setFontSize(16);
    docPDF.text(business, 42, 18);
    docPDF.setFontSize(12);
    docPDF.text(title, 42, 26);
    docPDF.line(14, 36, 200, 36);
  }

  header("FACTURA");

  let y = 42;
  docPDF.setFont("helvetica", "bold");
  docPDF.text("Para:", 14, y);
  y += 6;
  docPDF.setFont("helvetica", "normal");
  if (inv.client?.name) {
    docPDF.text(String(inv.client.name), 14, y);
    y += 6;
  }
  if (inv.client?.phone) {
    docPDF.text(String(inv.client.phone), 14, y);
    y += 6;
  }

  let ry = 42;
  const rx = 200;
  docPDF.setFont("helvetica", "bold");
  docPDF.text("Factura #", rx - 70, ry);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(String(inv.number || ""), rx - 20, ry, { align: "right" });
  ry += 6;
  docPDF.setFont("helvetica", "bold");
  docPDF.text("Fecha", rx - 70, ry);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(String(inv.date || ""), rx - 20, ry, { align: "right" });
  ry += 6;

  y = Math.max(y, 74);
  docPDF.line(14, y, 200, y);
  y += 6;

  const headers = ["Descripción", "Cant.", "Precio", "Imp %", "Importe"];
  const colW = [90, 20, 30, 20, 20];
  docPDF.setFont("helvetica", "bold");
  let x = 14;
  headers.forEach((h, i) => {
    docPDF.text(h, x, y);
    x += colW[i];
  });
  y += 6;
  docPDF.line(14, y, 200, y);
  y += 6;
  docPDF.setFont("helvetica", "normal");

  inv.items.forEach((it) => {
    x = 14;
    const base = (it.qty || 0) * (it.price || 0);
    const taxAmt = base * ((it.tax || 0) / 100);
    const amt = base + taxAmt;
    const row = [
      it.desc || "",
      String(it.qty || 0),
      (it.price || 0).toFixed(2),
      String(it.tax || 0),
      amt.toFixed(2)
    ];
    row.forEach((c, i) => {
      docPDF.text(String(c).slice(0, 60), x, y);
      x += colW[i];
    });
    y += 6;
    if (y > 260) {
      docPDF.addPage();
      y = 20;
    }
  });

  if (y + 30 > 290) {
    docPDF.addPage();
    y = 20;
  }
  y += 4;
  docPDF.line(120, y, 200, y);
  y += 6;

  const t = calcTotals(inv.items);
  docPDF.setFont("helvetica", "bold");
  docPDF.text("Subtotal", 150, y);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(fmt(t.subtotal), 198, y, { align: "right" });
  y += 6;
  docPDF.setFont("helvetica", "bold");
  docPDF.text("Impuestos", 150, y);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(fmt(t.taxTotal), 198, y, { align: "right" });
  y += 6;
  docPDF.setFont("helvetica", "bold");
  docPDF.text("TOTAL", 150, y);
  docPDF.text(fmt(t.total), 198, y, { align: "right" });

  const fileName =
    (business || "Negocio").replace(/\s+/g, "_") +
    "_Factura_" +
    (inv.number || "") +
    ".pdf";
  docPDF.save(fileName);
}

/* ===== Guardar factura + WhatsApp ===== */
function wireInvoiceForm() {
  const form = $("#formInvoice");
  if (!form) return;
  $("#invDateMobile").value = todayStr();

  $("#btnAddItem")?.addEventListener("click", () => {
    addItemRow();
    calcInvoiceTotals();
  });

  $("#btnCalcInvoice")?.addEventListener("click", () => {
    calcInvoiceTotals();
    showToast("Totales actualizados");
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    saveInvoice(false);
  });

  $("#btnSaveInvoiceWhatsApp")?.addEventListener("click", () => {
    saveInvoice(true);
  });
}

function saveInvoice(openWhatsApp) {
  const date = $("#invDateMobile").value || todayStr();
  const number = $("#invNumberMobile").value.trim();
  const clientName = $("#invClientMobile").value.trim();
  const phone = $("#invPhoneMobile").value.trim();
  const method = $("#invMethodMobile").value || "Efectivo";
  const note = $("#invNoteMobile").value || "";

  const items = readItems();
  const t = calcTotals(items);

  if (!number) {
    showToast("# de factura requerido");
    return;
  }
  if (!items.length) {
    showToast("Añade al menos un ítem");
    return;
  }

  const inv = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
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
    subtotal: t.subtotal,
    taxTotal: t.taxTotal,
    total: t.total,
    note,
    terms: ""
  };

  // igual que Desktop: también crear ingreso
  const income = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_i",
    date,
    client: clientName,
    method,
    amount: t.total,
    invoiceNumber: number
  };

  state.invoices.push(inv);
  state.incomesDaily.push(income);
  saveState();

  showToast("Factura guardada");

  // PDF siempre disponible
  generateInvoicePDF(inv).catch((e) =>
    console.error("PDF móvil error:", e)
  );

  if (openWhatsApp && phone) {
    const clean = phone.replace(/[^\d]/g, "");
    const msgLines = [
      `Hola ${clientName || "cliente"},`,
      `Adjunto detalle de su factura #${number}.`,
      "",
      `Total: ${fmt(t.total)}`,
      "",
      state.settings.businessName || "Mi Negocio"
    ];
    const url =
      "https://wa.me/" +
      clean +
      "?text=" +
      encodeURIComponent(msgLines.join("\n"));
    window.open(url, "_blank");
  }

  // reset
  $("#formInvoice").reset();
  $("#invDateMobile").value = todayStr();
  $("#invItemsContainer").innerHTML = "";
  $("#invSubtotalMobile").textContent = "—";
  $("#invTaxMobile").textContent = "—";
  $("#invTotalMobile").textContent = "—";
  showScreen("home");
}

/* =================== Firebase: cloud sync igual que Desktop =================== */
const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem("autosync") || "false")
};

function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}

async function cloudPullMobile() {
  const ref = cloudDocRef();
  if (!ref) {
    showToast("Conéctate con Google primero");
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    showToast("No hay datos en la nube");
    return;
  }
  const remote = snap.data();
  const rU = remote?._cloud?.updatedAt || 0;
  const lU = state?._cloud?.updatedAt || 0;

  // si remoto es más nuevo, reemplazamos; si no, fusionamos
  if (rU >= lU) {
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
    state._cloud = { updatedAt: Math.max(lU, rU) };
  }
  saveState({ skipCloud: true });
  showToast("Datos cargados desde la nube");
}

async function cloudPushMobile() {
  const ref = cloudDocRef();
  if (!ref) {
    showToast("Conéctate con Google primero");
    return;
  }
  state._cloud.updatedAt = Date.now();
  await setDoc(
    ref,
    { ...state, _serverUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  saveState({ skipCloud: true });
  showToast("Datos enviados a la nube");
}

let pushTimer;
function cloudPushDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPushMobile, 600);
}

function updateCloudUI() {
  $("#syncStatusMobile").textContent = cloud.user
    ? `Conectado como ${cloud.user.displayName || cloud.user.email || ""}`
    : "Sin conexión";

  $("#btnSignInMobile").style.display = cloud.user ? "none" : "block";
  $("#btnSignOutMobile").style.display = cloud.user ? "block" : "none";

  $("#chkAutosyncMobile").checked = !!cloud.autosync;
}

function setAutosyncMobile(v) {
  cloud.autosync = !!v;
  localStorage.setItem("autosync", JSON.stringify(cloud.autosync));
  updateCloudUI();
}

function wireCloudButtons() {
  const provider = new GoogleAuthProvider();

  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.warn("signIn popup error, intentando redirect:", e);
      await signInWithRedirect(auth, provider);
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    await signOut(auth);
    showToast("Sesión cerrada");
  });

  $("#btnSyncPullMobile")?.addEventListener("click", () => {
    cloudPullMobile().catch((e) =>
      console.error("cloudPullMobile error:", e)
    );
  });

  $("#btnSyncPushMobile")?.addEventListener("click", () => {
    cloudPushMobile().catch((e) =>
      console.error("cloudPushMobile error:", e)
    );
  });

  $("#chkAutosyncMobile")?.addEventListener("change", (e) => {
    setAutosyncMobile(e.target.checked);
  });

  updateCloudUI();

  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, (user) => {
    cloud.user = user || null;
    updateCloudUI();
  });
}

/* =================== INIT =================== */
function initMobileApp() {
  // cargar estado, pintar KPIs y facturas de hoy
  state = loadState();
  refreshHome();
  renderTodayInvoices();

  wireNavigation();
  wireQuickIncome();
  wireQuickExpense();
  wireInvoiceForm();
  wireCloudButtons();

  // asegurar al menos una fila de ítem en factura
  if (!$("#invItemsContainer").children.length) {
    addItemRow();
    calcInvoiceTotals();
  }
}

document.addEventListener("DOMContentLoaded", initMobileApp);

// debug en consola si quieres
window.nexusMobile = {
  getState: () => state,
  cloudPullMobile,
  cloudPushMobile
};
