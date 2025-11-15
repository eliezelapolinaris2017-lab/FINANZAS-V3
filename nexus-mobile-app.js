// nexus-mobile-app.js (reemplaza COMPLETO este archivo)

// ================== Firebase ==================
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
onSnapshot,
serverTimestamp,
enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Usa EXACTAMENTE la misma config que app.js Desktop
const firebaseConfig = {
apiKey: "AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE",
authDomain: "finanzas-web-f4e05.firebaseapp.com",
projectId: "finanzas-web-f4e05",
storageBucket: "finanzas-web-f4e05.firebasestorage.app",
messagingSenderId: "1047152523619",
appId: "1:1047152523619:web:7d8f7d1f7a5ccc6090bb56"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// Persistencia offline (si hay otra pestaña con Firestore es normal el warning)
enableIndexedDbPersistence(db).catch(() => {});

// ================== Estado compartido con Desktop ==================
const DEFAULT_STATE = {
settings: {
businessName: "Mi Negocio",
logoBase64: "",
currency: "USD",
theme: { primary: "#0B0D10", accent: "#C7A24B", text: "#F2F3F5" }
},
expensesDaily: [],
incomesDaily: [],
payments: [],
personal: [],
ordinary: [],
budgets: [],
invoices: [],
quotes: [],
reconciliations: [],
_cloud: { updatedAt: 0 }
};

const LOCAL_KEY = "finanzas-state-v10";

const clone = (o) => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0, 10);

let state = null; // SIEMPRE será la copia del doc de Firestore
let cloudUser = null;
let unsubSnap = null;
let autosync = false;
let pushTimer = null;

// ================== Helpers UI ==================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg) {
const t = $("#toast");
if (!t) { console.log("[toast]", msg); return; }
t.textContent = msg;
t.classList.add("visible");
setTimeout(() => t.classList.remove("visible"), 2200);
}

function fmt(n) {
const cur = state?.settings?.currency || "USD";
const val = Number(n || 0);
try {
return new Intl.NumberFormat("es-PR", { style: "currency", currency: cur }).format(val);
} catch {
return `${cur} ${val.toFixed(2)}`;
}
}

// ================== Cálculos IGUALES a Desktop ==================
const toDate = (s) => new Date(s || "1970-01-01");
function inRange(d, from, to) {
const t = +toDate(d);
if (from && t < +toDate(from)) return false;
if (to && t > (+toDate(to) + 86400000 - 1)) return false;
return true;
}

function sumRange(list, from, to) {
if (!Array.isArray(list)) return 0;
return list.filter(r => inRange(r.date, from, to))
.reduce((a, b) => a + Number(b.amount || 0), 0);
}

function sumExpensesDailySplit(list, from, to) {
let recurrent = 0, nonRec = 0;
const isRec = (e) =>
e.method === "Automático" ||
(e.desc || "").toLowerCase().startsWith("recurrente");
(list || []).filter(e => inRange(e.date, from, to)).forEach(e => {
const amt = Number(e.amount || 0);
if (isRec(e)) recurrent += amt;
else nonRec += amt;
});
return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec };
}

function sumPaymentsRange(list, from, to) {
return (list || []).filter(p => inRange(p.date, from, to))
.reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumPersonalRange(list, from, to) {
return (list || []).filter(p => inRange(p.date, from, to))
.reduce((a, b) => a + Number(b.amount || 0), 0);
}

// ================== Lectura/escritura Firestore ==================
function cloudDocRef() {
if (!cloudUser) return null;
return doc(db, "users", cloudUser.uid, "state", "app");
}

async function pullFromCloud(showToast = true) {
const ref = cloudDocRef();
if (!ref) { toast("Conéctate con Google primero"); return; }

const snap = await getDoc(ref);
if (!snap.exists()) {
state = clone(DEFAULT_STATE);
await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() });
} else {
state = snap.data() || clone(DEFAULT_STATE);
}

// opcional: reflejar en localStorage para backups
try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch (_) {}

applyBrand();
refreshHome();
if (showToast) toast("Datos cargados desde Firebase");
}

async function pushToCloud({ silent = false } = {}) {
const ref = cloudDocRef();
if (!ref) { toast("Conéctate con Google primero"); return; }
if (!state) state = clone(DEFAULT_STATE);

const now = Date.now();
state._cloud = state._cloud || {};
state._cloud.updatedAt = now;

await setDoc(
ref,
{ ...state, _serverUpdatedAt: serverTimestamp() },
{ merge: true }
);

try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch (_) {}
if (!silent) toast("Datos enviados a Firebase");
}

function pushDebounced() {
if (!autosync) return;
clearTimeout(pushTimer);
pushTimer = setTimeout(() => { pushToCloud({ silent: true }); }, 600);
}

function subscribeRealtime() {
const ref = cloudDocRef();
if (!ref) return;
if (unsubSnap) unsubSnap();

unsubSnap = onSnapshot(ref, (snap) => {
if (!snap.exists()) return;
const remote = snap.data();
const rU = remote?._cloud?.updatedAt || 0;
const lU = state?._cloud?.updatedAt || 0;
if (!state || rU > lU) {
state = remote;
try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch (_) {}
applyBrand();
refreshHome();
renderTodayInvoices();
}
});
}

// ================== Branding (logo + nombre) ==================
function applyBrand() {
const name = state?.settings?.businessName || "Nexus Finance";
const logo = state?.settings?.logoBase64 || "assets/logo.png";

const title = $(".brand-title");
const sub = $(".brand-sub");
const img = $(".brand-logo");

if (title) title.textContent = name;
if (sub) sub.textContent = "Panel rápido móvil";
if (img) img.src = logo;
}

// ================== KPI Home (igual que Desktop) ==================
function refreshHome() {
if (!state) return;

const today = todayStr();
const now = new Date();
const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

// HOY
const incToday = sumRange(state.incomesDaily, today, today);
const expTodaySplit = sumExpensesDailySplit(state.expensesDaily, today, today);
const perToday = sumPersonalRange(state.personal, today, today);
const payToday = sumPaymentsRange(state.payments, today, today);
const totalExpToday = expTodaySplit.total + perToday + payToday;

// BALANCE "MES" → usamos MISMA fórmula que Desktop (YTD desde inicio de año)
const incYTD = sumRange(state.incomesDaily, yearStart, today);
const expYTDSplit = sumExpensesDailySplit(state.expensesDaily, yearStart, today);
const perYTD = sumPersonalRange(state.personal, yearStart, today);
const payYTD = sumPaymentsRange(state.payments, yearStart, today);
const totalExpYTD = expYTDSplit.total + perYTD + payYTD;
const balanceYTD = incYTD - totalExpYTD;

const incEl = $("#kpi-income-today");
const expEl = $("#kpi-expenses-today");
const balEl = $("#kpi-balance-today");

if (incEl) incEl.textContent = fmt(incToday);
if (expEl) expEl.textContent = fmt(totalExpToday);
if (balEl) balEl.textContent = fmt(balanceYTD); // este debe coincidir con Desktop
}

// ================== Listado facturas de hoy ==================
function renderTodayInvoices() {
const box = $("#todayInvoices");
if (!box || !state) return;

const today = todayStr();
const list = (state.invoices || []).filter(inv => inv.date === today);

if (!list.length) {
box.className = "list-empty";
box.innerHTML = "No hay facturas registradas hoy.";
return;
}

box.className = "list";
box.innerHTML = "";
list
.slice()
.sort((a, b) => (b.number || "").localeCompare(a.number || ""))
.forEach(inv => {
const row = document.createElement("div");
row.className = "list-row";
row.innerHTML = `
<div class="list-main">
<div class="list-title">${inv.number || "Sin número"}</div>
<div class="list-sub">${(inv.client?.name || "Sin cliente")}</div>
</div>
<div class="list-amount">${fmt(inv.total || 0)}</div>
`;
box.appendChild(row);
});
}

// ================== Navegación simple entre pantallas ==================
function showScreen(id) {
$$(".screen").forEach(s => s.classList.toggle("active", s.id === `screen-${id}`));
}

function wireNavigation() {
$("#btnGoIncome")?.addEventListener("click", () => showScreen("income"));
$("#btnGoExpense")?.addEventListener("click", () => showScreen("expense"));
$("#btnGoInvoice")?.addEventListener("click", () => showScreen("invoice"));

$$(".btn-back[data-back]").forEach(btn => {
btn.addEventListener("click", () => showScreen(btn.dataset.back));
});
}

// ================== Formularios: Ingreso / Gasto ==================
function uid() {
return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function wireQuickIncome() {
const form = $("#formIncome");
if (!form) return;

$("#incDateMobile").value = todayStr();

form.addEventListener("submit", async (ev) => {
ev.preventDefault();
if (!state) state = clone(DEFAULT_STATE);

const rec = {
id: uid(),
date: $("#incDateMobile").value || todayStr(),
client: $("#incClientMobile").value || "",
method: $("#incMethodMobile").value || "Efectivo",
amount: Number($("#incAmountMobile").value || 0)
};
if (!rec.date) {
toast("Fecha requerida");
return;
}
state.incomesDaily = state.incomesDaily || [];
state.incomesDaily.push(rec);

refreshHome();
renderTodayInvoices();
pushDebounced();

form.reset();
$("#incDateMobile").value = todayStr();
toast("Ingreso guardado");
showScreen("home");
});
}

function wireQuickExpense() {
const form = $("#formExpense");
if (!form) return;

$("#expDateMobile").value = todayStr();

form.addEventListener("submit", (ev) => {
ev.preventDefault();
if (!state) state = clone(DEFAULT_STATE);

const rec = {
id: uid(),
date: $("#expDateMobile").value || todayStr(),
category: $("#expCategoryMobile").value || "",
method: $("#expMethodMobile").value || "Efectivo",
amount: Number($("#expAmountMobile").value || 0),
desc: $("#expCategoryMobile").value || ""
};
if (!rec.date) {
toast("Fecha requerida");
return;
}
state.expensesDaily = state.expensesDaily || [];
state.expensesDaily.push(rec);

refreshHome();
pushDebounced();

form.reset();
$("#expDateMobile").value = todayStr();
toast("Gasto guardado");
showScreen("home");
});
}

// ================== Facturas: items + guardar + WhatsApp ==================
function addItemRow() {
const cont = $("#invItemsContainer");
if (!cont) return;
const row = document.createElement("div");
row.className = "item-row";
row.innerHTML = `
<input type="text" class="item-desc" placeholder="Descripción">
<input type="number" step="0.01" class="item-qty" placeholder="Cant." value="1">
<input type="number" step="0.01" class="item-price" placeholder="Precio" value="0">
<input type="number" step="0.01" class="item-tax" placeholder="% Imp" value="0">
<button type="button" class="btn-outline btn-small btn-del-item">✕</button>
`;
row.querySelector(".btn-del-item").addEventListener("click", () => row.remove());
cont.appendChild(row);
}

function readItems() {
const cont = $("#invItemsContainer");
if (!cont) return [];
const items = [];
cont.querySelectorAll(".item-row").forEach(row => {
const desc = row.querySelector(".item-desc")?.value || "";
const qty = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
const price = parseFloat(row.querySelector(".item-price")?.value || "0") || 0;
const tax = parseFloat(row.querySelector(".item-tax")?.value || "0") || 0;
items.push({ id: uid(), desc, qty, price, tax });
});
return items;
}

function calcTotals(items) {
let subtotal = 0, taxTotal = 0;
items.forEach(it => {
const base = (it.qty || 0) * (it.price || 0);
const tx = base * ((it.tax || 0) / 100);
subtotal += base;
taxTotal += tx;
});
return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function updateInvoiceTotals() {
const items = readItems();
const t = calcTotals(items);
$("#invSubtotalMobile").textContent = t.subtotal ? fmt(t.subtotal) : "—";
$("#invTaxMobile").textContent = t.taxTotal ? fmt(t.taxTotal) : "—";
$("#invTotalMobile").textContent = t.total ? fmt(t.total) : "—";
}

// jsPDF para factura individual (similar a Desktop, simplificado)
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

async function generateInvoicePDF(inv) {
await ensureJsPDF();
const { jsPDF } = window.jspdf;
const doc = new jsPDF({ unit: "mm", format: "a4" });

const business = state?.settings?.businessName || "Mi Negocio";
const logo = state?.settings?.logoBase64;

try {
if (logo && logo.startsWith("data:")) {
doc.addImage(logo, "PNG", 14, 10, 24, 24);
}
} catch (_) {}

doc.setFont("helvetica", "bold");
doc.setFontSize(16);
doc.text(business, 42, 18);
doc.setFontSize(12);
doc.text("FACTURA", 42, 26);
doc.line(14, 36, 200, 36);

let y = 42;
doc.setFontSize(10);
doc.text("Cliente:", 14, y); y += 6;
doc.setFont("helvetica", "normal");
if (inv.client?.name) { doc.text(inv.client.name, 14, y); y += 6; }
if (inv.client?.phone) { doc.text(inv.client.phone, 14, y); y += 6; }
if (inv.client?.address){ doc.text(inv.client.address, 14, y); y += 6; }

let ry = 42;
doc.setFont("helvetica", "bold");
doc.text("Factura #", 130, ry);
doc.setFont("helvetica", "normal");
doc.text(String(inv.number || ""), 196, ry, { align: "right" }); ry += 6;
doc.setFont("helvetica", "bold");
doc.text("Fecha", 130, ry);
doc.setFont("helvetica", "normal");
doc.text(String(inv.date || ""), 196, ry, { align: "right" }); ry += 6;

y = Math.max(y, 74);
doc.line(14, y, 200, y); y += 6;

const headers = ["Descripción", "Cant.", "Precio", "Imp %", "Importe"];
const colW = [90, 20, 30, 20, 20];
doc.setFont("helvetica", "bold");
let x = 14;
headers.forEach((h, i) => { doc.text(h, x, y); x += colW[i]; });
y += 6; doc.line(14, y, 200, y); y += 6;
doc.setFont("helvetica", "normal");

inv.items.forEach(it => {
x = 14;
const base = (it.qty || 0) * (it.price || 0);
const tx = base * ((it.tax || 0) / 100);
const amt = base + tx;
const row = [
String(it.desc || "").slice(0, 60),
String(it.qty || 0),
(it.price || 0).toFixed(2),
String(it.tax || 0),
amt.toFixed(2)
];
row.forEach((c, i) => { doc.text(c, x, y); x += colW[i]; });
y += 6;
if (y > 260) { doc.addPage(); y = 20; }
});

if (y + 30 > 290) { doc.addPage(); y = 20; }
y += 4; doc.line(120, y, 200, y); y += 6;

doc.setFont("helvetica", "bold");
doc.text("Subtotal", 150, y);
doc.setFont("helvetica", "normal");
doc.text(fmt(inv.subtotal || 0), 198, y, { align: "right" }); y += 6;

doc.setFont("helvetica", "bold");
doc.text("Impuestos", 150, y);
doc.setFont("helvetica", "normal");
doc.text(fmt(inv.taxTotal || 0), 198, y, { align: "right" }); y += 6;

doc.setFont("helvetica", "bold");
doc.text("TOTAL", 150, y);
doc.setFont("helvetica", "bold");
doc.text(fmt(inv.total || 0), 198, y, { align: "right" }); y += 10;

if (inv.note) {
doc.setFont("helvetica", "bold");
doc.text("Nota:", 14, y);
doc.setFont("helvetica", "normal");
doc.text(String(inv.note).slice(0, 240), 14, y + 6);
}

const fileName = `${(business || "Negocio").replace(/\s+/g, "_")}_Factura_${inv.number || ""}.pdf`;
doc.save(fileName);
}

function buildInvoiceFromForm() {
if (!state) state = clone(DEFAULT_STATE);

const date = $("#invDateMobile").value || todayStr();
const number = $("#invNumberMobile").value || "";
const clientName = $("#invClientMobile").value || "";
const phone = $("#invPhoneMobile").value || "";
const method = $("#invMethodMobile").value || "Efectivo";
const note = $("#invNoteMobile").value || "";
const items = readItems();
const totals = calcTotals(items);

if (!date || !number) {
toast("Fecha y número de factura son requeridos");
return null;
}

const inv = {
id: uid(),
date,
dueDate: "",
number,
method,
client: { name: clientName, phone, email: "", address: "" },
items,
subtotal: totals.subtotal,
taxTotal: totals.taxTotal,
total: totals.total,
note,
terms: ""
};

// Igual que Desktop: registramos ingreso vinculado a la factura
const income = {
id: uid(),
date,
client: clientName,
method,
amount: totals.total,
invoiceNumber: number
};

state.incomesDaily = state.incomesDaily || [];
state.invoices = state.invoices || [];

state.incomesDaily.push(income);
inv.incomeId = income.id;
state.invoices.push(inv);

return inv;
}

function resetInvoiceForm() {
$("#formInvoice")?.reset();
$("#invDateMobile").value = todayStr();
$("#invItemsContainer").innerHTML = "";
addItemRow();
$("#invSubtotalMobile").textContent = "—";
$("#invTaxMobile").textContent = "—";
$("#invTotalMobile").textContent = "—";
}

function wireInvoice() {
$("#invDateMobile").value = todayStr();
addItemRow();

$("#btnAddItem")?.addEventListener("click", () => addItemRow());
$("#btnCalcInvoice")?.addEventListener("click", () => updateInvoiceTotals());

$("#formInvoice")?.addEventListener("submit", async (ev) => {
ev.preventDefault();
const inv = buildInvoiceFromForm();
if (!inv) return;

updateInvoiceTotals();
refreshHome();
renderTodayInvoices();
pushDebounced();
toast("Factura guardada");
resetInvoiceForm();
showScreen("home");
});

$("#btnSaveInvoiceWhatsApp")?.addEventListener("click", async () => {
const inv = buildInvoiceFromForm();
if (!inv) return;

updateInvoiceTotals();
refreshHome();
renderTodayInvoices();
await pushToCloud({ silent: true });

const phoneRaw = $("#invPhoneMobile").value || "";
const phone = phoneRaw.replace(/[^\d]/g, "");
const business = state?.settings?.businessName || "Mi negocio";

const msg = [
`Hola ${inv.client?.name || ""},`,
`te envío el detalle de la factura ${inv.number} de ${business}.`,
`Monto total: ${fmt(inv.total)}.`,
"",
"Gracias por tu pago."
].join("\n");

if (phone) {
const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
window.open(url, "_blank");
} else {
toast("Factura guardada. No hay teléfono para WhatsApp.");
}

resetInvoiceForm();
showScreen("home");
});
}

// ================== Firebase UI móvil ==================
function wireCloudUI() {
const provider = new GoogleAuthProvider();

const signInBtn = $("#btnSignInMobile");
const signOutBtn = $("#btnSignOutMobile");
const pullBtn = $("#btnSyncPullMobile");
const pushBtn = $("#btnSyncPushMobile");
const statusEl = $("#syncStatusMobile");
const autoChk = $("#chkAutosyncMobile");

const refreshCloudUI = () => {
if (cloudUser) {
if (signInBtn) signInBtn.style.display = "none";
if (signOutBtn) signOutBtn.style.display = "block";
if (statusEl) statusEl.textContent = `Conectado como ${cloudUser.displayName || cloudUser.email || cloudUser.uid}`;
} else {
if (signInBtn) signInBtn.style.display = "block";
if (signOutBtn) signOutBtn.style.display = "none";
if (statusEl) statusEl.textContent = "Sin conexión";
}
if (autoChk) autoChk.checked = autosync;
};

signInBtn?.addEventListener("click", async () => {
try {
await signInWithPopup(auth, provider);
} catch (e) {
// Safari iOS a veces bloquea popup → usamos redirect
await signInWithRedirect(auth, provider);
}
});

signOutBtn?.addEventListener("click", async () => {
await signOut(auth);
});

pullBtn?.addEventListener("click", () => pullFromCloud(true));
pushBtn?.addEventListener("click", () => pushToCloud({ silent: false }));

autoChk?.addEventListener("change", (e) => {
autosync = e.target.checked;
});

onAuthStateChanged(auth, async (user) => {
cloudUser = user || null;
refreshCloudUI();
if (user) {
await getRedirectResult(auth).catch(() => {});
await pullFromCloud(false);
subscribeRealtime();
} else {
// sin login → usamos lo que haya en localStorage SOLO para mostrar algo
try {
const raw = localStorage.getItem(LOCAL_KEY);
state = raw ? JSON.parse(raw) : clone(DEFAULT_STATE);
} catch {
state = clone(DEFAULT_STATE);
}
applyBrand();
refreshHome();
renderTodayInvoices();
if (unsubSnap) { unsubSnap(); unsubSnap = null; }
}
});
}

// ================== Init ==================
function initFromLocal() {
try {
const raw = localStorage.getItem(LOCAL_KEY);
state = raw ? JSON.parse(raw) : clone(DEFAULT_STATE);
} catch {
state = clone(DEFAULT_STATE);
}
applyBrand();
refreshHome();
renderTodayInvoices();
}

function init() {
initFromLocal();
wireNavigation();
wireQuickIncome();
wireQuickExpense();
wireInvoice();
wireCloudUI();
showScreen("home");
}

document.addEventListener("DOMContentLoaded", init);
