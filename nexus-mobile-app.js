/* =========================================================
   Nexus Finance — Panel móvil
   Lee / escribe el MISMO estado que la app Desktop
   usando Firestore + localStorage (finanzas-state-v10)
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot,
  serverTimestamp, enableIndexedDbPersistence
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
enableIndexedDbPersistence(db).catch(()=>{});

/* ===================== Estado / utilidades ===================== */

const STORAGE_KEY    = "finanzas-state-v10";   // MISMO que Desktop
const AUTOSYNC_KEY   = "nf-mobile-autosync";
const CLOUD_FLAG_KEY = "nf-mobile-hasCloud";   // para no subir DEFAULT sin bajar primero

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

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const clone = (o) => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0,10);
const toDate   = (s) => new Date(s);
const inRange  = (d,from,to) => {
  const t = +toDate(d||"1970-01-01");
  if (from && t < +toDate(from)) return false;
  if (to   && t > (+toDate(to)+86400000-1)) return false;
  return true;
};

function loadLocalState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE));
    return clone(DEFAULT_STATE);
  }
  try{
    const st = JSON.parse(raw);
    for(const k of Object.keys(DEFAULT_STATE)){
      if(!(k in st)) st[k] = clone(DEFAULT_STATE[k]);
    }
    return st;
  }catch{
    return clone(DEFAULT_STATE);
  }
}

let state = loadLocalState();
let autosync = JSON.parse(localStorage.getItem(AUTOSYNC_KEY) || "false");
let hasCloudSnapshot = JSON.parse(localStorage.getItem(CLOUD_FLAG_KEY) || "false");
let pushTimer = null;
let cloudUnsub = null;

function saveLocalState({skipCloud=false} = {}){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  if(!skipCloud && autosync && auth.currentUser && hasCloudSnapshot){
    debounceCloudPush();
  }
}

function fmt(n){
  const cur = state?.settings?.currency || "USD";
  const val = Number(n || 0);
  try{
    return new Intl.NumberFormat("es-PR", { style:"currency", currency: cur }).format(val);
  }catch{
    return `${cur} ${val.toFixed(2)}`;
  }
}

function toast(msg){
  const el = $("#toast");
  if(!el){ console.log("[TOAST]", msg); return; }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 2500);
}

/* ===================== Cálculos (igual que Desktop) ===================== */

function sumRange(list, from, to){
  if(!Array.isArray(list)) return 0;
  return list
    .filter(r => inRange(r.date, from, to))
    .reduce((a,b)=> a + Number(b.amount || 0), 0);
}

function sumExpensesDailySplit(from,to){
  let recurrent=0, nonRec=0;
  const isRec = (e) =>
    (e.method === "Automático") ||
    ((e.desc || "").toLowerCase().startsWith("recurrente"));
  state.expensesDaily
    .filter(e => inRange(e.date, from, to))
    .forEach(e=>{
      const amt = Number(e.amount || 0);
      if(isRec(e)) recurrent += amt;
      else nonRec += amt;
    });
  return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec };
}

const sumPaymentsRange = (from,to)=>
  state.payments.filter(p=>inRange(p.date,from,to))
    .reduce((a,b)=>a+Number(b.amount||0),0);

const sumPersonalRange = (from,to)=>
  state.personal.filter(p=>inRange(p.date,from,to))
    .reduce((a,b)=>a+Number(b.amount||0),0);

/* ===================== Dashboard móvil ===================== */

function renderKPIs(){
  const now  = new Date();
  const today = now.toISOString().slice(0,10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
                      .toISOString().slice(0,10);

  // Ingresos / Gastos de HOY
  const incToday = sumRange(state.incomesDaily, today, today);
  const expTodaySplit = sumExpensesDailySplit(today,today);
  const perToday = sumPersonalRange(today,today);
  const payToday = sumPaymentsRange(today,today);
  const expToday = expTodaySplit.total + perToday + payToday;

  // Balance del MES (igual que Desktop)
  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const expMonth = expMonthSplit.total + perMonth + payMonth;
  const balanceMonth = incMonth - expMonth;

  $("#kpi-income-today").textContent   = fmt(incToday);
  $("#kpi-expenses-today").textContent = fmt(expToday);
  $("#kpi-balance-today").textContent  = fmt(balanceMonth);

  // Branding (nombre + logo) desde state.settings
  const brandTitle = $(".brand-title");
  const brandSub   = $(".brand-sub");
  const logoImg    = $(".brand-logo");
  if(brandTitle) brandTitle.textContent = state.settings.businessName || "Nexus Finance";
  if(brandSub)   brandSub.textContent   = "Panel rápido móvil";
  const FALLBACK_LOGO = "assets/logo.png";
  if(logoImg) logoImg.src = state.settings.logoBase64 || FALLBACK_LOGO;
}

function renderTodayInvoices(){
  const wrap = $("#todayInvoices");
  if(!wrap) return;
  const today = todayStr();
  const list = state.invoices
    .filter(inv => inv.date === today)
    .sort((a,b)=> (a.number || "").localeCompare(b.number || ""));

  if(!list.length){
    wrap.className = "list-empty";
    wrap.textContent = "No hay facturas registradas hoy.";
    return;
  }

  wrap.className = "list";
  wrap.innerHTML = "";
  list.forEach(inv=>{
    const div = document.createElement("div");
    div.className = "invoice-row";
    div.innerHTML = `
      <div class="invoice-main">
        <span class="inv-number">${inv.number || "—"}</span>
        <span class="inv-client">${inv.client?.name || "Sin cliente"}</span>
      </div>
      <div class="invoice-amount">${fmt(inv.total || 0)}</div>
    `;
    wrap.appendChild(div);
  });
}

function renderAll(){
  renderKPIs();
  renderTodayInvoices();
}

/* ===================== Navegación simple ===================== */

function showScreen(id){
  $$(".screen").forEach(s=>{
    s.classList.toggle("active", s.id === id);
  });
}

function wireNavigation(){
  $("#btnGoIncome")?.addEventListener("click", ()=> showScreen("screen-income"));
  $("#btnGoExpense")?.addEventListener("click", ()=> showScreen("screen-expense"));
  $("#btnGoInvoice")?.addEventListener("click", ()=> {
    resetInvoiceForm();
    showScreen("screen-invoice");
  });
  $$(".btn-back[data-back]").forEach(btn=>{
    btn.addEventListener("click", ()=> showScreen("screen-home"));
  });
}

/* ===================== Formulario: Ingreso rápido ===================== */

function wireIncomeForm(){
  const form = $("#formIncome");
  if(!form) return;
  $("#incDateMobile").value = todayStr();

  form.addEventListener("submit", ev=>{
    ev.preventDefault();
    const rec = {
      id: String(Math.random().toString(36).slice(2)) + Date.now().toString(36),
      date:   $("#incDateMobile").value || todayStr(),
      client: $("#incClientMobile").value || "",
      method: $("#incMethodMobile").value || "Efectivo",
      amount: Number($("#incAmountMobile").value || 0)
    };
    if(!rec.date) { toast("Fecha requerida"); return; }
    state.incomesDaily.push(rec);
    saveLocalState();
    form.reset();
    $("#incDateMobile").value = todayStr();
    toast("Ingreso guardado");
    showScreen("screen-home");
  });
}

/* ===================== Formulario: Gasto rápido ===================== */

function wireExpenseForm(){
  const form = $("#formExpense");
  if(!form) return;
  $("#expDateMobile").value = todayStr();

  form.addEventListener("submit", ev=>{
    ev.preventDefault();
    const rec = {
      id: String(Math.random().toString(36).slice(2)) + Date.now().toString(36),
      date:     $("#expDateMobile").value || todayStr(),
      category: $("#expCategoryMobile").value || "",
      desc:     $("#expCategoryMobile").value || "",
      method:   $("#expMethodMobile").value || "Efectivo",
      amount:   Number($("#expAmountMobile").value || 0),
      note:     ""
    };
    if(!rec.date) { toast("Fecha requerida"); return; }
    state.expensesDaily.push(rec);
    saveLocalState();
    form.reset();
    $("#expDateMobile").value = todayStr();
    toast("Gasto guardado");
    showScreen("screen-home");
  });
}

/* ===================== Factura: ítems + totales ===================== */

function addItemRow(){
  const cont = $("#invItemsContainer");
  if(!cont) return;
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input type="text"  class="item-desc"  placeholder="Descripción">
    <input type="number" step="0.01" class="item-qty"   value="1">
    <input type="number" step="0.01" class="item-price" value="0">
    <input type="number" step="0.01" class="item-tax"   value="0">
    <button type="button" class="btn-outline btn-small btn-del-item">✕</button>
  `;
  cont.appendChild(row);
  row.querySelector(".btn-del-item").addEventListener("click", ()=> row.remove());
}

function getItemsFromForm(){
  const items = [];
  $$(".item-row").forEach(row=>{
    const desc  = row.querySelector(".item-desc")?.value || "";
    const qty   = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
    const price = parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
    const tax   = parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;
    items.push({
      id: Math.random().toString(36).slice(2,7),
      desc, qty, price, tax
    });
  });
  return items;
}

function calcTotals(items){
  let subtotal=0, taxTotal=0;
  items.forEach(it=>{
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0) / 100);
    subtotal += base;
    taxTotal += tax;
  });
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function updateInvoiceTotals(){
  const items = getItemsFromForm();
  const t = calcTotals(items);
  $("#invSubtotalMobile").textContent = items.length ? fmt(t.subtotal) : "—";
  $("#invTaxMobile").textContent      = items.length ? fmt(t.taxTotal) : "—";
  $("#invTotalMobile").textContent    = items.length ? fmt(t.total) : "—";
}

function resetInvoiceForm(){
  $("#formInvoice")?.reset();
  $("#invDateMobile").value = todayStr();
  const cont = $("#invItemsContainer");
  if(cont) cont.innerHTML = "";
  addItemRow();
  updateInvoiceTotals();
}

/* ===================== Guardar factura + WhatsApp ===================== */

function buildInvoiceFromForm(){
  const items = getItemsFromForm();
  const t = calcTotals(items);

  const inv = {
    id: String(Math.random().toString(36).slice(2)) + Date.now().toString(36),
    date:   $("#invDateMobile").value || todayStr(),
    dueDate: "",
    number: $("#invNumberMobile").value || "",
    method: $("#invMethodMobile").value || "Efectivo",
    client: {
      name:    $("#invClientMobile").value || "",
      email:   "",
      phone:   $("#invPhoneMobile").value || "",
      address: ""
    },
    items,
    subtotal: t.subtotal,
    taxTotal: t.taxTotal,
    total:    t.total,
    note:  $("#invNoteMobile").value || "",
    terms: ""
  };
  return { inv, totals: t };
}

function createIncomeFromInvoice(inv){
  return {
    id: String(Math.random().toString(36).slice(2)) + Date.now().toString(36),
    date:   inv.date,
    client: inv.client?.name || "",
    method: inv.method || "Efectivo",
    amount: inv.total,
    invoiceNumber: inv.number
  };
}

function openWhatsAppForInvoice(inv){
  const rawPhone = ($("#invPhoneMobile").value || "").replace(/[^\d]/g,"");
  if(!rawPhone){
    toast("Escribe un teléfono para WhatsApp");
    return;
  }
  const msgLines = [
    `Hola ${inv.client?.name || ""}`,
    `Te comparto el resumen de tu factura #${inv.number || ""}`,
    `Fecha: ${inv.date || ""}`,
    `Total: ${fmt(inv.total || 0)}`,
    "",
    "Gracias por tu preferencia."
  ];
  const url = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msgLines.join("\n"))}`;
  window.open(url, "_blank");
}

/* ===== jsPDF para exportar factura ===== */

let jsPDFReady = false;
async function ensureJsPDF(){
  if(jsPDFReady) return;
  await new Promise((res,rej)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  jsPDFReady = true;
}

async function exportInvoicePDF(inv){
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;
  const docPDF = new jsPDF({ unit:"mm", format:"a4" });

  const business = state.settings.businessName || "Mi Negocio";
  const logo = state.settings.logoBase64;

  function header(){
    try{
      if(logo && logo.startsWith("data:")){
        docPDF.addImage(logo,"PNG",14,10,24,24);
      }
    }catch{}
    docPDF.setFont("helvetica","bold");
    docPDF.setFontSize(16);
    docPDF.text(business, 42, 18);
    docPDF.setFontSize(12);
    docPDF.text("FACTURA", 42, 26);
    docPDF.line(14,36,200,36);
  }

  header();
  let y = 42;

  docPDF.setFont("helvetica","bold");
  docPDF.setFontSize(10);
  docPDF.text("Para:",14,y); y+=6;
  docPDF.setFont("helvetica","normal");
  if(inv.client?.name)   { docPDF.text(String(inv.client.name),14,y); y+=6; }
  if(inv.client?.phone)  { docPDF.text(String(inv.client.phone),14,y); y+=6; }

  let ry=42, rx=200;
  docPDF.setFont("helvetica","bold");
  docPDF.text("Factura #", rx-70, ry);
  docPDF.setFont("helvetica","normal");
  docPDF.text(String(inv.number||""), rx-20, ry, {align:"right"}); ry+=6;

  docPDF.setFont("helvetica","bold");
  docPDF.text("Fecha", rx-70, ry);
  docPDF.setFont("helvetica","normal");
  docPDF.text(String(inv.date||""), rx-20, ry, {align:"right"}); ry+=6;

  y = Math.max(y, 74);
  docPDF.line(14,y,200,y); y+=6;

  const headers = ["Descripción","Cant.","Precio","Imp %","Importe"];
  const colW    = [90,20,30,20,20];
  docPDF.setFont("helvetica","bold");
  let x = 14;
  headers.forEach((h,i)=>{ docPDF.text(h,x,y); x+=colW[i]; });
  y+=6; docPDF.line(14,y,200,y); y+=6;
  docPDF.setFont("helvetica","normal");

  inv.items.forEach(it=>{
    x = 14;
    const base=(it.qty||0)*(it.price||0);
    const tax = base*((it.tax||0)/100);
    const amt = base+tax;
    const row = [
      it.desc || "",
      String(it.qty || 0),
      Number(it.price||0).toFixed(2),
      String(it.tax || 0),
      amt.toFixed(2)
    ];
    row.forEach((c,i)=>{
      docPDF.text(String(c).slice(0,60), x, y);
      x += colW[i];
    });
    y+=6;
    if(y>260){ docPDF.addPage(); y=20; }
  });

  if(y+30>290){ docPDF.addPage(); y=20; }
  y+=4; docPDF.line(120,y,200,y); y+=6;

  docPDF.setFont("helvetica","bold");
  docPDF.text("Subtotal",150,y);
  docPDF.setFont("helvetica","normal");
  docPDF.text(fmt(inv.subtotal||0),198,y,{align:"right"}); y+=6;

  docPDF.setFont("helvetica","bold");
  docPDF.text("Impuestos",150,y);
  docPDF.setFont("helvetica","normal");
  docPDF.text(fmt(inv.taxTotal||0),198,y,{align:"right"}); y+=6;

  docPDF.setFont("helvetica","bold");
  docPDF.text("TOTAL",150,y);
  docPDF.text(fmt(inv.total||0),198,y,{align:"right"}); y+=10;

  if(inv.note){
    docPDF.setFont("helvetica","bold");
    docPDF.text("Nota:",14,y); y+=6;
    docPDF.setFont("helvetica","normal");
    docPDF.text(String(inv.note).slice(0,240),14,y);
  }

  const fileName = `${(business||"Negocio").replace(/\s+/g,"_")}_Factura_${inv.number||""}.pdf`;
  docPDF.save(fileName);
}

/* ===================== Wire factura ===================== */

function wireInvoiceForm(){
  const form = $("#formInvoice");
  if(!form) return;
  $("#invDateMobile").value = todayStr();
  addItemRow();
  updateInvoiceTotals();

  $("#btnAddItem")?.addEventListener("click", ()=>{
    addItemRow();
  });

  $("#btnCalcInvoice")?.addEventListener("click", ()=>{
    updateInvoiceTotals();
    toast("Totales actualizados");
  });

  form.addEventListener("input", (ev)=>{
    if(ev.target.matches(".item-desc,.item-qty,.item-price,.item-tax")){
      updateInvoiceTotals();
    }
  });

  // Guardar factura
  $("#btnSaveInvoice")?.addEventListener("click", (ev)=>{
    ev.preventDefault();
    const { inv } = buildInvoiceFromForm();
    if(!inv.date || !inv.number){
      toast("Fecha y número de factura son requeridos");
      return;
    }
    const income = createIncomeFromInvoice(inv);
    inv.incomeId = income.id;

    state.incomesDaily.push(income);
    state.invoices.push(inv);
    saveLocalState();
    exportInvoicePDF(inv); // mismo PDF que Desktop
    toast("Factura guardada");
    resetInvoiceForm();
    showScreen("screen-home");
  });

  // Guardar + WhatsApp
  $("#btnSaveInvoiceWhatsApp")?.addEventListener("click", async (ev)=>{
    ev.preventDefault();
    const { inv } = buildInvoiceFromForm();
    if(!inv.date || !inv.number){
      toast("Fecha y número de factura son requeridos");
      return;
    }
    const income = createIncomeFromInvoice(inv);
    inv.incomeId = income.id;
    state.incomesDaily.push(income);
    state.invoices.push(inv);
    saveLocalState();
    await exportInvoicePDF(inv); // guarda PDF
    openWhatsAppForInvoice(inv); // abre WhatsApp con resumen
    toast("Factura guardada");
    resetInvoiceForm();
    showScreen("screen-home");
  });

  // Submit directo del form (por si el usuario toca Enter)
  form.addEventListener("submit", (ev)=>{
    ev.preventDefault();
    $("#btnSaveInvoice").click();
  });
}

/* ===================== Firebase Cloud Sync (móvil) ===================== */

const provider = new GoogleAuthProvider();

function docRefForUser(user){
  if(!user) return null;
  return doc(db, "users", user.uid, "state", "app");
}

function updateSyncUI(user){
  const status = $("#syncStatusMobile");
  const btnIn  = $("#btnSignInMobile");
  const btnOut = $("#btnSignOutMobile");
  const chk    = $("#chkAutosyncMobile");

  if(user){
    if(status) status.textContent = `Conectado como ${user.displayName || user.email || user.uid}`;
    if(btnIn)  btnIn.style.display  = "none";
    if(btnOut) btnOut.style.display = "inline-block";
  }else{
    if(status) status.textContent = "Sin conexión";
    if(btnIn)  btnIn.style.display  = "inline-block";
    if(btnOut) btnOut.style.display = "none";
  }
  if(chk) chk.checked = !!autosync;
}

async function cloudPullMobile(replace = true){
  const user = auth.currentUser;
  if(!user){ toast("Conéctate con Google primero"); return; }
  const ref = docRefForUser(user);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    toast("No hay datos en la nube para esta cuenta");
    return;
  }
  const remote = snap.data();
  const rU = remote?._cloud?.updatedAt || 0;
  const lU = state?._cloud?.updatedAt || 0;

  if(replace || rU >= lU){
    state = remote;
  }else{
    // Fusión sencilla: mismos campos que Desktop
    state.settings = Object.assign({}, state.settings, remote.settings || {});
    [
      "expensesDaily","incomesDaily","payments","ordinary",
      "budgets","personal","invoices","quotes","reconciliations"
    ].forEach(k=>{
      if(Array.isArray(remote[k])) state[k] = state[k].concat(remote[k]);
    });
    state._cloud = state._cloud || {};
    state._cloud.updatedAt = Math.max(rU, lU);
  }
  hasCloudSnapshot = true;
  localStorage.setItem(CLOUD_FLAG_KEY, "true");
  saveLocalState({skipCloud:true});
  toast("Datos traídos de la nube");
}

async function cloudPushMobile(){
  const user = auth.currentUser;
  if(!user){ toast("Conéctate con Google primero"); return; }
  if(!hasCloudSnapshot){
    // Protección para NO borrar la base original
    if(!confirm("Aún no has traído datos de la nube en este dispositivo.\n" +
                "¿Estás seguro de subir esta copia y reemplazar el estado remoto?")){
      return;
    }
  }
  const ref = docRefForUser(user);
  state._cloud = state._cloud || {};
  state._cloud.updatedAt = Date.now();
  await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge:true });
  saveLocalState({skipCloud:true});
  toast("Datos enviados a la nube");
}

function debounceCloudPush(){
  clearTimeout(pushTimer);
  pushTimer = setTimeout(()=> {
    cloudPushMobile().catch(err=> console.error("cloudPushMobile", err));
  }, 700);
}

function subscribeCloud(user){
  if(cloudUnsub){ cloudUnsub(); cloudUnsub = null; }
  if(!user) return;
  const ref = docRefForUser(user);
  cloudUnsub = onSnapshot(ref, snap=>{
    if(!snap.exists()) return;
    const remote = snap.data();
    const rU = remote?._cloud?.updatedAt || 0;
    const lU = state?._cloud?.updatedAt || 0;
    if(rU > lU){
      state = remote;
      hasCloudSnapshot = true;
      localStorage.setItem(CLOUD_FLAG_KEY,"true");
      saveLocalState({skipCloud:true});
      toast("Actualizado desde la nube");
    }
  });
}

function wireCloudUI(){
  $("#btnSignInMobile")?.addEventListener("click", async ()=>{
    try{
      await signInWithPopup(auth, provider);
    }catch(e){
      console.error(e);
      toast("Error al conectar con Google");
    }
  });
  $("#btnSignOutMobile")?.addEventListener("click", async ()=>{
    try{
      await signOut(auth);
      hasCloudSnapshot = false;
      localStorage.setItem(CLOUD_FLAG_KEY,"false");
      updateSyncUI(null);
      toast("Sesión cerrada");
    }catch(e){
      console.error(e);
      toast("Error al cerrar sesión");
    }
  });
  $("#btnSyncPullMobile")?.addEventListener("click", ()=>{
    cloudPullMobile(true).catch(err=>{
      console.error(err);
      toast("Error al traer datos de la nube");
    });
  });
  $("#btnSyncPushMobile")?.addEventListener("click", ()=>{
    cloudPushMobile().catch(err=>{
      console.error(err);
      toast("Error al enviar datos a la nube");
    });
  });
  $("#chkAutosyncMobile")?.addEventListener("change", (ev)=>{
    autosync = !!ev.target.checked;
    localStorage.setItem(AUTOSYNC_KEY, JSON.stringify(autosync));
    updateSyncUI(auth.currentUser);
  });

  onAuthStateChanged(auth, (user)=>{
    updateSyncUI(user);
    subscribeCloud(user);
  });
}

/* ===================== Arranque ===================== */

document.addEventListener("DOMContentLoaded", ()=>{
  wireNavigation();
  wireIncomeForm();
  wireExpenseForm();
  wireInvoiceForm();
  wireCloudUI();
  renderAll();
});
