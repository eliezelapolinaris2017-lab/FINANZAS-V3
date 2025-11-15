/* =========================================================
   Nexus Finance — APP MÓVIL (app-mobile.js)
   KPIs del mes iguales a Desktop (renderReports)
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
  const box = document.querySelector("#toast");
  if (!box) {
    console.log("[MOBILE TOAST]", msg);
    return;
  }
  box.textContent = msg;
  box.classList.add("visible");
  setTimeout(() => box.classList.remove("visible"), 2500);
}

/* ===================== Estado en memoria ===================== */
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

/* ===================== Helpers de fechas (igual Desktop) ===================== */
const toDate = (s) => new Date(s);
function inRange(dateStr, from, to) {
  const t = +toDate(dateStr || "1970-01-01");
  if (from && t < +toDate(from)) return false;
  if (to   && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
}

/* ======= helpers de sumas (copiados de Desktop) ======= */
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

  (cloudState.expensesDaily || [])
    .filter((e) => inRange(e.date, from, to))
    .forEach((e) => {
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
  return (cloudState.payments || [])
    .filter((p) => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function sumPersonalRange(from, to) {
  return (cloudState.personal || [])
    .filter((p) => inRange(p.date, from, to))
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

/* =========================================================
   KPIs DEL MES (IGUAL QUE DESKTOP renderReports)
   ========================================================= */
function computeMonthKPIs() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  // === Ingresos del mes (igual Desktop: sumRange sobre incomesDaily) ===
  const incMonth = sumRange(cloudState.incomesDaily || [], monthStart, today);

  // === Gastos del mes ===
  const expMonthSplit = sumExpensesDailySplit(monthStart, today); // gastosDaily
  const perMonth = sumPersonalRange(monthStart, today);           // personales
  const payMonth = sumPaymentsRange(monthStart, today);           // nómina

  const expMonth = expMonthSplit.total + perMonth + payMonth;

  // === Balance del mes = ingresosMes - gastosMes ===
  const balanceMonth = incMonth - expMonth;

  return { incMonth, expMonth, balanceMonth };
}

/* ===================== Render de KPIs Móvil ===================== */
function renderMobileKPIs() {
  const { incMonth, expMonth, balanceMonth } = computeMonthKPIs();

  // Nombre de negocio
  if ($("#businessName")) {
    $("#businessName").textContent =
      cloudState.settings?.businessName || "Mi Negocio";
  }

  // ⚠️ IDs IGUALES A DESKTOP
  if ($("#kpiIncomesMonth")) {
    $("#kpiIncomesMonth").textContent = fmt(incMonth);
    $("#kpiIncomesMonth").title = "Ingresos del mes";
  }
  if ($("#kpiExpensesMonth")) {
    $("#kpiExpensesMonth").textContent = fmt(expMonth);
    $("#kpiExpensesMonth").title = "Gastos del mes";
  }
  if ($("#kpiBalanceMonth")) {
    $("#kpiBalanceMonth").textContent = fmt(balanceMonth);
    $("#kpiBalanceMonth").title = "Balance del mes (Ingresos - Gastos)";
  }
}

/* (Opcional) Conteo de facturas y cotizaciones del mes, por si tienes KPIs */
function renderMobileDocsKPIs() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const inMonth = (arr) =>
    (arr || []).filter((x) => inRange(x.date, monthStart, today)).length;

  const invCount = inMonth(cloudState.invoices || []);
  const quoCount = inMonth(cloudState.quotes || []);

  if ($("#kpiInvoicesMonth")) {
    $("#kpiInvoicesMonth").textContent = String(invCount);
  }
  if ($("#kpiQuotesMonth")) {
    $("#kpiQuotesMonth").textContent = String(quoCount);
  }
}

/* =========================================================
   CARGAR STATE DESDE FIRESTORE
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

  renderMobileKPIs();
  renderMobileDocsKPIs();
}

/* =========================================================
   LOGIN / LOGOUT MÓVIL
   ========================================================= */
function showLoggedOut() {
  const loginScreen = document.querySelector("#screen-login");
  const mainScreen  = document.querySelector("#screen-main");

  if (loginScreen) loginScreen.classList.add("visible");
  if (mainScreen)  mainScreen.classList.remove("visible");

  const userName = document.querySelector("#userName");
  if (userName) userName.textContent = "";
}

function showLoggedIn(user) {
  const loginScreen = document.querySelector("#screen-login");
  const mainScreen  = document.querySelector("#screen-main");

  if (loginScreen) loginScreen.classList.remove("visible");
  if (mainScreen)  mainScreen.classList.add("visible");

  const userName = document.querySelector("#userName");
  if (userName) {
    userName.textContent = user.displayName || user.email || "Usuario";
  }

  loadCloudState(user).catch((err) => {
    console.error("Error cargando datos:", err);
    toast("Error al cargar datos");
  });
}

function wireAuthUI() {
  const provider = new GoogleAuthProvider();

  const btnLogin = document.querySelector("#btnLoginGoogle");
  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        console.warn("Popup error, uso redirect:", e);
        await signInWithRedirect(auth, provider);
      }
    });
  }

  const btnLogout = document.querySelector("#btnLogout");
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

  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, (user) => {
    if (user) showLoggedIn(user);
    else showLoggedOut();
  });
}

/* =========================================================
   ARRANQUE
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  wireAuthUI();

  const btnRefresh = document.querySelector("#btnRefreshKPIs");
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
