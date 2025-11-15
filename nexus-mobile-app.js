/* =========================================================
   Nexus Finance — Mini App Móvil
   - Ingresos, Gastos, Facturas simples
   - Sincronizada con la Nexus completa vía Firebase
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

/** Usa el mismo config que Nexus full */
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

/* ===================== Estado local ===================== */

const STORAGE_KEY = "finanzas-state-v10";

/** Misma estructura que Nexus full */
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
  const box = $("#mobToast");
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
  unsub: null
};

function cloudDocRef() {
  if (!cloud.user) return null;
  return doc(db, "users", cloud.user.uid, "state", "app");
}

async function cloudPull(replace = true) {
  const ref = cloudDocRef();
  if (!ref) {
    toast("Conéctate con Google primero");
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
    // Fusión (opcional)
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
    ].forEach(k => {
      if (Array.isArray(remote[k])) {
        state[k] = state[k].concat(remote[k]);
      }
    });
    state._cloud = state._cloud || {};
    state._cloud.updatedAt = Math.max(lU, rU);
  }

  saveState({ skipCloud: true });
  toast("Datos cargados desde la nube");
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

/** 🔴 Suscripción en tiempo real (lo que faltaba para que la web app se refleje en el móvil) */
function cloudSubscribe() {
  const ref = cloudDocRef();
  if (!ref) return;

  if (cloud.unsub) {
    cloud.unsub();
    cloud.unsub = null;
  }

  cloud.unsub = onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    const remote = snap.data() || {};
    const rU = remote?._cloud?.updatedAt || 0;
    const lU = state?._cloud?.updatedAt || 0;

    if (rU > lU) {
      state = remote;
      saveState({ skipCloud: true });
      toast("Actualizado desde la nube");
    }
  });
}

/* ===================== UI de sincronización móvil ===================== */

function updateSyncUI() {
  const lbl = $("#mobCloudStatus");
  const btnIn = $("#mobCloudSignIn");
  const btnOut = $("#mobCloudSignOut");
  const chkAuto = $("#mobCloudAuto");

  if (lbl) {
    lbl.textContent = cloud.user
      ? `Google: ${cloud.user.displayName || cloud.user.email || cloud.user.uid}`
      : "No conectado";
  }
  if (btnIn) btnIn.style.display = cloud.user ? "none" : "inline-block";
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

  const btnIn   = $("#mobCloudSignIn");
  const btnOut  = $("#mobCloudSignOut");
  const btnPull = $("#mobCloudPull");
  const btnPush = $("#mobCloudPush");
  const chkAuto = $("#mobCloudAuto");

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

  onAuthStateChanged(auth, user => {
    cloud.user = user || null;
    updateSyncUI();

    if (user) {
      cloudSubscribe();
    } else if (cloud.unsub) {
      cloud.unsub();
      cloud.unsub = null;
    }
  });
}

/* ===================== Resumen HOY ===================== */

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

  if ($("#mobIncomeToday"))  $("#mobIncomeToday").textContent  = fmt(incToday);
  if ($("#mobExpenseToday")) $("#mobExpenseToday").textContent = fmt(expToday);
  if ($("#mobBalanceToday")) $("#mobBalanceToday").textContent = fmt(balToday);
}

/* ===================== Navegación móvil ===================== */

function showScreen(id) {
  $$(".mob-screen").forEach(s =>
    s.classList.toggle("visible", s.id === id)
  );
  $$("[data-screen]").forEach(btn =>
    btn.classList.toggle("active", `screen-${btn.dataset.screen}` === id)
  );
}

function wireNav() {
  $$("[data-screen]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.screen; // home | income | expense | invoice
      if (t) showScreen("screen-" + t);
    });
  });
  showScreen("screen-home");
}

/* ===================== Formularios ===================== */
/**
 * Esperado en HTML:
 *  #mobIncomeForm  (#mobIncDate, #mobIncClient, #mobIncAmount, #mobIncMethod)
 *  #mobExpenseForm (#mobExpDate, #mobExpCategory, #mobExpAmount, #mobExpMethod)
 *  #mobInvoiceForm (#mobInvDate, #mobInvNumber, #mobInvClient,
 *                   #mobInvPhone, #mobInvMethod, #mobInvConcept, #mobInvTotal)
 */

function wireIncomeForm() {
  const form = $("#mobIncomeForm");
  if (!form) return;

  const dateEl   = $("#mobIncDate");
  const clientEl = $("#mobIncClient");
  const amountEl = $("#mobIncAmount");
  const methodEl = $("#mobIncMethod");

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
    if (!rec.date)  return toast("Fecha requerida");
    if (!rec.amount) return toast("Monto requerido");

    state.incomesDaily.push(rec);
    saveState();
    toast("Ingreso guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
  });
}

function wireExpenseForm() {
  const form = $("#mobExpenseForm");
  if (!form) return;

  const dateEl = $("#mobExpDate");
  const catEl  = $("#mobExpCategory");
  const amtEl  = $("#mobExpAmount");
  const methEl = $("#mobExpMethod");

  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: dateEl?.value || todayStr(),
      category: catEl?.value || "Otros",
      desc: catEl?.value || "Gasto",
      method: methEl?.value || "Efectivo",
      amount: Number(amtEl?.value || 0),
      note: ""
    };
    if (!rec.date)  return toast("Fecha requerida");
    if (!rec.amount) return toast("Monto requerido");

    state.expensesDaily.push(rec);
    saveState();
    toast("Gasto guardado");
    form.reset();
    if (dateEl) dateEl.value = todayStr();
  });
}

function wireInvoiceForm() {
  const form = $("#mobInvoiceForm");
  if (!form) return;

  const dateEl    = $("#mobInvDate");
  const numEl     = $("#mobInvNumber");
  const clientEl  = $("#mobInvClient");
  const phoneEl   = $("#mobInvPhone");
  const methodEl  = $("#mobInvMethod");
  const conceptEl = $("#mobInvConcept");
  const totalEl   = $("#mobInvTotal");

  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  form.addEventListener("submit", ev => {
    ev.preventDefault();

    const date    = dateEl?.value || todayStr();
    const number  = (numEl?.value || "").trim();
    const client  = (clientEl?.value || "").trim() || "Cliente";
    const phone   = (phoneEl?.value || "").replace(/\D/g, "");
    const method  = methodEl?.value || "Efectivo";
    const concept = (conceptEl?.value || "").trim() || "Servicios prestados";
    const total   = Number(totalEl?.value || 0);

    if (!date || !number) return toast("Fecha y # de factura son requeridos");
    if (!total)           return toast("Total requerido");

    const items = [{
      id: uid(),
      desc: concept,
      qty: 1,
      price: total,
      tax: 0
    }];

    const subtotal = total;
    const taxTotal = 0;

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
      note: "",
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

    // WhatsApp si hay teléfono
    if (phone && phone.length >= 8) {
      const negocio = state.settings.businessName || "Mi Negocio";
      const msg =
        `Saludos ${client},\n` +
        `Adjunto el detalle de su factura #${number} por un total de ${fmt(total)}.\n\n` +
        `Negocio: ${negocio}\n` +
        `Método de pago: ${method}`;
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    }

    form.reset();
    if (dateEl) dateEl.value = todayStr();
  });
}

/* ===================== Arranque ===================== */

document.addEventListener("DOMContentLoaded", () => {
  wireNav();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  wireCloudUI();
  refreshTodaySummary();

  // Si ya había sesión Google, hacemos un pull inicial
  setTimeout(() => {
    if (cloud.user) {
      cloudPull(true).catch(() => {});
    }
  }, 600);
});

/* Debug consola (opcional) */
window.appMobile = {
  get state() { return state; },
  set state(v) { state = v; saveState(); },
  cloudPull,
  cloudPush,
  refreshTodaySummary
};
