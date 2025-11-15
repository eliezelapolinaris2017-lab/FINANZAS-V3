/* =========================================================
   Nexus Finance — Mini App Móvil
   - MISMO estado que Nexus completo (local + Firestore)
   - Ingreso rápido, Gasto rápido, Facturas simples
   - WhatsApp si hay teléfono
   - Sincronización REAL 2-vías con Desktop
   ========================================================= */

/* ===================== Firebase ===================== */
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
  serverTimestamp,
  enableIndexedDbPersistence,
  onSnapshot
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

/* ===================== Estado local (mismo que Nexus) ===================== */

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

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clone = o => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowMs = () => Date.now();

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

function saveState({ skipCloud = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  refreshTodaySummary();
  renderTodayInvoices();
  if (!skipCloud && cloud.autosync && cloud.user) {
    cloudPushDebounced();
  }
}

/* ===================== Utils ===================== */

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

const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

const toDate = s => new Date(s || "1970-01-01");
function inRange(d, from, to) {
  const t = +toDate(d);
  if (from && t < +toDate(from)) return false;
  if (to && t > +toDate(to) + 86400000 - 1) return false;
  return true;
}

/* ===================== Cloud / Firestore ===================== */

const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem("autosync") || "false"),
  unsub: null,
  pollTimer: null
};

function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}

/** 🔵 Versión simplificada para móvil:
 *  Siempre tomamos el REMOTO como verdad (no merge complejo).
 */
async function cloudPull(showToast = true) {
  const ref = cloudDocRef();
  if (!ref) {
    if (showToast) toast("Conéctate con Google primero");
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    if (showToast) toast("No hay datos en la nube");
    return;
  }

  const remote = snap.data() || {};
  // Aseguramos que tenga el shape mínimo
  state = Object.assign({}, DEFAULT_STATE, remote);
  saveState({ skipCloud: true });
  if (showToast) toast("Datos cargados desde la nube");
}

async function cloudPush() {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Conéctate con Google primero");
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

/** 🔁 Suscripción + POLLING para asegurar lectura desde Desktop */
function cloudSubscribeAndPoll() {
  const ref = cloudDocRef();
  if (!ref) return;

  // Listener en tiempo real
  if (cloud.unsub) {
    cloud.unsub();
    cloud.unsub = null;
  }
  cloud.unsub = onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    const remote = snap.data() || {};
    state = Object.assign({}, DEFAULT_STATE, remote);
    saveState({ skipCloud: true });
    // No toast aquí para que no moleste cada vez
  });

  // Polling cada 20s por si acaso
  if (cloud.pollTimer) {
    clearInterval(cloud.pollTimer);
    cloud.pollTimer = null;
  }
  cloud.pollTimer = setInterval(() => {
    cloudPull(false).catch(() => {});
  }, 20000);
}

function stopCloudPoll() {
  if (cloud.unsub) {
    cloud.unsub();
    cloud.unsub = null;
  }
  if (cloud.pollTimer) {
    clearInterval(cloud.pollTimer);
    cloud.pollTimer = null;
  }
}

/* ===================== UI de sincronización (IDs móviles) ===================== */

function updateSyncUI() {
  const lbl     = $("#syncStatusMobile");
  const btnIn   = $("#btnSignInMobile");
  const btnOut  = $("#btnSignOutMobile");
  const chkAuto = $("#chkAutosyncMobile");

  if (lbl) {
    lbl.textContent = cloud.user
      ? `Conectado como ${cloud.user.displayName || cloud.user.email || cloud.user.uid}`
      : "Sin conexión";
  }
  if (btnIn)  btnIn.style.display  = cloud.user ? "none" : "inline-block";
  if (btnOut) btnOut.style.display = cloud.user ? "inline-block" : "none";
  if (chkAuto) chkAuto.checked = !!cloud.autosync;
}

function setAutosync(v) {
  cloud.autosync = !!v;
  localStorage.setItem("autosync", JSON.stringify(cloud.autosync));
  updateSyncUI();
}

function wireCloudUI() {
  const provider = new GoogleAuthProvider();

  const btnIn   = $("#btnSignInMobile");
  const btnOut  = $("#btnSignOutMobile");
  const btnPull = $("#btnSyncPullMobile");
  const btnPush = $("#btnSyncPushMobile");
  const chkAuto = $("#chkAutosyncMobile");

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
      try {
        await signOut(auth);
      } catch (e) {
        console.error(e);
      }
    });
  }
  if (btnPull) btnPull.addEventListener("click", () => cloudPull(true));
  if (btnPush) btnPush.addEventListener("click", () => cloudPush());
  if (chkAuto) chkAuto.addEventListener("change", e => setAutosync(e.target.checked));

  updateSyncUI();
  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, async user => {
    cloud.user = user || null;
    updateSyncUI();

    if (user) {
      // Cuando se conecta: primero jalar, luego suscribir/pollear
      await cloudPull(false).catch(() => {});
      cloudSubscribeAndPoll();
    } else {
      stopCloudPoll();
    }
  });
}

/* ===================== Resumen HOY + facturas de hoy ===================== */

function sumRange(list, from, to) {
  if (!Array.isArray(list)) return 0;
  return list
    .filter(r => inRange(r.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumPersonalRange(from, to) {
  if (!Array.isArray(state.personal)) return 0;
  return state.personal
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumPaymentsRange(from, to) {
  if (!Array.isArray(state.payments)) return 0;
  return state.payments
    .filter(p => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function refreshTodaySummary() {
  const today = todayStr();
  const incToday = sumRange(state.incomesDaily, today, today);
  const expToday =
    sumRange(state.expensesDaily, today, today) +
    sumPersonalRange(today, today) +
    sumPaymentsRange(today, today);
  const balToday = incToday - expToday;

  const elInc = $("#kpi-income-today");
  const elExp = $("#kpi-expenses-today");
  const elBal = $("#kpi-balance-today");

  if (elInc) elInc.textContent = fmt(incToday);
  if (elExp) elExp.textContent = fmt(expToday);
  if (elBal) elBal.textContent = fmt(balToday);
}

function renderTodayInvoices() {
  const box = $("#todayInvoices");
  if (!box) return;
  const today = todayStr();
  const list = (state.invoices || []).filter(f => f.date === today);

  if (!list.length) {
    box.className = "list-empty";
    box.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  box.className = "list-nonempty";
  box.innerHTML = "";
  list
    .slice()
    .sort((a, b) => (a.number || "").localeCompare(b.number || ""))
    .forEach(inv => {
      const div = document.createElement("div");
      div.className = "today-invoice-row";
      div.innerHTML = `
        <div class="ti-main">
          <span class="ti-number">#${inv.number || ""}</span>
          <span class="ti-client">${inv.client?.name || ""}</span>
        </div>
        <div class="ti-meta">
          <span class="ti-total">${fmt(inv.total || 0)}</span>
          <span class="ti-method">${inv.method || ""}</span>
        </div>
      `;
      box.appendChild(div);
    });
}

/* ===================== Navegación entre pantallas ===================== */

function showScreen(name) {
  const id = name.startsWith("screen-") ? name : `screen-${name}`;
  $$(".screen").forEach(s => {
    s.classList.toggle("active", s.id === id);
  });
}

function wireNav() {
  const btnInc = $("#btnGoIncome");
  const btnExp = $("#btnGoExpense");
  const btnInv = $("#btnGoInvoice");

  if (btnInc) btnInc.addEventListener("click", () => showScreen("income"));
  if (btnExp) btnExp.addEventListener("click", () => showScreen("expense"));
  if (btnInv) btnInv.addEventListener("click", () => showScreen("invoice"));

  $$(".btn-back[data-back]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dest = btn.dataset.back || "home";
      showScreen(dest);
    });
  });

  showScreen("home");
}

/* ===================== Formularios ===================== */
/** INgreso rápido */
function wireIncomeForm() {
  const form = $("#formIncome");
  if (!form) return;

  const dateEl   = $("#incDateMobile");
  const clientEl = $("#incClientMobile");
  const methodEl = $("#incMethodMobile");
  const amountEl = $("#incAmountMobile");

  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: dateEl?.value || todayStr(),
      client: clientEl?.value || "Cliente",
      method: methodEl?.value || "Efectivo",
      amount: Number(amountEl?.value || 0)
    };
    if (!rec.date)   return toast("Fecha requerida");
    if (!rec.amount) return toast("Monto requerido");

    state.incomesDaily.push(rec);
    saveState();
    toast("Ingreso guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
    showScreen("home");
  });
}

/** Gasto rápido */
function wireExpenseForm() {
  const form = $("#formExpense");
  if (!form) return;

  const dateEl = $("#expDateMobile");
  const catEl  = $("#expCategoryMobile");
  const methEl = $("#expMethodMobile");
  const amtEl  = $("#expAmountMobile");

  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: dateEl?.value || todayStr(),
      category: catEl?.value || "Otros",
      desc: (catEl?.value || "Gasto"),
      method: methEl?.value || "Efectivo",
      amount: Number(amtEl?.value || 0),
      note: ""
    };
    if (!rec.date)   return toast("Fecha requerida");
    if (!rec.amount) return toast("Monto requerido");

    state.expensesDaily.push(rec);
    saveState();
    toast("Gasto guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
    showScreen("home");
  });
}

/* ===== Helpers factura ===== */

function buildItemRow() {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text"  class="item-desc"  placeholder="Descripción">
    <input type="number" class="item-qty"   step="0.01" value="1"   placeholder="Cant.">
    <input type="number" class="item-price" step="0.01" value="0"   placeholder="Precio">
    <input type="number" class="item-tax"   step="0.01" value="0"   placeholder="Imp %">
    <button type="button" class="btn-remove-item">✕</button>
  `;
  row.querySelector(".btn-remove-item").addEventListener("click", () => {
    row.remove();
  });
  return row;
}

function readItems() {
  const container = $("#invItemsContainer");
  if (!container) return [];
  const items = [];
  container.querySelectorAll(".item-row").forEach(row => {
    const desc  = row.querySelector(".item-desc")?.value || "";
    const qty   = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
    const price = parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
    const tax   = parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;
    if (!desc && !qty && !price && !tax) return;
    items.push({ id: uid(), desc, qty, price, tax });
  });
  return items;
}

function calcTotals(items) {
  let subtotal = 0;
  let taxTotal = 0;
  items.forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tax;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function updateInvoiceTotalsDisplay(items) {
  const t = calcTotals(items);
  const subEl = $("#invSubtotalMobile");
  const taxEl = $("#invTaxMobile");
  const totEl = $("#invTotalMobile");

  if (subEl) subEl.textContent = fmt(t.subtotal);
  if (taxEl) taxEl.textContent = fmt(t.taxTotal);
  if (totEl) totEl.textContent = fmt(t.total);
}

/** Guardar factura (con opción WhatsApp) */
function saveInvoice({ openWhatsApp } = { openWhatsApp: false }) {
  const dateEl    = $("#invDateMobile");
  const numEl     = $("#invNumberMobile");
  const clientEl  = $("#invClientMobile");
  const phoneEl   = $("#invPhoneMobile");
  const methodEl  = $("#invMethodMobile");
  const noteEl    = $("#invNoteMobile");

  const date    = dateEl?.value || todayStr();
  const number  = (numEl?.value || "").trim();
  const client  = (clientEl?.value || "").trim() || "Cliente";
  const phone   = (phoneEl?.value || "").replace(/\D/g, "");
  const method  = methodEl?.value || "Efectivo";
  const note    = (noteEl?.value || "").trim();

  const items = readItems();
  if (!items.length) {
    toast("Añade al menos un ítem");
    return;
  }
  const { subtotal, taxTotal, total } = calcTotals(items);

  if (!date || !number) {
    toast("Fecha y # de factura son requeridos");
    return;
  }
  if (!total) {
    toast("Total debe ser mayor que 0");
    return;
  }

  const inv = {
    id: uid(),
    date,
    dueDate: date,
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

  // Guardar factura
  state.invoices.push(inv);

  // Registrar ingreso vinculado
  const income = {
    id: uid(),
    date,
    client,
    method,
    amount: total,
    invoiceNumber: number
  };
  state.incomesDaily.push(income);

  saveState();
  toast("Factura creada");

  // WhatsApp si se pidió
  if (openWhatsApp && phone && phone.length >= 8) {
    const negocio = state.settings.businessName || "Mi Negocio";
    const msg =
      `Saludos ${client},\n` +
      `Adjunto el detalle de su factura #${number} por un total de ${fmt(total)}.\n\n` +
      `Negocio: ${negocio}\n` +
      `Método de pago: ${method}`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  const form = $("#formInvoice");
  if (form) form.reset();
  const container = $("#invItemsContainer");
  if (container) container.innerHTML = "";
  updateInvoiceTotalsDisplay([]);

  if (dateEl) dateEl.value = todayStr();
  showScreen("home");
}

/** Factura: wiring */
function wireInvoiceForm() {
  const form       = $("#formInvoice");
  const dateEl     = $("#invDateMobile");
  const btnAddItem = $("#btnAddItem");
  const btnCalc    = $("#btnCalcInvoice");
  const btnSave    = $("#btnSaveInvoice");
  const btnSaveWA  = $("#btnSaveInvoiceWhatsApp");

  if (!form) return;

  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  const container = $("#invItemsContainer");
  if (container && !container.querySelector(".item-row")) {
    container.appendChild(buildItemRow());
  }

  if (btnAddItem) {
    btnAddItem.addEventListener("click", () => {
      if (!container) return;
      container.appendChild(buildItemRow());
    });
  }

  if (btnCalc) {
    btnCalc.addEventListener("click", () => {
      updateInvoiceTotalsDisplay(readItems());
    });
  }

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    saveInvoice({ openWhatsApp: false });
  });

  if (btnSave) {
    btnSave.addEventListener("click", ev => {
      ev.preventDefault();
      saveInvoice({ openWhatsApp: false });
    });
  }
  if (btnSaveWA) {
    btnSaveWA.addEventListener("click", ev => {
      ev.preventDefault();
      saveInvoice({ openWhatsApp: true });
    });
  }
}

/* ===================== Arranque ===================== */

document.addEventListener("DOMContentLoaded", () => {
  wireNav();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  wireCloudUI();
  refreshTodaySummary();
  renderTodayInvoices();
});

/* Debug consola opcional */
window.nexusMobile = {
  get state() { return state; },
  set state(v) { state = v; saveState(); },
  cloudPull,
  cloudPush,
  refreshTodaySummary,
  renderTodayInvoices
};
