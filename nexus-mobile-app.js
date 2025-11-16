// nexus-mobile-app.js
// Versión móvil sincronizada con el mismo documento de Firebase que el Desktop
// UID FIJO (el que me diste): 7Si5WwQQLWRt4bhlQ59duPVVqSB2

/* ===================== Firebase ===================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
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

/* 🔒 UID FIJO DEL DESKTOP */
const MASTER_UID = "7Si5WwQQLWRt4bhlQ59duPVVqSB2";

/* ===================== Helpers base ===================== */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

const STORAGE_KEY   = "nexus-mobile-state-v1";
const AUTOSYNC_KEY  = "nexus-mobile-autosync";

const DEFAULT_STATE = {
  settings: {
    businessName: "Mi Negocio",
    currency: "USD",
    // 🔵 IMPORTANTE: aquí se va a guardar el logo en base64 que viene del Desktop
    logoBase64: ""
  },
  expensesDaily: [],   // gastos de negocio
  incomesDaily: [],    // ingresos
  payments: [],        // nómina
  personal: [],        // gastos personales
  invoices: [],        // facturas
  quotes: [],
  _cloud: { updatedAt: 0 }
};

function clone(o){ return JSON.parse(JSON.stringify(o)); }

function loadLocalState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return clone(DEFAULT_STATE);
  try{
    const st = JSON.parse(raw);
    const base = clone(DEFAULT_STATE);
    // merge suave para no perder nuevos campos (logoBase64, etc)
    return {
      ...base,
      ...st,
      settings: { ...base.settings, ...(st.settings || {}) }
    };
  }catch{
    return clone(DEFAULT_STATE);
  }
}

let state = loadLocalState();

function saveLocal({skipCloud=false} = {}){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if(!skipCloud && cloud.autosync && cloud.user){
    cloudPushDebounced();
  }
  renderAllMobile();
}

function todayStr(){
  return new Date().toISOString().slice(0,10);
}

function toDate(s){
  return new Date(s || "1970-01-01");
}
function inRange(dateStr, from, to){
  const t = +toDate(dateStr);
  if(from && t < +toDate(from)) return false;
  if(to && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
}

function fmt(n){
  const cur = state.settings?.currency || "USD";
  const val = Number(n || 0);
  try{
    return new Intl.NumberFormat("es-PR",{style:"currency",currency:cur}).format(val);
  }catch{
    return `${cur} ${val.toFixed(2)}`;
  }
}

function toast(msg){
  let t = $("#toast");
  if(!t){
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  t.style.pointerEvents = "auto";
  setTimeout(()=>{
    t.style.opacity = "0";
    t.style.pointerEvents = "none";
  }, 2200);
}

/* ===================== CLOUD (usa SIEMPRE el MASTER_UID) ===================== */
const cloud = {
  user: null,
  autosync: JSON.parse(localStorage.getItem(AUTOSYNC_KEY) || "false"),
  pushTimer: null
};

function masterDocRef(){
  return doc(db, "users", MASTER_UID, "state", "app");
}

function setAutosyncMobile(v){
  cloud.autosync = !!v;
  localStorage.setItem(AUTOSYNC_KEY, JSON.stringify(cloud.autosync));
  const chk = $("#chkAutosyncMobile");
  if(chk) chk.checked = cloud.autosync;
}

async function cloudPullMobile(){
  try{
    const ref = masterDocRef();
    const snap = await getDoc(ref);
    if(!snap.exists()){
      toast("No hay datos en la nube (Desktop)");
      return;
    }
    const remote = snap.data() || {};
    // Mezclamos con DEFAULT_STATE para no romper nada
    state = {
      ...clone(DEFAULT_STATE),
      ...remote,
      settings: {
        ...clone(DEFAULT_STATE).settings,
        ...(remote.settings || {})
      }
    };
    toast("Datos traídos de la nube (Desktop)");
    saveLocal({skipCloud:true});
    renderAllMobile();
  }catch(e){
    console.error("cloudPullMobile error:", e);
    toast("Error al traer datos (verifica cuenta y permisos)");
  }
}

async function cloudPushMobile(){
  try{
    const ref = masterDocRef();
    state._cloud = state._cloud || {};
    state._cloud.updatedAt = Date.now();
    await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge:true });
    toast("Datos enviados a la nube");
    saveLocal({skipCloud:true});
  }catch(e){
    console.error("cloudPushMobile error:", e);
    toast("Error al enviar datos");
  }
}

function cloudPushDebounced(){
  clearTimeout(cloud.pushTimer);
  cloud.pushTimer = setTimeout(cloudPushMobile, 700);
}

function updateCloudUI(){
  const status = $("#syncStatusMobile");
  if(status){
    if(cloud.user){
      status.textContent = `Conectado: ${cloud.user.displayName || cloud.user.email || ""}`;
    }else{
      status.textContent = "Sin conexión";
    }
  }
  const btnIn  = $("#btnSignInMobile");
  const btnOut = $("#btnSignOutMobile");
  if(btnIn)  btnIn.style.display  = cloud.user ? "none" : "inline-block";
  if(btnOut) btnOut.style.display = cloud.user ? "inline-block" : "none";

  const chk = $("#chkAutosyncMobile");
  if(chk) chk.checked = cloud.autosync;
}

function wireCloudMobile(){
  const provider = new GoogleAuthProvider();

  $("#btnSignInMobile")?.addEventListener("click", async ()=>{
    try{
      await signInWithPopup(auth, provider);
    }catch{
      await signInWithRedirect(auth, provider);
    }
  });

  $("#btnSignOutMobile")?.addEventListener("click", async ()=>{
    try{
      await signOut(auth);
    }catch(e){
      console.error(e);
    }
  });

  $("#btnSyncPullMobile")?.addEventListener("click", ()=>{
    cloudPullMobile();
  });

  $("#btnSyncPushMobile")?.addEventListener("click", ()=>{
    cloudPushMobile();
  });

  $("#chkAutosyncMobile")?.addEventListener("change", (e)=>{
    setAutosyncMobile(e.target.checked);
  });

  updateCloudUI();

  getRedirectResult(auth).catch(()=>{});
  onAuthStateChanged(auth, (user)=>{
    cloud.user = user || null;
    updateCloudUI();
  });
}

/* ===================== KPIs (Iguales a Desktop: YTD) ===================== */

function sumRange(list, from, to){
  if(!Array.isArray(list)) return 0;
  return list
    .filter(r => inRange(r.date, from, to))
    .reduce((a,b)=> a + Number(b.amount || 0), 0);
}

function sumExpensesDailySplit(from, to){
  let recurrent = 0, nonRec = 0;
  const isRec = (e) =>
    e.method === "Automático" ||
    (e.desc || "").toLowerCase().startsWith("recurrente");

  (state.expensesDaily || [])
    .filter(e => inRange(e.date, from, to))
    .forEach(e=>{
      const amt = Number(e.amount || 0);
      if(isRec(e)) recurrent += amt;
      else nonRec += amt;
    });

  return {
    total: recurrent + nonRec,
    recurrent,
    nonRecurrent: nonRec
  };
}

function sumPaymentsRange(from, to){
  return (state.payments || [])
    .filter(p => inRange(p.date, from, to))
    .reduce((a,b)=> a + Number(b.amount || 0), 0);
}

function sumPersonalRange(from, to){
  return (state.personal || [])
    .filter(p => inRange(p.date, from, to))
    .reduce((a,b)=> a + Number(b.amount || 0), 0);
}

function renderKPIHomeMobile(){
  const now = new Date();
  const today = now.toISOString().slice(0,10);
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);

  // === YTD (igual que Desktop) ===
  const incYTD = sumRange(state.incomesDaily, yearStart, today);
  const expSplitYTD = sumExpensesDailySplit(yearStart, today);
  const perYTD = sumPersonalRange(yearStart, today);
  const payYTD = sumPaymentsRange(yearStart, today);
  const totalExpYTD = expSplitYTD.total + perYTD + payYTD;
  const balanceYTD = incYTD - totalExpYTD;

  const elInc = $("#kpi-income-today");
  const elExp = $("#kpi-expenses-today");
  const elBal = $("#kpi-balance-today");

  if(elInc){ elInc.textContent = fmt(incYTD); elInc.title = "Ingresos YTD (igual que desktop)"; }
  if(elExp){ elExp.textContent = fmt(totalExpYTD); elExp.title = "Gastos YTD (igual que desktop)"; }
  if(elBal){ elBal.textContent = fmt(balanceYTD); elBal.title = "Balance YTD (igual que desktop)"; }
}

/* ===================== HOME: facturas de hoy ===================== */
function renderTodayInvoices(){
  const container = $("#todayInvoices");
  if(!container) return;

  const today = todayStr();
  const todays = (state.invoices || []).filter(inv => (inv.date === today));

  if(todays.length === 0){
    container.className = "list-empty";
    container.innerHTML = "No hay facturas registradas hoy.";
    return;
  }

  container.className = "today-list-body";
  container.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "simple-list";

  todays.forEach(inv=>{
    const li = document.createElement("li");
    const method = inv.method || "";
    const client = inv.client?.name || "";
    const num = inv.number || "";
    li.innerHTML = `
      <div class="line-1">
        <strong>${client || "Sin cliente"}</strong> — ${fmt(inv.total || 0)}
      </div>
      <div class="line-2">
        Factura #${num || "—"} · ${method}
      </div>
    `;
    ul.appendChild(li);
  });

  container.appendChild(ul);
}

/* ===================== Navegación simple ===================== */
function showScreen(id){
  $$(".screen").forEach(s => {
    s.classList.toggle("active", s.id === id);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wireNavigation(){
  $("#btnGoIncome")?.addEventListener("click", ()=>{
    const f = $("#formIncome");
    if($("#incDateMobile")) $("#incDateMobile").value = todayStr();
    showScreen("screen-income");
    f?.querySelector("input,select")?.focus();
  });

  $("#btnGoExpense")?.addEventListener("click", ()=>{
    const f = $("#formExpense");
    if($("#expDateMobile")) $("#expDateMobile").value = todayStr();
    showScreen("screen-expense");
    f?.querySelector("input,select")?.focus();
  });

  $("#btnGoInvoice")?.addEventListener("click", ()=>{
    if($("#invDateMobile")) $("#invDateMobile").value = todayStr();
    showScreen("screen-invoice");
  });

  $$(".btn-back").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const back = btn.dataset.back || "home";
      showScreen(`screen-${back}`);
    });
  });
}

/* ===================== Ingreso rápido ===================== */
function wireIncomeForm(){
  const form = $("#formIncome");
  if(!form) return;

  form.addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const rec = {
      id: Date.now().toString(36),
      date: $("#incDateMobile")?.value || todayStr(),
      client: $("#incClientMobile")?.value || "",
      method: $("#incMethodMobile")?.value || "",
      amount: Number($("#incAmountMobile")?.value || 0)
    };
    if(!rec.date){
      toast("La fecha es requerida");
      return;
    }
    if(!rec.amount){
      toast("Monto inválido");
      return;
    }
    state.incomesDaily.push(rec);
    toast("Ingreso guardado");
    saveLocal();
    form.reset();
    $("#incDateMobile").value = todayStr();
  });
}

/* ===================== Gasto rápido ===================== */
function wireExpenseForm(){
  const form = $("#formExpense");
  if(!form) return;

  form.addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const rec = {
      id: Date.now().toString(36),
      date: $("#expDateMobile")?.value || todayStr(),
      category: $("#expCategoryMobile")?.value || "",
      method: $("#expMethodMobile")?.value || "",
      amount: Number($("#expAmountMobile")?.value || 0),
      desc: "",
      note: ""
    };
    if(!rec.date){
      toast("La fecha es requerida");
      return;
    }
    if(!rec.amount){
      toast("Monto inválido");
      return;
    }
    state.expensesDaily.push(rec);
    toast("Gasto guardado");
    saveLocal();
    form.reset();
    $("#expDateMobile").value = todayStr();
  });
}

/* ===================== Items dinámicos de factura ===================== */
function createItemRow(){
  const row = document.createElement("div");
  row.className = "inv-item-row";
  row.innerHTML = `
    <div class="row">
      <input type="text" class="inv-desc" placeholder="Descripción">
    </div>
    <div class="row two">
      <input type="number" step="0.01" class="inv-qty" placeholder="Cant" value="1">
      <input type="number" step="0.01" class="inv-price" placeholder="Precio" value="0">
    </div>
    <div class="row two">
      <input type="number" step="0.01" class="inv-tax" placeholder="% Imp" value="0">
      <button type="button" class="btn-outline btn-remove-item">✕</button>
    </div>
  `;
  row.querySelector(".btn-remove-item").addEventListener("click", ()=>{
    row.remove();
    calcInvoiceTotals();
  });
  ["input","change"].forEach(evt=>{
    row.querySelectorAll("input").forEach(inp=>{
      inp.addEventListener(evt, calcInvoiceTotals);
    });
  });
  return row;
}

function getItemsFromDOM(){
  const cont = $("#invItemsContainer");
  if(!cont) return [];
  const rows = cont.querySelectorAll(".inv-item-row");
  const items = [];
  rows.forEach(r=>{
    const desc  = r.querySelector(".inv-desc")?.value || "";
    const qty   = parseFloat(r.querySelector(".inv-qty")?.value || "0") || 0;
    const price = parseFloat(r.querySelector(".inv-price")?.value || "0") || 0;
    const tax   = parseFloat(r.querySelector(".inv-tax")?.value || "0") || 0;
    items.push({ desc, qty, price, tax });
  });
  return items;
}

function calcTotals(items){
  let subtotal = 0;
  let taxTotal = 0;
  items.forEach(it=>{
    const base = (it.qty || 0) * (it.price || 0);
    const tAmt = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tAmt;
  });
  return {
    subtotal,
    taxTotal,
    total: subtotal + taxTotal
  };
}

function calcInvoiceTotals(){
  const items = getItemsFromDOM();
  const totals = calcTotals(items);
  const sub = $("#invSubtotalMobile");
  const tax = $("#invTaxMobile");
  const tot = $("#invTotalMobile");
  if(sub) sub.textContent = items.length ? fmt(totals.subtotal) : "—";
  if(tax) tax.textContent = items.length ? fmt(totals.taxTotal)   : "—";
  if(tot) tot.textContent = items.length ? fmt(totals.total)      : "—";
}

/* ===================== jsPDF + FACTURA PDF CON LOGO ===================== */

let jsPDFReadyMobile = false;

async function ensureJsPDFMobile(){
  if(jsPDFReadyMobile) return;
  await new Promise((res, rej)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  jsPDFReadyMobile = true;
}

async function generateInvoicePDFMobile(inv){
  await ensureJsPDFMobile();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const business = state.settings?.businessName || "Mi Negocio";
  const logo     = state.settings?.logoBase64 || ""; // 🔵 viene del Desktop
  const title    = "FACTURA";

  // HEADER CON LOGO
  try{
    if(logo && logo.startsWith("data:")){
      // mismo estilo que desktop: logo 24x24mm aprox
      doc.addImage(logo, "PNG", 14, 10, 24, 24);
    }
  }catch(e){
    console.warn("No se pudo dibujar el logo en PDF móvil:", e);
  }

  doc.setFont("helvetica","bold");
  doc.setTextColor(0);
  doc.setFontSize(16);
  doc.text(business, 42, 18);

  doc.setFontSize(12);
  doc.text(title, 42, 26);
  doc.line(14, 36, 200, 36);

  let y = 42;

  // Datos cliente
  doc.setFont("helvetica","bold");
  doc.setFontSize(10);
  doc.text("Para:", 14, y);
  y += 6;
  doc.setFont("helvetica","normal");
  if(inv.client?.name){
    doc.text(String(inv.client.name), 14, y); y += 6;
  }
  if(inv.client?.phone){
    doc.text(String(inv.client.phone), 14, y); y += 6;
  }

  // Datos factura a la derecha
  let ry = 42;
  doc.setFont("helvetica","bold");
  doc.text("Factura #", 200 - 70, ry);
  doc.setFont("helvetica","normal");
  doc.text(String(inv.number || ""), 200 - 20, ry, { align:"right" }); ry += 6;

  doc.setFont("helvetica","bold");
  doc.text("Fecha", 200 - 70, ry);
  doc.setFont("helvetica","normal");
  doc.text(String(inv.date || ""), 200 - 20, ry, { align:"right" }); ry += 6;

  y = Math.max(y, 74);
  doc.line(14, y, 200, y);
  y += 6;

  // Tabla de items
  const headers = ["Descripción","Cant.","Precio","Imp %","Importe"];
  const colW = [90, 20, 30, 20, 20];

  doc.setFont("helvetica","bold");
  let x = 14;
  headers.forEach((h,i)=>{
    doc.text(h, x, y);
    x += colW[i];
  });
  y += 6;
  doc.line(14, y, 200, y);
  y += 6;
  doc.setFont("helvetica","normal");

  inv.items.forEach(it=>{
    x = 14;
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0) / 100);
    const amt  = base + tax;
    const row = [
      it.desc || "",
      String(it.qty || 0),
      Number(it.price || 0).toFixed(2),
      String(it.tax || 0),
      amt.toFixed(2)
    ];
    row.forEach((c,i)=>{
      doc.text(String(c).slice(0,60), x, y);
      x += colW[i];
    });
    y += 6;
    if(y > 260){
      doc.addPage(); y = 20;
    }
  });

  if(y + 30 > 290){
    doc.addPage();
    y = 20;
  }

  y += 4;
  doc.line(120, y, 200, y);
  y += 6;

  doc.setFont("helvetica","bold");
  doc.text("Subtotal", 150, y);
  doc.setFont("helvetica","normal");
  doc.text(fmt(inv.subtotal || 0), 198, y, { align:"right" });
  y += 6;

  doc.setFont("helvetica","bold");
  doc.text("Impuestos", 150, y);
  doc.setFont("helvetica","normal");
  doc.text(fmt(inv.taxTotal || 0), 198, y, { align:"right" });
  y += 6;

  doc.setFont("helvetica","bold");
  doc.text("TOTAL", 150, y);
  doc.text(fmt(inv.total || 0), 198, y, { align:"right" });
  y += 10;

  if(inv.note){
    doc.setFont("helvetica","bold");
    doc.text("Nota:", 14, y);
    doc.setFont("helvetica","normal");
    doc.text(String(inv.note).slice(0,240), 14, y+6);
    y += 12;
  }

  // Abrir en pestaña nueva
  const pdfBlob = doc.output("blob");
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, "_blank");
  return url; // por si queremos usarlo luego
}

/* ===================== Factura rápida + WhatsApp ===================== */
function wireInvoiceForm(){
  const contItems = $("#invItemsContainer");
  const btnAdd = $("#btnAddItem");
  const btnCalc = $("#btnCalcInvoice");
  const form = $("#formInvoice");
  const btnSave = $("#btnSaveInvoice");
  const btnWA = $("#btnSaveInvoiceWhatsApp");

  if(btnAdd && contItems){
    btnAdd.addEventListener("click", ()=>{
      contItems.appendChild(createItemRow());
      calcInvoiceTotals();
    });
  }

  if(btnCalc){
    btnCalc.addEventListener("click", calcInvoiceTotals);
  }

  if(form){
    form.addEventListener("submit", (ev)=>{
      ev.preventDefault();
      saveInvoice(false);
    });
  }

  if(btnSave){
    btnSave.addEventListener("click", (ev)=>{
      ev.preventDefault();
      saveInvoice(false);
    });
  }

  if(btnWA){
    btnWA.addEventListener("click", (ev)=>{
      ev.preventDefault();
      saveInvoice(true);
    });
  }
}

async function saveInvoice(openWhatsApp){
  const date   = $("#invDateMobile")?.value || todayStr();
  const number = $("#invNumberMobile")?.value || "";
  const client = $("#invClientMobile")?.value || "";
  const phone  = ($("#invPhoneMobile")?.value || "").replace(/[^\d]/g,"");
  const method = $("#invMethodMobile")?.value || "";
  const note   = $("#invNoteMobile")?.value || "";

  const items = getItemsFromDOM();
  const totals = calcTotals(items);

  if(!date || !number){
    toast("Fecha y número de factura son requeridos");
    return;
  }
  if(!items.length){
    toast("Agrega al menos 1 ítem");
    return;
  }

  const inv = {
    id: Date.now().toString(36),
    date,
    number,
    method,
    client: { name: client, phone },
    items,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    note
  };

  // Registrar como factura
  state.invoices.push(inv);

  // Registrar ingreso asociado
  state.incomesDaily.push({
    id: Date.now().toString(36) + "_inc",
    date,
    client,
    method,
    amount: totals.total,
    invoiceNumber: number
  });

  toast("Factura guardada y registrada en Ingresos");
  saveLocal();

  // Limpiar formulario
  const contItems = $("#invItemsContainer");
  if(contItems) contItems.innerHTML = "";
  $("#formInvoice")?.reset();
  $("#invDateMobile").value = todayStr();
  calcInvoiceTotals();

  // 🔵 Generar PDF y abrirlo en pestaña nueva
  await generateInvoicePDFMobile(inv);

  // WhatsApp (solo texto, igual que antes)
  if(openWhatsApp && phone){
    const msg = `Saludos, aquí el total de su factura #${number}: ${fmt(totals.total)}. Gracias por su confianza.`;
    const urlWA = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(urlWA, "_blank");
  }else if(openWhatsApp){
    toast("No hay teléfono para WhatsApp");
  }
}

/* ===================== Render global ===================== */
function renderAllMobile(){
  renderKPIHomeMobile();
  renderTodayInvoices();
}

/* ===================== INIT ===================== */
function initMobileApp(){
  wireNavigation();
  wireCloudMobile();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();

  // Opcional: podrías forzar que siempre jale desde nube al abrir
  // cloudPullMobile();

  const chk = $("#chkAutosyncMobile");
  if(chk) chk.checked = cloud.autosync;

  renderAllMobile();
}

document.addEventListener("DOMContentLoaded", initMobileApp);
