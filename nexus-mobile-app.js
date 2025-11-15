/* ============================================================
SISTEMA DE SINCRONIZACIÓN OFICIAL PARA PANEL MÓVIL
• Nunca sobrescribe Firebase con vacío
• Siempre lee primero
• Mismo "state" que el Desktop
============================================================ */

let state = null; // <- empieza null, no vacío.
let cloudReady = false; // <- bloquea escritura hasta que se lea firebase
let user = null;
let userDocRef = null;


/* -------------------------------
1. Cargar estado desde Firebase
------------------------------- */

async function pullFromCloud() {
if (!user) return toast("No hay sesión iniciada.");

const snap = await getDoc(userDocRef);

if (!snap.exists()) {
toast("No existe estado en la nube. Debes enviarlo desde Desktop.");
return;
}

const cloudState = snap.data();

// Protección: no aceptamos estados corruptos/vacíos
if (!cloudState || typeof cloudState !== "object") {
toast("Los datos en la nube están dañados.");
return;
}

state = cloudState; // <- Carga oficial
cloudReady = true;

toast("Datos cargados desde la nube.");
renderMobileDashboard();
}


/* -------------------------------
2. Subir estado a Firebase (seguro)
------------------------------- */

async function pushToCloud() {
if (!user) return toast("No hay sesión iniciada.");
if (!cloudReady) return toast("Debes traer datos antes de subir.");

// Protección mayor: NO subir si el state está vacío
if (!state || Object.keys(state).length < 3) {
toast("State incompleto. No se subirá para evitar pérdida.");
return;
}

await setDoc(userDocRef, state, { merge: true });

toast("Datos guardados en Firebase.");
}


/* ----------------------------------------
3. Listener de autenticación
---------------------------------------- */

onAuthStateChanged(auth, async (u) => {
user = u;

if (!user) {
document.querySelector("#syncStatusMobile").textContent = "Sin sesión";
return;
}

userDocRef = doc(db, "users", user.uid, "data", "state");

document.querySelector("#syncStatusMobile").textContent =
"Conectado como " + user.email;

// NO cargamos automáticamente.
// El usuario debe hacer clic en “Traer datos”.
});


/* ----------------------------------------
4. Manejadores de botones en interfaz
---------------------------------------- */

document.querySelector("#btnSyncPullMobile")
?.addEventListener("click", pullFromCloud);

document.querySelector("#btnSyncPushMobile")
?.addEventListener("click", pushToCloud);


/* =================================================
5. Cada vez que se registra un ingreso/gasto/factura
el móvil SÍ puede escribir al state local
y luego sincronizar, pero nunca sobrescribir.
================================================= */

export function saveIncomeMobile(entry) {
if (!cloudReady) return toast("Primero trae datos de la nube.");

state.incomes.push(entry);
recalcTotals();
}

export function saveExpenseMobile(entry) {
if (!cloudReady) return toast("Primero trae datos de la nube.");

state.expenses.push(entry);
recalcTotals();
}

export function saveInvoiceMobile(entry) {
if (!cloudReady) return toast("Primero trae datos de la nube.");

state.invoices.push(entry);
recalcTotals();
}


/* =================================================
6. Calcular KPIs para el panel móvil
================================================= */

function recalcTotals() {
const today = new Date().toISOString().slice(0, 10);

const incomesToday = state.incomes.filter(i => i.date === today);
const expensesToday = state.expenses.filter(e => e.date === today);

const sumIncomesToday = incomesToday.reduce((acc, i) => acc + i.amount, 0);
const sumExpensesToday = expensesToday.reduce((acc, e) => acc + e.amount, 0);

const sumMonthIncomes = state.incomes.reduce((acc, i) => acc + i.amount, 0);
const sumMonthExpenses = state.expenses.reduce((acc, e) => acc + e.amount, 0);

document.querySelector("#kpi-income-today").textContent =
"$" + sumIncomesToday.toFixed(2);

document.querySelector("#kpi-expenses-today").textContent =
"$" + sumExpensesToday.toFixed(2);

document.querySelector("#kpi-balance-today").textContent =
"$" + (sumIncomesToday - sumExpensesToday).toFixed(2);

// El balance hoy ES el balance global real del mes
document.querySelector("#kpi-balance-month").textContent =
"$" + (sumMonthIncomes - sumMonthExpenses).toFixed(2);
}


/* =================================================
7. Render inicial
================================================= */

function renderMobileDashboard() {
if (!state) return;

recalcTotals();

// Facturas de hoy
const today = new Date().toISOString().slice(0, 10);
const todayInvoices = state.invoices.filter(i => i.date === today);

const box = document.querySelector("#todayInvoices");

if (todayInvoices.length === 0) {
box.innerHTML = "No hay facturas registradas hoy.";
return;
}

box.innerHTML = todayInvoices
.map(i => `<div class="invoice-item"><strong>${i.number}</strong> - $${i.total.toFixed(2)}</div>`)
.join("");
}


/* =================================================
8. Toast
================================================= */

function toast(msg) {
const t = document.getElementById("toast");
t.textContent = msg;
t.classList.add("show");
setTimeout(() => t.classList.remove("show"), 2000);
}
