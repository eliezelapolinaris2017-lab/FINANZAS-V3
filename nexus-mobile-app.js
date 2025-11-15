// =========================================================
// Nexus Finance Móvil - nexus-mobile-app.js
// Versión: 1.0 mobile-only, sincronizada con Nexus Desktop
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ===================== CONFIG FIREBASE (MISMO QUE DESKTOP) =====================
const firebaseConfig = {
  apiKey: "AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE",
  authDomain: "finanzas-web-f4e05.firebaseapp.com",
  projectId: "finanzas-web-f4e05",
  storageBucket: "finanzas-web-f4e05.firebasestorage.app",
  messagingSenderId: "1047152523619",
  appId: "1:1047152523619:web:7d8f7d1f7a5ccc6090bb56"
};

const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
const db      = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

// ===================== STATE LOCAL COMPATIBLE CON DESKTOP =====================
const STORAGE_KEY = "finanzas-state-v10";
const AUTOSYNC_KEY_MOBILE = "nexusMobileAutosync";

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

let state = loadState();

// ===================== UTILS BÁSICOS =====================
const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const st = JSON.parse(raw);
    // Asegurar todas las claves
    for (const k of Object.keys(DEFAULT_STATE)) {
      if (!(k in st)) st[k] = structuredClone(DEFAULT_STATE[k]);
    }
    return st;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(skipCloud = false) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!skipCloud && cloud.autosync && cloud.user) {
    cloudPushDebounced();
  }
  refreshTodaySummary();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

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
  const t = qs("#toast");
  if (!t) {
    console.log("[Toast]", msg);
    return;
  }
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2200);
}

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

// ===================== NAVEGACIÓN ENTRE PANTALLAS =====================
function showScreen(name) {
  qsa(".screen").forEach((sc) => {
    sc.classList.toggle("active", sc.id === "screen-" + name);
  });
}

function wireNavigation() {
  qs("#btnGoIncome")?.addEventListener("click", () => {
    if (qs("#incDateMobile")) qs("#incDateMobile").value = todayStr();
    showScreen("income");
  });
  qs("#btnGoExpense")?.addEventListener("click", () => {
    if (qs("#expDateMobile")) qs("#expDateMobile").value = todayStr();
    showScreen("expense");
  });
  qs("#btnGoInvoice")?.addEventListener("click", () => {
    if (qs("#invDateMobile")) qs("#invDateMobile").value = todayStr();
    if (!qs("#invNumberMobile").value) {
      qs("#invNumberMobile").value = generateNextInvoiceNumber();
    }
    showScreen("invoice");
  });

  qsa(".btn-back[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.back || "home";
      showScreen(target);
    });
  });
}

// ===================== KPI HOY (INGRESOS / GASTOS / BALANCE) =====================
// Usamos LA MISMA LÓGICA que Desktop: ingresosDaily + gastosDaily + personal + payments
function refreshTodaySummary() {
  const kInc = qs("#kpi-income-today");
  const kExp = qs("#kpi-expenses-today");
  const kBal = qs("#kpi-balance-today");
  if (!kInc || !kExp || !kBal) return;

  const today = todayStr();

  // INGRESOS HOY (incomesDaily)
  let incToday = 0;
  if (Array.isArray(state.incomesDaily)) {
    for (const r of state.incomesDaily) {
      if (r.date === today) incToday += Number(r.amount || 0);
    }
  }

  // GASTOS HOY (expensesDaily + personal + payments)
  let expToday = 0;

  if (Array.isArray(state.expensesDaily)) {
    for (const e of state.expensesDaily) {
      if (e.date === today) expToday += Number(e.amount || 0);
    }
  }

  if (Array.isArray(state.personal)) {
    for (const p of state.personal) {
      if (p.date === today) expToday += Number(p.amount || 0);
    }
  }

  if (Array.isArray(state.payments)) {
    for (const p of state.payments) {
      if (p.date === today) expToday += Number(p.amount || 0);
    }
  }

  const balanceToday = incToday - expToday;

  kInc.textContent = fmt(incToday);
  kExp.textContent = fmt(expToday);
  kBal.textContent = fmt(balanceToday);

  refreshInvoicesToday();
}

// ===================== FACTURAS DE HOY (LISTADO) =====================
function refreshInvoicesToday() {
  const wrap = qs("#todayInvoices");
  if (!wrap) return;

  const today = todayStr();

  if (!Array.isArray(state.invoices) || state.invoices.length === 0) {
    wrap.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  const list = state.invoices.filter((inv) => inv.date === today);

  if (list.length === 0) {
    wrap.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  wrap.innerHTML = list
    .map(
      (inv) => `
      <div class="invoice-row">
        <div class="invoice-main">
          <strong>${inv.number || "—"}</strong>
          <span>${inv.client?.name || inv.client || "Cliente"}</span>
        </div>
        <div class="invoice-amount">
          <span class="money">${fmt(inv.total || 0)}</span>
        </div>
      </div>
    `
    )
    .join("");
}

// ===================== INGRESO RÁPIDO =====================
function wireIncomeQuick() {
  const form = qs("#formIncome");
  if (!form) return;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();

    const date = qs("#incDateMobile")?.value || todayStr();
    const client = qs("#incClientMobile")?.value || "";
    const method = qs("#incMethodMobile")?.value || "Efectivo";
    const amount = parseFloat(qs("#incAmountMobile")?.value || "0") || 0;

    if (!date) {
      toast("Selecciona una fecha");
      return;
    }
    if (!amount) {
      toast("Monto requerido");
      return;
    }

    const rec = {
      id: uid(),
      date,
      client,
      method,
      amount
    };

    if (!Array.isArray(state.incomesDaily)) state.incomesDaily = [];
    state.incomesDaily.push(rec);
    toast("Ingreso guardado");
    form.reset();
    qs("#incDateMobile").value = todayStr();
    saveState();
  });
}

// ===================== GASTO RÁPIDO =====================
function wireExpenseQuick() {
  const form = qs("#formExpense");
  if (!form) return;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();

    const date = qs("#expDateMobile")?.value || todayStr();
    const category = qs("#expCategoryMobile")?.value || "Otros";
    const method = qs("#expMethodMobile")?.value || "Efectivo";
    const amount = parseFloat(qs("#expAmountMobile")?.value || "0") || 0;

    if (!date) {
      toast("Selecciona una fecha");
      return;
    }
    if (!amount) {
      toast("Monto requerido");
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

    if (!Array.isArray(state.expensesDaily)) state.expensesDaily = [];
    state.expensesDaily.push(rec);
    toast("Gasto guardado");
    form.reset();
    qs("#expDateMobile").value = todayStr();
    saveState();
  });
}

// ===================== FACTURA MÓVIL (NUNCA SE SALE DE LA PANTALLA) =====================
function addInvoiceItemRow() {
  const container = qs("#invItemsContainer");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "item-row";

  row.innerHTML = `
    <input type="text" class="item-desc" placeholder="Descripción del servicio"/>
    <div class="item-row-inline">
      <input type="number" step="0.01" class="item-qty"   placeholder="Cant." value="1">
      <input type="number" step="0.01" class="item-price" placeholder="Precio" value="0.00">
      <input type="number" step="0.01" class="item-tax"   placeholder="% Imp" value="0">
      <button type="button" class="btn-remove-item">✕</button>
    </div>
  `;

  container.appendChild(row);

  // Botón eliminar ítem
  row.querySelector(".btn-remove-item").addEventListener("click", () => {
    row.remove();
    computeInvoiceTotalsMobile();
  });

  // Recalcular cuando cambien números
  row.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", () => computeInvoiceTotalsMobile());
  });
}

function readInvoiceItems() {
  const container = qs("#invItemsContainer");
  if (!container) return [];

  const items = [];
  container.querySelectorAll(".item-row").forEach((row) => {
    const desc = row.querySelector(".item-desc")?.value || "";
    const qty = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
    const price =
      parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
    const tax = parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;

    if (!desc && qty === 0 && price === 0) return;

    items.push({ id: uid(), desc, qty, price, tax });
  });
  return items;
}

function computeInvoiceTotalsMobile() {
  const items = readInvoiceItems();
  let subtotal = 0;
  let taxTotal = 0;

  items.forEach((it) => {
    const base = (it.qty || 0) * (it.price || 0);
    const taxAmt = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += taxAmt;
  });

  const total = subtotal + taxTotal;

  const subEl = qs("#invSubtotalMobile");
  const taxEl = qs("#invTaxMobile");
  const totEl = qs("#invTotalMobile");

  if (subEl) subEl.textContent = fmt(subtotal);
  if (taxEl) taxEl.textContent = fmt(taxTotal);
  if (totEl) totEl.textContent = fmt(total);

  return { subtotal, taxTotal, total };
}

function generateNextInvoiceNumber() {
  // Muy simple: busca el mayor y suma 1
  if (!Array.isArray(state.invoices) || state.invoices.length === 0) {
    return "000001";
  }
  const nums = state.invoices
    .map((inv) => parseInt(String(inv.number || "0").replace(/\D/g, ""), 10))
    .filter((n) => !isNaN(n));
  if (nums.length === 0) return "000001";
  const next = Math.max(...nums) + 1;
  return String(next).padStart(6, "0");
}

function buildInvoiceFromForm() {
  const date = qs("#invDateMobile")?.value || todayStr();
  const number = qs("#invNumberMobile")?.value || generateNextInvoiceNumber();
  const client = qs("#invClientMobile")?.value || "";
  const phone = qs("#invPhoneMobile")?.value || "";
  const method = qs("#invMethodMobile")?.value || "Efectivo";
  const note = qs("#invNoteMobile")?.value || "";

  if (!date) {
    toast("Fecha requerida");
    return null;
  }
  if (!number) {
    toast("# de factura requerido");
    return null;
  }

  const items = readInvoiceItems();
  if (items.length === 0) {
    toast("Añade al menos un ítem");
    return null;
  }

  const totals = computeInvoiceTotalsMobile();

  const invoice = {
    id: uid(),
    date,
    dueDate: date, // en móvil lo dejamos igual
    number,
    method,
    client: {
      name: client,
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

  return invoice;
}

function saveInvoiceMobile(openWhatsApp = false) {
  const inv = buildInvoiceFromForm();
  if (!inv) return;

  if (!Array.isArray(state.invoices)) state.invoices = [];
  state.invoices.push(inv);

  // Crear ingreso directo igual que Desktop
  const income = {
    id: uid(),
    date: inv.date,
    client: inv.client.name,
    method: inv.method,
    amount: inv.total,
    invoiceNumber: inv.number
  };
  if (!Array.isArray(state.incomesDaily)) state.incomesDaily = [];
  state.incomesDaily.push(income);
  inv.incomeId = income.id;

  saveState();
  toast("Factura guardada");

  if (openWhatsApp && inv.client.phone) {
    openWhatsAppWithInvoice(inv);
  }

  // Reset form pero sin perder #factura sugerido
  const form = qs("#formInvoice");
  if (form) {
    const nextNumber = generateNextInvoiceNumber();
    form.reset();
    qs("#invDateMobile").value = todayStr();
    qs("#invNumberMobile").value = nextNumber;
    qs("#invMethodMobile").value = "Efectivo";
    qs("#invItemsContainer").innerHTML = "";
    addInvoiceItemRow();
    computeInvoiceTotalsMobile();
  }
}

function openWhatsAppWithInvoice(inv) {
  // Formato simple de mensaje
  const phone = String(inv.client.phone || "").replace(/[^\d]/g, "");
  if (!phone) {
    toast("No hay teléfono para WhatsApp");
    return;
  }

  const business = state.settings?.businessName || "Mi Negocio";

  const lines = [
    `Hola ${inv.client.name || ""},`,
    ``,
    `Te enviamos el resumen de tu factura #${inv.number}:`,
    `Fecha: ${inv.date}`,
    `Total: ${fmt(inv.total)}`,
    ``,
    `Negocio: ${business}`,
    `Gracias por tu confianza.`
  ];

  const msg = encodeURIComponent(lines.join("\n"));
  const url = `https://wa.me/${phone}?text=${msg}`;
  window.open(url, "_blank");
}

function wireInvoiceMobile() {
  const btnAddItem = qs("#btnAddItem");
  const btnCalc = qs("#btnCalcInvoice");
  const btnSave = qs("#btnSaveInvoice");
  const btnSaveWa = qs("#btnSaveInvoiceWhatsApp");

  if (btnAddItem) btnAddItem.addEventListener("click", addInvoiceItemRow);
  if (btnCalc) btnCalc.addEventListener("click", computeInvoiceTotalsMobile);
  if (btnSave)
    btnSave.addEventListener("click", (e) => {
      e.preventDefault();
      saveInvoiceMobile(false);
    });
  if (btnSaveWa)
    btnSaveWa.addEventListener("click", (e) => {
      e.preventDefault();
      saveInvoiceMobile(true);
    });

  // Al cargar pantalla, un ítem mínimo
  if (qs("#invItemsContainer") && !qs("#invItemsContainer").children.length) {
    addInvoiceItemRow();
  }
}

// ===================== CLOUD / FIREBASE (MISMO DOC QUE DESKTOP) =====================
const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem(AUTOSYNC_KEY_MOBILE) || "false"),
  unsub: null,
  pushTimer: null
};

function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}

function updateSyncUI() {
  const status = qs("#syncStatusMobile");
  const btnIn = qs("#btnSignInMobile");
  const btnOut = qs("#btnSignOutMobile");
  const chkAuto = qs("#chkAutosyncMobile");

  if (status) {
    status.textContent = cloud.user
      ? `Conectado como ${cloud.user.displayName || cloud.user.email || cloud.user.uid}`
      : "Sin conexión";
  }
  if (btnIn) btnIn.style.display = cloud.user ? "none" : "block";
  if (btnOut) btnOut.style.display = cloud.user ? "block" : "none";
  if (chkAuto) chkAuto.checked = !!cloud.autosync;
}

function setAutosyncMobile(v) {
  cloud.autosync = !!v;
  localStorage.setItem(AUTOSYNC_KEY_MOBILE, JSON.stringify(cloud.autosync));
  updateSyncUI();
}

async function cloudPullMobile(replace = true) {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Inicia sesión con Google primero");
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("No hay datos en la nube aún");
    return;
  }
  const remote = snap.data();
  const rU = remote?._cloud?.updatedAt || 0;
  const lU = state?._cloud?.updatedAt || 0;

  if (replace || rU >= lU) {
    state = remote;
  } else {
    // Merge simple
    state.settings = Object.assign({}, state.settings, remote.settings || {});
    const keys = [
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
    keys.forEach((k) => {
      if (Array.isArray(remote[k])) {
        state[k] = state[k].concat(remote[k]);
      }
    });
    state._cloud = { updatedAt: Math.max(lU, rU) };
  }

  saveState(true);
  refreshTodaySummary();
  toast("Datos cargados desde la nube");
}

async function cloudPushMobile() {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Inicia sesión con Google primero");
    return;
  }
  const now = Date.now();
  state._cloud = { updatedAt: now };

  await setDoc(
    ref,
    {
      ...state,
      _cloud: state._cloud,
      _serverUpdatedAt: serverTimestamp()
    },
    { merge: true }
  );
  saveState(true);
  toast("Datos enviados a la nube");
}

function cloudPushDebounced() {
  clearTimeout(cloud.pushTimer);
  cloud.pushTimer = setTimeout(cloudPushMobile, 600);
}

function cloudSubscribeMobile() {
  if (!cloud.user) return;
  const ref = cloudDocRef();
  cloud.unsub?.();
  cloud.unsub = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const remote = snap.data();
    const rU = remote?._cloud?.updatedAt || 0;
    const lU = state?._cloud?.updatedAt || 0;
    if (rU > lU) {
      state = remote;
      saveState(true);
      refreshTodaySummary();
      toast("Actualizado desde la nube");
    }
  });
}

function wireCloudButtonsMobile() {
  const btnIn = qs("#btnSignInMobile");
  const btnOut = qs("#btnSignOutMobile");
  const btnPull = qs("#btnSyncPullMobile");
  const btnPush = qs("#btnSyncPushMobile");
  const chkAuto = qs("#chkAutosyncMobile");

  if (btnIn) {
    btnIn.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        console.error(e);
        toast("Error al iniciar sesión");
      }
    });
  }

  if (btnOut) {
    btnOut.addEventListener("click", async () => {
      try {
        await signOut(auth);
        toast("Sesión cerrada");
      } catch (e) {
        console.error(e);
        toast("Error al cerrar sesión");
      }
    });
  }

  if (btnPull) btnPull.addEventListener("click", () => cloudPullMobile(true));
  if (btnPush) btnPush.addEventListener("click", () => cloudPushMobile());

  if (chkAuto) {
    chkAuto.addEventListener("change", (ev) => {
      setAutosyncMobile(ev.target.checked);
    });
  }
}

// ===================== INIT =====================
function init() {
  wireNavigation();
  wireIncomeQuick();
  wireExpenseQuick();
  wireInvoiceMobile();
  wireCloudButtonsMobile();
  refreshTodaySummary();

  // Firebase Auth Listener
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, (user) => {
    cloud.user = user || null;
    updateSyncUI();
    if (user) {
      cloudSubscribeMobile();
    } else {
      cloud.unsub?.();
      cloud.unsub = null;
    }
  });

  updateSyncUI();
}

// Esperar a que el DOM esté listo
document.addEventListener("DOMContentLoaded", init);

// Exponer para depuración (opcional)
window.nexusMobile = {
  get state() { return state; },
  refreshTodaySummary,
  cloudPullMobile,
  cloudPushMobile
};
