// nexus-mobile-app.js  (versión móvil conectada a Desktop + Firebase + PDF)
// =======================================================================
// - Usa el MISMO state que Nexus Desktop (STORAGE_KEY = finanzas-state-v10)
// - KPIs: Ingresos hoy / Gastos hoy / Balance mes
// - Facturas: guarda en invoices + incomesDaily y genera PDF con el mismo logo
// - Firebase: usa mismo proyecto y mismo doc que Desktop
// =======================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/* ============= Firebase config (MISMA QUE DESKTOP) ============= */
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

/* ==================== Estado compartido ==================== */
const STORAGE_KEY   = "finanzas-state-v10";      // **MISMO QUE DESKTOP**
const AUTOSYNC_KEY  = "nf_mobile_autosync";

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

let state      = loadState();
let currentUser = null;
let autosync   = JSON.parse(localStorage.getItem(AUTOSYNC_KEY) || "false");
let pushTimer  = null;

/* ==================== Helpers básicos ==================== */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const todayStr = () => new Date().toISOString().slice(0,10);
const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const st = JSON.parse(raw);

    for (const k of Object.keys(DEFAULT_STATE)) {
      if (!(k in st)) st[k] = structuredClone(DEFAULT_STATE[k]);
    }
    if (!st.settings.currency) st.settings.currency = "USD";
    if (!st._cloud) st._cloud = { updatedAt: 0 };
    [
      "expensesDaily","incomesDaily","payments","ordinary","budgets",
      "personal","invoices","quotes","reconciliations"
    ].forEach(k => { if (!Array.isArray(st[k])) st[k] = []; });

    return st;
  } catch (e) {
    console.error("loadState error", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderHome();
  if (!options.skipCloud && currentUser && autosync) {
    cloudPushDebounced();
  }
}

function formatMoney(n) {
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

function toast(msg) {
  const t = $("#toast");
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

/* ==================== Navegación de pantallas ==================== */
function showScreen(id) {
  // id = "home" | "income" | "expense" | "invoice"
  $$(".screen").forEach(sc => {
    const isTarget = sc.id === `screen-${id}`;
    sc.classList.toggle("active", isTarget);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ==================== Render principal (home móvil) ==================== */
function renderHome() {
  const now    = new Date();
  const today  = now.toISOString().slice(0,10);
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1)
                   .toISOString().slice(0,10);

  // ---- Totales de HOY ----
  const incomeToday = state.incomesDaily
    .filter(r => r.date === today)
    .reduce((a, b) => a + Number(b.amount || 0), 0);

  const expensesToday = state.expensesDaily
    .filter(e => e.date === today)
    .reduce((a, b) => a + Number(b.amount || 0), 0);

  // ---- Balance del MES (ingresos mes – gastos mes) ----
  const incMonth = state.incomesDaily
    .filter(r => r.date >= mStart && r.date <= today)
    .reduce((a, b) => a + Number(b.amount || 0), 0);

  // gastos diarios + personales + nómina del mes
  const expMonthDaily = state.expensesDaily
    .filter(e => e.date >= mStart && e.date <= today)
    .reduce((a, b) => a + Number(b.amount || 0), 0);

  const expMonthPersonal = state.personal
    .filter(p => p.date >= mStart && p.date <= today)
    .reduce((a, b) => a + Number(b.amount || 0), 0);

  const expMonthPayroll = state.payments
    .filter(p => p.date >= mStart && p.date <= today)
    .reduce((a, b) => a + Number(b.amount || 0), 0);

  const expensesMonth = expMonthDaily + expMonthPersonal + expMonthPayroll;
  const balanceMonth  = incMonth - expensesMonth;

  // KPIs
  $("#kpi-income-today").textContent   = formatMoney(incomeToday);
  $("#kpi-expenses-today").textContent = formatMoney(expensesToday);
  $("#kpi-balance-today").textContent  = formatMoney(balanceMonth);

  // Cambiar texto de la tercera tarjeta a "Balance mes" sin tocar tu HTML
  const balLabel = $("#kpi-balance-today")?.previousElementSibling;
  if (balLabel && balLabel.classList.contains("kpi-label")) {
    balLabel.textContent = "Balance mes";
  }

  // ---- Facturas de hoy (Desktop + móvil) ----
  const todayInvoices = state.invoices.filter(f => f.date === today);
  const cont = $("#todayInvoices");
  if (cont) {
    if (!todayInvoices.length) {
      cont.innerHTML = `<div class="list-empty">No hay facturas registradas hoy.</div>`;
    } else {
      cont.innerHTML = todayInvoices.map(f => `
        <div class="invoice-row">
          <div>
            <strong>${f.number || "Sin #"} </strong><br>
            <span class="sub">${(f.client && f.client.name) || f.client || "Sin cliente"}</span>
          </div>
          <strong>${formatMoney(f.total || 0)}</strong>
        </div>
      `).join("");
    }
  }

  // ---- Estado de sync ----
  updateSyncUI();
}

/* ==================== Formularios rápidos ==================== */
function initQuickForms() {
  if ($("#incDateMobile")) $("#incDateMobile").value = todayStr();
  if ($("#expDateMobile")) $("#expDateMobile").value = todayStr();
  if ($("#invDateMobile")) $("#invDateMobile").value = todayStr();

  $("#btnGoIncome") ?.addEventListener("click", () => showScreen("income"));
  $("#btnGoExpense")?.addEventListener("click", () => showScreen("expense"));
  $("#btnGoInvoice")?.addEventListener("click", () => showScreen("invoice"));

  $$(".btn-back").forEach(btn => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back || "home"));
  });

  // ----- Nuevo ingreso rápido -----
  $("#formIncome")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const rec = {
      id: uid(),
      date:   $("#incDateMobile")?.value || todayStr(),
      client: $("#incClientMobile")?.value || "",
      method: $("#incMethodMobile")?.value || "Efectivo",
      amount: Number($("#incAmountMobile")?.value || 0)
    };
    if (!rec.date || !rec.amount) {
      toast("Fecha y monto requeridos");
      return;
    }
    state.incomesDaily.push(rec);
    saveState();
    toast("Ingreso guardado");
    ev.target.reset();
    $("#incDateMobile").value = todayStr();
    showScreen("home");
  });

  // ----- Nuevo gasto rápido -----
  $("#formExpense")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: $("#expDateMobile")?.value || todayStr(),
      category: $("#expCategoryMobile")?.value || "Otros",
      method: $("#expMethodMobile")?.value || "Efectivo",
      amount: Number($("#expAmountMobile")?.value || 0)
    };
    if (!rec.date || !rec.amount) {
      toast("Fecha y monto requeridos");
      return;
    }
    state.expensesDaily.push(rec);
    saveState();
    toast("Gasto guardado");
    ev.target.reset();
    $("#expDateMobile").value = todayStr();
    showScreen("home");
  });

  // ----- Ítems de factura -----
  $("#btnAddItem")?.addEventListener("click", () => addItemRow());
  $("#btnCalcInvoice")?.addEventListener("click", () => updateInvoiceTotals());

  // Guardar factura (solo guardar + PDF)
  $("#formInvoice")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    saveInvoice(false);
  });

  // Guardar + abrir WhatsApp + PDF
  $("#btnSaveInvoiceWhatsApp")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    saveInvoice(true);
  });
}

/* ==================== Factura móvil ==================== */
function addItemRow() {
  const cont = $("#invItemsContainer");
  if (!cont) return;
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text"  class="item-desc"  placeholder="Descripción">
    <input type="number" step="0.01" class="item-qty"   placeholder="Cant."   value="1">
    <input type="number" step="0.01" class="item-price" placeholder="Precio">
    <input type="number" step="0.01" class="item-tax"   placeholder="Imp %" value="0">
    <button type="button" class="btn-outline btn-small item-del">✕</button>
  `;
  row.querySelector(".item-del").addEventListener("click", () => {
    row.remove();
    updateInvoiceTotals();
  });
  cont.appendChild(row);
}

function collectItems() {
  const rows = $$("#invItemsContainer .item-row");
  return rows.map(r => {
    const desc  = $(".item-desc",  r)?.value.trim() || "";
    const qty   = parseFloat($(".item-qty",   r)?.value || "0") || 0;
    const price = parseFloat($(".item-price", r)?.value || "0") || 0;
    const tax   = parseFloat($(".item-tax",   r)?.value || "0") || 0;
    return { id: uid(), desc, qty, price, tax };
  }).filter(it => it.qty > 0 && (it.price > 0 || it.desc));
}

function calcTotals(items) {
  let subtotal = 0, taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tax;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function updateInvoiceTotals() {
  const items = collectItems();
  const t = calcTotals(items);
  $("#invSubtotalMobile").textContent = items.length ? formatMoney(t.subtotal) : "—";
  $("#invTaxMobile").textContent      = items.length ? formatMoney(t.taxTotal) : "—";
  $("#invTotalMobile").textContent    = items.length ? formatMoney(t.total) : "—";
}

/* ==================== jsPDF para facturas ==================== */
let jsPDFReady = false;
async function ensureJsPDF() {
  if (jsPDFReady) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  jsPDFReady = true;
}

async function generateInvoicePDFMobile(invoice) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const business = state.settings.businessName || "Mi Negocio";
  const logo = state.settings.logoBase64 || "";

  // Header
  try {
    if (logo && logo.startsWith("data:")) {
      doc.addImage(logo, "PNG", 14, 10, 24, 24);
    }
  } catch (e) { console.warn("Logo PDF:", e); }

  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.setFontSize(16);
  doc.text(business, 42, 18);
  doc.setFontSize(12);
  doc.text("FACTURA", 42, 26);
  doc.line(14, 36, 200, 36);

  let y = 42;

  // Datos cliente
  doc.setFontSize(10);
  doc.text("Para:", 14, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  if (invoice.client?.name)   { doc.text(String(invoice.client.name), 14, y); y += 6; }
  if (invoice.client?.phone)  { doc.text(String(invoice.client.phone), 14, y); y += 6; }
  if (invoice.client?.email)  { doc.text(String(invoice.client.email || ""), 14, y); y += 6; }

  // Datos factura a la derecha
  let ry = 42;
  const rx = 200;
  doc.setFont("helvetica","bold");
  doc.text("Factura #", rx-70, ry);
  doc.setFont("helvetica","normal");
  doc.text(String(invoice.number || ""), rx-20, ry, { align: "right" }); ry += 6;

  doc.setFont("helvetica","bold");
  doc.text("Fecha", rx-70, ry);
  doc.setFont("helvetica","normal");
  doc.text(String(invoice.date || ""), rx-20, ry, { align: "right" }); ry += 6;

  // Tabla de ítems
  y = Math.max(y, 74);
  doc.line(14, y, 200, y); y += 6;
  const headers = ["Descripción","Cant.","Precio","Imp %","Importe"];
  const colW    = [90,20,30,20,20];

  doc.setFont("helvetica","bold");
  let x = 14;
  headers.forEach((h,i) => { doc.text(h, x, y); x += colW[i]; });
  y += 6;
  doc.line(14,y,200,y); y += 6;
  doc.setFont("helvetica","normal");

  invoice.items.forEach(it => {
    x = 14;
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0)/100);
    const amt  = base + tax;
    const row = [
      it.desc || "",
      String(it.qty || 0),
      Number(it.price || 0).toFixed(2),
      String(it.tax || 0),
      amt.toFixed(2)
    ];
    row.forEach((c,i) => {
      doc.text(String(c).slice(0,60), x, y);
      x += colW[i];
    });
    y += 6;
    if (y > 260) { doc.addPage(); y = 20; }
  });

  if (y + 30 > 290) { doc.addPage(); y = 20; }
  y += 4;
  doc.line(120, y, 200, y); y += 6;

  doc.setFont("helvetica","bold");
  doc.text("Subtotal", 150, y);
  doc.setFont("helvetica","normal");
  doc.text(formatMoney(invoice.subtotal || 0), 198, y, { align: "right" }); y += 6;

  doc.setFont("helvetica","bold");
  doc.text("Impuestos", 150, y);
  doc.setFont("helvetica","normal");
  doc.text(formatMoney(invoice.taxTotal || 0), 198, y, { align: "right" }); y += 6;

  doc.setFont("helvetica","bold");
  doc.text("TOTAL", 150, y);
  doc.setFont("helvetica","bold");
  doc.text(formatMoney(invoice.total || 0), 198, y, { align: "right" }); y += 10;

  if (invoice.note) {
    doc.setFont("helvetica","bold");
    doc.text("Nota:", 14, y);
    doc.setFont("helvetica","normal");
    doc.text(String(invoice.note).slice(0,240), 14, y+6);
    y += 12;
  }

  const fileName = `${(business || "Negocio").replace(/\s+/g,"_")}_Factura_${invoice.number || ""}.pdf`;
  doc.save(fileName);
}

/* Guarda factura + income + PDF, y opcional WhatsApp */
function saveInvoice(openWhatsApp) {
  const date        = $("#invDateMobile")?.value || todayStr();
  const number      = $("#invNumberMobile")?.value.trim();
  const clientName  = $("#invClientMobile")?.value.trim();
  const phoneRaw    = $("#invPhoneMobile")?.value || "";
  const method      = $("#invMethodMobile")?.value || "Efectivo";
  const note        = $("#invNoteMobile")?.value || "";
  const items       = collectItems();
  const totals      = calcTotals(items);

  if (!date || !number) {
    toast("Fecha y número de factura son requeridos");
    return;
  }
  if (!items.length) {
    toast("Añade al menos un ítem");
    return;
  }

  const invoice = {
    id: uid(),
    date,
    dueDate: date,
    number,
    method,
    client: {
      name:   clientName,
      phone:  phoneRaw,
      email:  "",
      address:""
    },
    items,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total:    totals.total,
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

  state.invoices.push(invoice);
  state.incomesDaily.push(income);
  saveState();

  toast("Factura guardada");
  // PDF en segundo plano
  generateInvoicePDFMobile(invoice).catch(e => console.error("PDF móvil:", e));

  // Limpiar formulario
  $("#formInvoice")?.reset();
  $("#invItemsContainer").innerHTML = "";
  updateInvoiceTotals();
  $("#invDateMobile").value = todayStr();

  // WhatsApp (si se pidió y hay número)
  if (openWhatsApp && phoneRaw) {
    const phone = phoneRaw.replace(/\D/g, "");
    const msgLines = [
      `Factura #${number}`,
      `Cliente: ${clientName || "Sin nombre"}`,
      `Fecha: ${date}`,
      `Total: ${formatMoney(totals.total)}`,
      "",
      "Detalle:",
      ...items.map(it => `- ${it.desc || "Ítem"} (${it.qty} x ${formatMoney(it.price)})`),
      "",
      "Gracias por su confianza."
    ];
    const text = encodeURIComponent(msgLines.join("\n"));
    const url  = `https://wa.me/${phone}?text=${text}`;
    window.open(url, "_blank");
  }

  showScreen("home");
}

/* ==================== Firebase / Cloud ==================== */
function cloudDocRef() {
  if (!currentUser) return null;
  return doc(db, "users", currentUser.uid, "state", "app");
}

async function cloudPullMobile() {
  const ref = cloudDocRef();
  if (!ref) { toast("Primero conecta con Google"); return; }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("No hay datos en la nube todavía");
    return;
  }
  const remote = snap.data();
  state = remote;
  if (!state._cloud) state._cloud = { updatedAt: 0 };
  saveState({ skipCloud: true });
  renderHome();
  toast("Datos cargados desde la nube");
}

async function cloudPushMobile() {
  const ref = cloudDocRef();
  if (!ref) { toast("Primero conecta con Google"); return; }
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = Date.now();
  await setDoc(
    ref,
    { ...state, _serverUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  saveState({ skipCloud: true });
  toast("Datos enviados a la nube");
}

function cloudPushDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPushMobile, 700);
}

/* ==================== UI de Sync (botones móviles) ==================== */
function updateSyncUI() {
  const statusEl = $("#syncStatusMobile");
  const btnIn    = $("#btnSignInMobile");
  const btnOut   = $("#btnSignOutMobile");
  const chk      = $("#chkAutosyncMobile");

  if (chk) chk.checked = !!autosync;

  if (!currentUser) {
    if (statusEl) statusEl.textContent = "Sin conexión";
    if (btnIn)  btnIn.style.display  = "block";
    if (btnOut) btnOut.style.display = "none";
  } else {
    if (statusEl) statusEl.textContent =
      `Conectado como ${(currentUser.displayName || currentUser.email || currentUser.uid)}`;
    if (btnIn)  btnIn.style.display  = "none";
    if (btnOut) btnOut.style.display = "block";
  }
}

function initCloudUI() {
  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      await signInWithRedirect(auth, provider);
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    await signOut(auth);
    toast("Sesión cerrada");
  });

  $("#btnSyncPullMobile")?.addEventListener("click", () => {
    cloudPullMobile().catch(err => {
      console.error(err);
      toast("Error al traer datos");
    });
  });

  $("#btnSyncPushMobile")?.addEventListener("click", () => {
    cloudPushMobile().catch(err => {
      console.error(err);
      toast("Error al enviar datos");
    });
  });

  $("#chkAutosyncMobile")?.addEventListener("change", (e) => {
    autosync = !!e.target.checked;
    localStorage.setItem(AUTOSYNC_KEY, JSON.stringify(autosync));
  });

  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    updateSyncUI();
  });
}

/* ==================== Arranque ==================== */
document.addEventListener("DOMContentLoaded", () => {
  initQuickForms();
  initCloudUI();
  renderHome();
});
