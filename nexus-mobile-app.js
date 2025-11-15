/* =========================================================
   Nexus Finance — APP MÓVIL (app-mobile.js)
   - Firebase Auth + Firestore
   - Carga de estado desde la nube (mismo doc que Desktop)
   - KPIs: Ingresos Mes, Gastos Mes, Balance Mes, #Facturas, #Cotizaciones
   - Listado simple de facturas y cotizaciones
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
  getDoc
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

/* ===================== Utils ===================== */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmt = (n) => {
  const val = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-PR", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  } catch {
    return "$" + val.toFixed(2);
  }
};

function toast(msg) {
  const box = $("#toast");
  if (!box) {
    console.log("[MOBILE TOAST]", msg);
    return;
  }
  box.textContent = msg;
  box.classList.add("visible");
  setTimeout(() => box.classList.remove("visible"), 2500);
}

/* ===================== Estado en memoria (MÓVIL) ===================== */
let cloudState = {
  settings: {
    businessName: "Mi Negocio",
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

/* ===================== Helpers de Fechas ===================== */
function getMonthKey(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = (dateObj.getMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`; // Ej: 2025-11
}

function isInMonth(dateStr, monthKey) {
  if (!dateStr || typeof dateStr !== "string") return false;
  // fecha en formato YYYY-MM-DD
  return dateStr.startsWith(monthKey);
}

/* =========================================================
   CÁLCULOS EXACTAMENTE IGUALES A DESKTOP (MES ACTUAL)
   ========================================================= */

/* ---- Ingresos del mes ---- */
function getMonthIncomesTotal(cloud) {
  const mKey = getMonthKey();
  let total = 0;

  if (Array.isArray(cloud.incomesDaily)) {
    cloud.incomesDaily.forEach((inc) => {
      if (isInMonth(inc.date, mKey)) {
        total += Number(inc.amount || 0);
      }
    });
  } else if (cloud.incomesDaily && typeof cloud.incomesDaily === "object") {
    Object.values(cloud.incomesDaily).forEach((inc) => {
      if (isInMonth(inc.date, mKey)) {
        total += Number(inc.amount || 0);
      }
    });
  }

  return total;
}

/* ---- Gastos del mes (gastos diarios + nómina + personales) ---- */
function getMonthExpensesTotal(cloud) {
  const mKey = getMonthKey();
  let total = 0;

  // Gastos diarios
  if (Array.isArray(cloud.expensesDaily)) {
    cloud.expensesDaily.forEach((e) => {
      if (isInMonth(e.date, mKey)) {
        total += Number(e.amount || 0);
      }
    });
  } else if (cloud.expensesDaily && typeof cloud.expensesDaily === "object") {
    Object.values(cloud.expensesDaily).forEach((e) => {
      if (isInMonth(e.date, mKey)) {
        total += Number(e.amount || 0);
      }
    });
  }

  // Nómina (pagos)
  if (Array.isArray(cloud.payments)) {
    cloud.payments.forEach((p) => {
      if (isInMonth(p.date, mKey)) {
        total += Number(p.amount || 0);
      }
    });
  } else if (cloud.payments && typeof cloud.payments === "object") {
    Object.values(cloud.payments).forEach((p) => {
      if (isInMonth(p.date, mKey)) {
        total += Number(p.amount || 0);
      }
    });
  }

  // Gastos personales
  if (Array.isArray(cloud.personal)) {
    cloud.personal.forEach((p) => {
      if (isInMonth(p.date, mKey)) {
        total += Number(p.amount || 0);
      }
    });
  } else if (cloud.personal && typeof cloud.personal === "object") {
    Object.values(cloud.personal).forEach((p) => {
      if (isInMonth(p.date, mKey)) {
        total += Number(p.amount || 0);
      }
    });
  }

  return total;
}

/* ---- BALANCE DEL MES = ingresosMes - gastosMes ---- */
function getMonthBalance(cloud) {
  const inc = getMonthIncomesTotal(cloud);
  const exp = getMonthExpensesTotal(cloud);
  return inc - exp;
}

/* =========================================================
   RENDER DE KPIs (MÓVIL)
   ========================================================= */
function renderMobileKPIs(cloud) {
  // Nombre negocio
  if ($("#businessName")) {
    $("#businessName").textContent =
      cloud.settings?.businessName || "Mi Negocio";
  }

  // Ingresos del mes
  const incMonth = getMonthIncomesTotal(cloud);
  if ($("#kpi-income-month")) {
    $("#kpi-income-month").textContent = fmt(incMonth);
  }

  // Gastos del mes
  const expMonth = getMonthExpensesTotal(cloud);
  if ($("#kpi-expense-month")) {
    $("#kpi-expense-month").textContent = fmt(expMonth);
  }

  // Balance del mes (IGUAL QUE DESKTOP)
  const balMonth = incMonth - expMonth;
  if ($("#kpi-balance-month")) {
    $("#kpi-balance-month").textContent = fmt(balMonth);
  }

  // # de facturas del mes
  const mKey = getMonthKey();
  let invoicesCount = 0;
  if (Array.isArray(cloud.invoices)) {
    cloud.invoices.forEach((inv) => {
      if (isInMonth(inv.date, mKey)) invoicesCount++;
    });
  } else if (cloud.invoices && typeof cloud.invoices === "object") {
    Object.values(cloud.invoices).forEach((inv) => {
      if (isInMonth(inv.date, mKey)) invoicesCount++;
    });
  }
  if ($("#kpi-invoices-count")) {
    $("#kpi-invoices-count").textContent = String(invoicesCount);
  }

  // # de cotizaciones del mes
  let quotesCount = 0;
  if (Array.isArray(cloud.quotes)) {
    cloud.quotes.forEach((q) => {
      if (isInMonth(q.date, mKey)) quotesCount++;
    });
  } else if (cloud.quotes && typeof cloud.quotes === "object") {
    Object.values(cloud.quotes).forEach((q) => {
      if (isInMonth(q.date, mKey)) quotesCount++;
    });
  }
  if ($("#kpi-quotes-count")) {
    $("#kpi-quotes-count").textContent = String(quotesCount);
  }
}

/* =========================================================
   LISTADOS (Facturas / Cotizaciones) — Opcional
   ========================================================= */
function renderMobileInvoices(cloud) {
  const list = $("#mobile-invoices-list");
  if (!list) return;

  list.innerHTML = "";

  if (!Array.isArray(cloud.invoices) && typeof cloud.invoices === "object") {
    cloud.invoices = Object.values(cloud.invoices);
  }

  const sorted = (cloud.invoices || [])
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (sorted.length === 0) {
    list.innerHTML = `<li class="empty">No hay facturas registradas.</li>`;
    return;
  }

  sorted.slice(0, 30).forEach((inv) => {
    const li = document.createElement("li");
    li.className = "invoice-item";
    li.innerHTML = `
      <div class="row">
        <div>
          <div class="inv-number">#${inv.number || "—"}</div>
          <div class="inv-client">${inv.client?.name || "Sin cliente"}</div>
          <div class="inv-date">${inv.date || ""}</div>
        </div>
        <div class="inv-amount">${fmt(inv.total || 0)}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderMobileQuotes(cloud) {
  const list = $("#mobile-quotes-list");
  if (!list) return;

  list.innerHTML = "";

  if (!Array.isArray(cloud.quotes) && typeof cloud.quotes === "object") {
    cloud.quotes = Object.values(cloud.quotes);
  }

  const sorted = (cloud.quotes || [])
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (sorted.length === 0) {
    list.innerHTML = `<li class="empty">No hay cotizaciones registradas.</li>`;
    return;
  }

  sorted.slice(0, 30).forEach((q) => {
    const li = document.createElement("li");
    li.className = "quote-item";
    li.innerHTML = `
      <div class="row">
        <div>
          <div class="quo-number">#${q.number || "—"}</div>
          <div class="quo-client">${q.client?.name || "Sin cliente"}</div>
          <div class="quo-date">${q.date || ""}</div>
        </div>
        <div class="quo-amount">${fmt(q.total || 0)}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

/* =========================================================
   CARGA DE CLOUD STATE DESDE FIRESTORE
   ========================================================= */
async function loadCloudState(user) {
  const ref = doc(db, "users", user.uid, "state", "app");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    toast("No hay datos en la nube");
    return;
  }
  const data = snap.data() || {};
  cloudState = {
    settings: data.settings || cloudState.settings,
    expensesDaily: data.expensesDaily || [],
    incomesDaily: data.incomesDaily || [],
    payments: data.payments || [],
    ordinary: data.ordinary || [],
    budgets: data.budgets || [],
    personal: data.personal || [],
    invoices: data.invoices || [],
    quotes: data.quotes || [],
    reconciliations: data.reconciliations || [],
    _cloud: data._cloud || { updatedAt: 0 }
  };

  renderMobileKPIs(cloudState);
  renderMobileInvoices(cloudState);
  renderMobileQuotes(cloudState);
}

/* =========================================================
   AUTH / UI LOGIN MÓVIL
   ========================================================= */
function showLoggedOut() {
  if ($("#screen-login"))   $("#screen-login").classList.add("visible");
  if ($("#screen-main"))    $("#screen-main").classList.remove("visible");
  if ($("#userName"))       $("#userName").textContent = "";
}

function showLoggedIn(user) {
  if ($("#screen-login"))   $("#screen-login").classList.remove("visible");
  if ($("#screen-main"))    $("#screen-main").classList.add("visible");
  if ($("#userName"))       $("#userName").textContent = user.displayName || user.email || "Usuario";

  loadCloudState(user).catch((err) => {
    console.error("Error cargando datos:", err);
    toast("Error al cargar datos");
  });
}

function wireAuthUI() {
  const provider = new GoogleAuthProvider();

  const btnLogin = $("#btnLoginGoogle");
  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        console.warn("Popup error, intento redirect:", e);
        await signInWithRedirect(auth, provider);
      }
    });
  }

  const btnLogout = $("#btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await signOut(auth);
        toast("Sesión cerrada");
      } catch (e) {
        console.error("Error al cerrar sesión:", e);
        toast("Error al cerrar sesión");
      }
    });
  }

  getRedirectResult(auth).catch(() => { /* ignore */ });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      showLoggedIn(user);
    } else {
      showLoggedOut();
    }
  });
}

/* =========================================================
   ARRANQUE MÓVIL
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  wireAuthUI();

  // Por si quieres recargar KPIs manualmente
  const btnRefresh = $("#btnRefreshKPIs");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      const user = auth.currentUser;
      if (!user) {
        toast("Inicia sesión primero");
        return;
      }
      loadCloudState(user);
    });
  }
});
