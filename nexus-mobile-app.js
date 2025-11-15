// nexus-mobile-app.js
// Mini panel Nexus Finance Móvil
// 🔹 Lee y escribe DIRECTO en Firebase (mismo doc que Desktop)
// 🔹 No usa localStorage para los datos (solo para AutoSync)
// 🔹 Respeta el diseño actual (solo JS)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/* ===================== Firebase ===================== */
const firebaseConfig = {
  apiKey: "AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE",
  authDomain: "finanzas-web-f4e05.firebaseapp.com",
  projectId: "finanzas-web-f4e05",
  storageBucket: "finanzas-web-f4e05.firebasestorage.app",
  messagingSenderId: "1047152523619",
  appId: "1:1047152523619:web:7d8f7d1f7a5ccc6090bb56",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/* ===================== Helpers básicos ===================== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const todayStr = () => new Date().toISOString().slice(0, 10);

function toast(msg) {
  const t = $("#toast");
  if (!t) {
    console.log("[TOAST]", msg);
    return;
  }
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2300);
}

function uid(prefix = "m") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/* ===================== Estado en memoria ===================== */
// 🔹 NO usamos localStorage para datos financieros
// 🔹 Solo usamos el snapshot de Firebase como fuente de verdad
let currentUser = null;
let unsubscribeDoc = null;
let snapshotData = null; // aquí vive el state/app de Desktop compartido

function currencyCode() {
  return (snapshotData && snapshotData.settings && snapshotData.settings.currency) || "USD";
}
function businessName() {
  return (
    (snapshotData && snapshotData.settings && snapshotData.settings.businessName) ||
    "Mi Negocio"
  );
}
function logoSrc() {
  const base = snapshotData && snapshotData.settings && snapshotData.settings.logoBase64;
  return base || "assets/logo.png";
}

function fmt(n) {
  const c = currencyCode();
  const val = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-PR", { style: "currency", currency: c }).format(val);
  } catch {
    return `${c} ${val.toFixed(2)}`;
  }
}

/* ===================== UI: navegación móvil ===================== */
function showScreen(name) {
  const id = `screen-${name}`;
  $$(".screen").forEach((sc) => sc.classList.toggle("active", sc.id === id));
}

function wireNavigation() {
  $("#btnGoIncome")?.addEventListener("click", () => showScreen("income"));
  $("#btnGoExpense")?.addEventListener("click", () => showScreen("expense"));
  $("#btnGoInvoice")?.addEventListener("click", () => showScreen("invoice"));

  $$(".btn-back[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.back || "home";
      showScreen(target);
    });
  });

  // pantalla inicial
  showScreen("home");
}

/* ===================== UI: header (logo / nombre) ===================== */
function renderBrand() {
  const logo = $(".brand-logo");
  const title = $(".brand-title");
  const subtitle = $(".brand-sub");

  if (logo) logo.src = logoSrc();
  if (title) title.textContent = businessName();
  if (subtitle) subtitle.textContent = "Panel rápido móvil";
}

/* ===================== KPIs: ingresos hoy / gastos hoy / balance mes ===================== */
function sumRange(list, from, to) {
  if (!Array.isArray(list)) return 0;
  return list
    .filter((r) => r.date && r.date >= from && r.date <= to)
    .reduce((a, b) => a + Number(b.amount || 0), 0);
}

function renderKPIsAndTodayInvoices() {
  const today = todayStr();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const data = snapshotData || {};
  const incomesDaily = Array.isArray(data.incomesDaily) ? data.incomesDaily : [];
  const expensesDaily = Array.isArray(data.expensesDaily) ? data.expensesDaily : [];
  const personal = Array.isArray(data.personal) ? data.personal : [];
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];

  // 🔹 Ingresos / gastos de HOY (rápido)
  const incToday = sumRange(incomesDaily, today, today);
  const expToday =
    sumRange(expensesDaily, today, today) +
    sumRange(personal, today, today) +
    sumRange(payments, today, today);

  // 🔹 Mes completo: mismo criterio de Desktop (ingresos - todos los gastos)
  const incMonth = sumRange(incomesDaily, monthStart, today);
  const expMonth =
    sumRange(expensesDaily, monthStart, today) +
    sumRange(personal, monthStart, today) +
    sumRange(payments, monthStart, today);
  const balanceMonth = incMonth - expMonth;

  const incEl = $("#kpi-income-today");
  const expEl = $("#kpi-expenses-today");
  const balEl = $("#kpi-balance-today");

  if (incEl) incEl.textContent = fmt(incToday);
  if (expEl) expEl.textContent = fmt(expToday);
  if (balEl) {
    balEl.textContent = fmt(balanceMonth);
    // Cambiamos sutilmente el título para que quede claro que es MES
    const label = balEl.previousElementSibling;
    if (label && label.classList.contains("kpi-label")) {
      label.textContent = "Balance del mes";
    }
  }

  // 🔹 Listado de facturas de hoy
  const todayDiv = $("#todayInvoices");
  if (!todayDiv) return;

  const todayInvoices = invoices.filter((inv) => inv.date === today);
  if (!todayInvoices.length) {
    todayDiv.className = "list-empty";
    todayDiv.textContent = "No hay facturas registradas hoy.";
    return;
  }

  todayDiv.className = "invoice-list";
  todayDiv.innerHTML = "";
  todayInvoices
    .slice()
    .sort((a, b) => (String(a.number || "").localeCompare(String(b.number || ""))))
    .forEach((inv) => {
      const item = document.createElement("div");
      item.className = "invoice-item";
      item.innerHTML = `
        <div class="invoice-main">
          <span class="inv-number">#${inv.number || "—"}</span>
          <span class="inv-client">${inv.client?.name || "Sin nombre"}</span>
        </div>
        <div class="invoice-meta">
          <span class="inv-total">${fmt(inv.total || 0)}</span>
          <span class="inv-method">${inv.method || ""}</span>
        </div>
      `;
      todayDiv.appendChild(item);
    });
}

/* ===================== Firebase: Auth + Listener del doc ===================== */
const autosyncKey = "nexusMobile-autosync";

function updateSyncUI() {
  const signInBtn = $("#btnSignInMobile");
  const signOutBtn = $("#btnSignOutMobile");
  const status = $("#syncStatusMobile");

  if (!status) return;

  if (currentUser) {
    const name = currentUser.displayName || currentUser.email || currentUser.uid;
    status.textContent = `Conectado como ${name}`;
    if (signInBtn) signInBtn.style.display = "none";
    if (signOutBtn) signOutBtn.style.display = "inline-block";
  } else {
    status.textContent = "Sin conexión";
    if (signInBtn) signInBtn.style.display = "inline-block";
    if (signOutBtn) signOutBtn.style.display = "none";
  }

  const autosyncChk = $("#chkAutosyncMobile");
  if (autosyncChk && autosyncChk instanceof HTMLInputElement) {
    autosyncChk.checked = localStorage.getItem(autosyncKey) === "true";
  }
}

function docRef() {
  if (!currentUser) return null;
  return doc(db, "users", currentUser.uid, "state", "app");
}

function startDocListener() {
  if (unsubscribeDoc) {
    unsubscribeDoc();
    unsubscribeDoc = null;
  }
  const ref = docRef();
  if (!ref) return;

  unsubscribeDoc = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        snapshotData = null;
        renderBrand();
        renderKPIsAndTodayInvoices();
        return;
      }
      snapshotData = snap.data();
      renderBrand();
      renderKPIsAndTodayInvoices();
    },
    (err) => {
      console.error("onSnapshot error (móvil):", err);
      toast("Error al leer datos de la nube");
    }
  );
}

function wireSyncButtons() {
  const provider = new GoogleAuthProvider();

  $("#btnSignInMobile")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
      // En móviles a veces falla popup, usamos redirect como plan B
    } catch (e) {
      try {
        await signInWithRedirect(auth, provider);
      } catch (err) {
        console.error("Error al iniciar sesión (móvil):", err);
        toast("Error al conectar con Google");
      }
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      toast("Sesión cerrada");
    } catch (e) {
      console.error("Error al cerrar sesión:", e);
      toast("No se pudo cerrar sesión");
    }
  });

  $("#btnSyncPullMobile")?.addEventListener("click", async () => {
    const ref = docRef();
    if (!ref) {
      toast("Conéctate con Google primero");
      return;
    }
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        toast("No hay datos en la nube todavía");
        return;
      }
      snapshotData = snap.data();
      renderBrand();
      renderKPIsAndTodayInvoices();
      toast("Datos actualizados desde la nube");
    } catch (e) {
      console.error("Pull móvil error:", e);
      toast("Error al traer datos");
    }
  });

  $("#btnSyncPushMobile")?.addEventListener("click", async () => {
    const ref = docRef();
    if (!ref) {
      toast("Conéctate con Google primero");
      return;
    }
    if (!snapshotData) {
      toast("No hay cambios que enviar");
      return;
    }
    try {
      await setDoc(
        ref,
        {
          _cloud: {
            ...(snapshotData._cloud || {}),
            updatedAt: Date.now(),
          },
          _serverUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast("Marcado como sincronizado");
    } catch (e) {
      console.error("Push móvil error:", e);
      toast("Error al enviar datos");
    }
  });

  const autosyncChk = $("#chkAutosyncMobile");
  if (autosyncChk && autosyncChk instanceof HTMLInputElement) {
    autosyncChk.checked = localStorage.getItem(autosyncKey) === "true";
    autosyncChk.addEventListener("change", () => {
      localStorage.setItem(autosyncKey, autosyncChk.checked ? "true" : "false");
    });
  }
}

function autoPushCloud() {
  const autosync = localStorage.getItem(autosyncKey) === "true";
  const ref = docRef();
  if (!autosync || !ref || !snapshotData) return;
  setDoc(
    ref,
    {
      _cloud: {
        ...(snapshotData._cloud || {}),
        updatedAt: Date.now(),
      },
      _serverUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch((e) => console.error("autoPushCloud error:", e));
}

/* ===================== PDF de factura (jsPDF) ===================== */
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
  const docPDF = new jsPDF({ unit: "mm", format: "a4" });

  const business = businessName();
  const logo = logoSrc();

  function header() {
    try {
      if (logo && logo.startsWith("data:")) {
        docPDF.addImage(logo, "PNG", 14, 10, 24, 24);
      } else {
        // si es ruta, ignoramos en móvil (suele ser asset)
      }
    } catch (e) {
      console.warn("No se pudo agregar el logo al PDF (móvil)", e);
    }
    docPDF.setFont("helvetica", "bold");
    docPDF.setTextColor(0);
    docPDF.setFontSize(16);
    docPDF.text(business, 42, 18);
    docPDF.setFontSize(12);
    docPDF.text("FACTURA", 42, 26);
    docPDF.line(14, 36, 200, 36);
  }

  header();
  let y = 42;

  docPDF.setFont("helvetica", "bold");
  docPDF.setFontSize(10);
  docPDF.text("Para:", 14, y);
  y += 6;
  docPDF.setFont("helvetica", "normal");
  if (invoice.client?.name) {
    docPDF.text(String(invoice.client.name), 14, y);
    y += 6;
  }
  if (invoice.client?.phone) {
    docPDF.text(String(invoice.client.phone), 14, y);
    y += 6;
  }

  let ry = 42;
  const rx = 200;
  docPDF.setFont("helvetica", "bold");
  docPDF.text("Factura #", rx - 70, ry);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(String(invoice.number || ""), rx - 20, ry, { align: "right" });
  ry += 6;

  docPDF.setFont("helvetica", "bold");
  docPDF.text("Fecha", rx - 70, ry);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(String(invoice.date || ""), rx - 20, ry, { align: "right" });
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

  (invoice.items || []).forEach((it) => {
    x = 14;
    const base = (it.qty || 0) * (it.price || 0);
    const tax = base * ((it.tax || 0) / 100);
    const amt = base + tax;
    const row = [
      it.desc || "",
      String(it.qty || 0),
      Number(it.price || 0).toFixed(2),
      String(it.tax || 0),
      amt.toFixed(2),
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

  docPDF.setFont("helvetica", "bold");
  docPDF.text("Subtotal", 150, y);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(fmt(invoice.subtotal || 0), 198, y, { align: "right" });
  y += 6;

  docPDF.setFont("helvetica", "bold");
  docPDF.text("Impuestos", 150, y);
  docPDF.setFont("helvetica", "normal");
  docPDF.text(fmt(invoice.taxTotal || 0), 198, y, { align: "right" });
  y += 6;

  docPDF.setFont("helvetica", "bold");
  docPDF.text("TOTAL", 150, y);
  docPDF.setFont("helvetica", "bold");
  docPDF.text(fmt(invoice.total || 0), 198, y, { align: "right" });
  y += 10;

  if (invoice.note) {
    docPDF.setFont("helvetica", "bold");
    docPDF.text("Nota:", 14, y);
    docPDF.setFont("helvetica", "normal");
    docPDF.text(String(invoice.note).slice(0, 240), 14, y + 6);
  }

  const fileName = `${business.replace(/\s+/g, "_")}_Factura_${
    invoice.number || ""
  }.pdf`;
  docPDF.save(fileName);
}

/* ===================== WhatsApp helper ===================== */
function openWhatsApp(invoice) {
  const rawPhone = (invoice.client?.phone || "").replace(/\D/g, "");
  if (!rawPhone) {
    toast("No hay teléfono para WhatsApp");
    return;
  }
  const msg = [
    `Hola ${invoice.client?.name || "cliente"},`,
    "",
    `Adjunto el detalle de tu factura #${invoice.number || ""}.`,
    `Total: ${fmt(invoice.total || 0)}`,
    "",
    "Gracias por tu preferencia.",
  ].join("\n");
  const url = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

/* ===================== Formularios rápidos ===================== */
function wireQuickIncome() {
  const form = $("#formIncome");
  if (!form) return;

  $("#incDateMobile").value = todayStr();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!currentUser) {
      toast("Conéctate con Google primero");
      return;
    }
    const date = $("#incDateMobile").value || todayStr();
    const client = $("#incClientMobile").value || "Ingreso móvil";
    const method = $("#incMethodMobile").value || "Efectivo";
    const amount = parseFloat($("#incAmountMobile").value || "0") || 0;
    if (!amount) {
      toast("Monto requerido");
      return;
    }

    const rec = {
      id: uid("inc"),
      date,
      client,
      method,
      amount,
    };

    try {
      const ref = docRef();
      await setDoc(
        ref,
        {
          incomesDaily: arrayUnion(rec),
          _cloud: {
            ...(snapshotData?._cloud || {}),
            updatedAt: Date.now(),
          },
          _serverUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast("Ingreso guardado");
      form.reset();
      $("#incDateMobile").value = date;
      autoPushCloud();
    } catch (e) {
      console.error("Error guardando ingreso móvil:", e);
      toast("No se pudo guardar el ingreso");
    }
  });
}

function wireQuickExpense() {
  const form = $("#formExpense");
  if (!form) return;

  $("#expDateMobile").value = todayStr();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!currentUser) {
      toast("Conéctate con Google primero");
      return;
    }
    const date = $("#expDateMobile").value || todayStr();
    const category = $("#expCategoryMobile").value || "Gasto móvil";
    const method = $("#expMethodMobile").value || "Efectivo";
    const amount = parseFloat($("#expAmountMobile").value || "0") || 0;
    if (!amount) {
      toast("Monto requerido");
      return;
    }

    const rec = {
      id: uid("exp"),
      date,
      category,
      desc: category,
      method,
      amount,
      note: "",
    };

    try {
      const ref = docRef();
      await setDoc(
        ref,
        {
          expensesDaily: arrayUnion(rec),
          _cloud: {
            ...(snapshotData?._cloud || {}),
            updatedAt: Date.now(),
          },
          _serverUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast("Gasto guardado");
      form.reset();
      $("#expDateMobile").value = date;
      autoPushCloud();
    } catch (e) {
      console.error("Error guardando gasto móvil:", e);
      toast("No se pudo guardar el gasto");
    }
  });
}

/* ----- Ítems de factura en el panel móvil ----- */
function buildItemRow() {
  const wrap = document.createElement("div");
  wrap.className = "item-row";
  wrap.innerHTML = `
    <input type="text" class="item-desc" placeholder="Descripción">
    <input type="number" class="item-qty" step="0.01" value="1">
    <input type="number" class="item-price" step="0.01" value="0">
    <input type="number" class="item-tax" step="0.01" value="0">
    <span class="item-amount">0.00</span>
    <button type="button" class="btn-outline btn-small item-del">✕</button>
  `;
  return wrap;
}

function recalcInvoiceTotalsFromDOM() {
  const container = $("#invItemsContainer");
  if (!container) return { items: [], subtotal: 0, taxTotal: 0, total: 0 };

  const rows = $$(".item-row", container);
  const items = [];
  let subtotal = 0;
  let taxTotal = 0;

  rows.forEach((row) => {
    const desc = $(".item-desc", row)?.value || "";
    const qty = parseFloat($(".item-qty", row)?.value || "0") || 0;
    const price = parseFloat($(".item-price", row)?.value || "0") || 0;
    const tax = parseFloat($(".item-tax", row)?.value || "0") || 0;

    const base = qty * price;
    const taxAmt = base * (tax / 100);
    const amt = base + taxAmt;

    $(".item-amount", row).textContent = amt.toFixed(2);

    items.push({
      id: uid("item"),
      desc,
      qty,
      price,
      tax,
    });

    subtotal += base;
    taxTotal += taxAmt;
  });

  const total = subtotal + taxTotal;

  $("#invSubtotalMobile").textContent = fmt(subtotal);
  $("#invTaxMobile").textContent = fmt(taxTotal);
  $("#invTotalMobile").textContent = fmt(total);

  return { items, subtotal, taxTotal, total };
}

function wireInvoiceForm() {
  const form = $("#formInvoice");
  if (!form) return;

  $("#invDateMobile").value = todayStr();

  const itemsContainer = $("#invItemsContainer");
  const btnAddItem = $("#btnAddItem");
  const btnCalc = $("#btnCalcInvoice");
  const btnSave = $("#btnSaveInvoice");
  const btnSaveWA = $("#btnSaveInvoiceWhatsApp");

  function addRow() {
    if (!itemsContainer) return;
    const row = buildItemRow();
    itemsContainer.appendChild(row);
    $(".item-del", row)?.addEventListener("click", () => {
      row.remove();
      recalcInvoiceTotalsFromDOM();
    });
    ["item-desc", "item-qty", "item-price", "item-tax"].forEach((cls) => {
      $(`.${cls}`, row)?.addEventListener("input", () => recalcInvoiceTotalsFromDOM());
    });
  }

  // al menos una fila por defecto
  if (itemsContainer && !itemsContainer.children.length) addRow();

  btnAddItem?.addEventListener("click", addRow);
  btnCalc?.addEventListener("click", () => recalcInvoiceTotalsFromDOM());

  async function saveInvoice({ openWA = false }) {
    if (!currentUser) {
      toast("Conéctate con Google primero");
      return;
    }

    const date = $("#invDateMobile").value || todayStr();
    const number = $("#invNumberMobile").value || "";
    const clientName = $("#invClientMobile").value || "";
    const phone = $("#invPhoneMobile").value || "";
    const method = $("#invMethodMobile").value || "Efectivo";
    const note = $("#invNoteMobile").value || "";

    if (!date || !number) {
      toast("Fecha y número de factura son requeridos");
      return;
    }

    const { items, subtotal, taxTotal, total } = recalcInvoiceTotalsFromDOM();
    if (!items.length) {
      toast("Agrega al menos un ítem");
      return;
    }

    const invoice = {
      id: uid("inv"),
      date,
      dueDate: "",
      number,
      method,
      client: {
        name: clientName,
        email: "",
        phone,
        address: "",
      },
      items,
      subtotal,
      taxTotal,
      total,
      note,
      terms: "",
    };

    const income = {
      id: uid("incf"),
      date,
      client: clientName || "Factura móvil",
      method,
      amount: total,
      invoiceNumber: number,
    };

    try {
      const ref = docRef();
      await setDoc(
        ref,
        {
          invoices: arrayUnion(invoice),
          incomesDaily: arrayUnion(income),
          _cloud: {
            ...(snapshotData?._cloud || {}),
            updatedAt: Date.now(),
          },
          _serverUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast("Factura guardada");

      // PDF siempre que se guarda
      await generateInvoicePDFMobile(invoice);

      if (openWA) {
        openWhatsApp(invoice);
      }

      form.reset();
      $("#invDateMobile").value = date;
      if (itemsContainer) itemsContainer.innerHTML = "";
      addRow();
      $("#invSubtotalMobile").textContent = "—";
      $("#invTaxMobile").textContent = "—";
      $("#invTotalMobile").textContent = "—";

      autoPushCloud();
    } catch (e) {
      console.error("Error guardando factura móvil:", e);
      toast("No se pudo guardar la factura");
    }
  }

  btnSave?.addEventListener("click", (ev) => {
    ev.preventDefault();
    saveInvoice({ openWA: false });
  });

  btnSaveWA?.addEventListener("click", (ev) => {
    ev.preventDefault();
    saveInvoice({ openWA: true });
  });
}

/* ===================== INIT ===================== */
function initAuth() {
  onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    updateSyncUI();
    if (currentUser) {
      startDocListener();
    } else {
      if (unsubscribeDoc) unsubscribeDoc();
      unsubscribeDoc = null;
      snapshotData = null;
      renderBrand();
      renderKPIsAndTodayInvoices();
    }
  });

  // manejar redirect en móviles
  getRedirectResult(auth).catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
  wireNavigation();
  wireSyncButtons();
  wireQuickIncome();
  wireQuickExpense();
  wireInvoiceForm();
  initAuth();

  renderBrand();
  renderKPIsAndTodayInvoices();
});
