// =========================================================
// Nexus Finance MÓVIL
// - Comparte estado con Desktop (finanzas-state-v10)
// - Crea facturas y exporta PDF con jsPDF igual que Desktop
// - Opcional: abre WhatsApp con resumen de la factura
// =========================================================

const STORAGE_KEY = 'finanzas-state-v10';

const DEFAULT_STATE = {
  settings: {
    businessName: 'Mi Negocio',
    logoBase64: '',
    theme: { primary: '#0B0D10', accent: '#C7A24B', text: '#F2F3F5' },
    pinHash: '',
    currency: 'USD'
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

// ------------- Helpers básicos -------------
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const todayStr = () => new Date().toISOString().slice(0,10);
const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const st = JSON.parse(raw);
    for (const k of Object.keys(DEFAULT_STATE)) {
      if (!(k in st)) st[k] = structuredClone(DEFAULT_STATE[k]);
    }
    return st;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // no tocamos nada de Firebase aquí, Desktop se encarga si tienes AutoSync
}

function fmt(n) {
  const cur = state.settings?.currency || 'USD';
  const val = Number(n || 0);
  try {
    return new Intl.NumberFormat('es-PR', {
      style: 'currency',
      currency: cur
    }).format(val);
  } catch {
    return `${cur} ${val.toFixed(2)}`;
  }
}

function toast(msg) {
  const t = $('#toast');
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2200);
}

// ------------- Navegación simple de pantallas -------------
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`#screen-${id}`);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ------------- KPI de hoy + facturas de hoy -------------
function recalcToday() {
  const today = todayStr();

  const incToday = state.incomesDaily
    .filter(r => r.date === today)
    .reduce((a,b) => a + Number(b.amount || 0), 0);

  const expToday = state.expensesDaily
    .filter(r => r.date === today)
    .reduce((a,b) => a + Number(b.amount || 0), 0);

  const balanceToday = incToday - expToday;

  if ($('#kpi-income-today'))  $('#kpi-income-today').textContent  = fmt(incToday);
  if ($('#kpi-expenses-today'))$('#kpi-expenses-today').textContent= fmt(expToday);
  if ($('#kpi-balance-today')) $('#kpi-balance-today').textContent = fmt(balanceToday);

  // Lista de facturas de HOY
  const cont = $('#todayInvoices');
  if (!cont) return;

  const todaysInv = state.invoices.filter(inv => inv.date === today);
  if (!todaysInv.length) {
    cont.className = 'list-empty';
    cont.textContent = 'No hay facturas registradas hoy.';
    return;
  }

  cont.className = '';
  cont.innerHTML = '';
  todaysInv
    .slice()
    .sort((a,b) => (a.number || '').localeCompare(b.number || ''))
    .forEach(inv => {
      const row = document.createElement('div');
      row.className = 'invoice-row';
      row.innerHTML = `
        <div class="invoice-main">
          <strong>${inv.number || '—'}</strong>
          <span>${inv.client?.name || 'Sin cliente'}</span>
        </div>
        <div class="invoice-amount">${fmt(inv.total || 0)}</div>
      `;
      cont.appendChild(row);
    });
}

// =========================================================
// FORMULARIOS: INGRESO Y GASTO RÁPIDO
// =========================================================
function wireQuickIncome() {
  const btnGo = $('#btnGoIncome');
  btnGo?.addEventListener('click', () => {
    $('#incDateMobile').value = todayStr();
    showScreen('income');
  });

  const form = $('#formIncome');
  form?.addEventListener('submit', ev => {
    ev.preventDefault();
    const date   = $('#incDateMobile').value || todayStr();
    const client = $('#incClientMobile').value.trim();
    const method = $('#incMethodMobile').value;
    const amount = parseFloat($('#incAmountMobile').value || '0') || 0;

    if (!amount) return toast('Monto requerido');

    state.incomesDaily.push({
      id: uid(),
      date,
      client,
      method,
      amount
    });
    saveState();
    toast('Ingreso guardado');
    form.reset();
    recalcToday();
    showScreen('home');
  });
}

function wireQuickExpense() {
  const btnGo = $('#btnGoExpense');
  btnGo?.addEventListener('click', () => {
    $('#expDateMobile').value = todayStr();
    showScreen('expense');
  });

  const form = $('#formExpense');
  form?.addEventListener('submit', ev => {
    ev.preventDefault();
    const date     = $('#expDateMobile').value || todayStr();
    const category = $('#expCategoryMobile').value.trim() || 'Gasto';
    const method   = $('#expMethodMobile').value;
    const amount   = parseFloat($('#expAmountMobile').value || '0') || 0;

    if (!amount) return toast('Monto requerido');

    state.expensesDaily.push({
      id: uid(),
      date,
      category,
      desc: category,
      method,
      amount,
      note: ''
    });
    saveState();
    toast('Gasto guardado');
    form.reset();
    recalcToday();
    showScreen('home');
  });
}

// =========================================================
// FACTURA MÓVIL
// =========================================================
function addItemRow() {
  const cont = $('#invItemsContainer');
  if (!cont) return;

  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <div class="item-desc">
      <label>Descripción
        <input type="text" class="item-desc-input" placeholder="Servicio o producto">
      </label>
    </div>
    <div class="item-row-inline">
      <label>Cant.
        <input type="number" step="0.01" class="item-qty-input" value="1">
      </label>
      <label>Precio
        <input type="number" step="0.01" class="item-price-input" value="0">
      </label>
      <label>Imp %
        <input type="number" step="0.01" class="item-tax-input" value="0">
      </label>
      <button type="button" class="btn-remove-item">✕</button>
    </div>
  `;
  cont.appendChild(row);

  row.querySelector('.btn-remove-item').addEventListener('click', () => {
    row.remove();
    calcInvoiceTotalsMobile();
  });

  // Recalcular cuando cambie algo
  ['.item-desc-input','.item-qty-input','.item-price-input','.item-tax-input'].forEach(sel => {
    row.querySelector(sel).addEventListener('input', calcInvoiceTotalsMobile);
  });
}

function readItemsMobile() {
  const cont = $('#invItemsContainer');
  if (!cont) return [];
  const items = [];
  $$('.item-row', cont).forEach(row => {
    const desc = row.querySelector('.item-desc-input')?.value || '';
    const qty  = parseFloat(row.querySelector('.item-qty-input')?.value || '0') || 0;
    const price= parseFloat(row.querySelector('.item-price-input')?.value || '0') || 0;
    const tax  = parseFloat(row.querySelector('.item-tax-input')?.value || '0') || 0;
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

function calcInvoiceTotalsMobile() {
  const items = readItemsMobile();
  const t = calcTotals(items);

  if ($('#invSubtotalMobile'))
    $('#invSubtotalMobile').textContent = items.length ? fmt(t.subtotal) : '—';
  if ($('#invTaxMobile'))
    $('#invTaxMobile').textContent = items.length ? fmt(t.taxTotal) : '—';
  if ($('#invTotalMobile'))
    $('#invTotalMobile').textContent = items.length ? fmt(t.total) : '—';

  return t;
}

// =========================================================
// jsPDF: exportar factura IGUAL que Desktop
// =========================================================
let jsPDFReady = false;

async function ensureJsPDF() {
  if (jsPDFReady) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  jsPDFReady = true;
}

async function exportInvoicePDF(inv) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const business = state.settings.businessName || "Mi Negocio";
  const logo = state.settings.logoBase64;

  function header(title) {
    try {
      if (logo && logo.startsWith('data:')) {
        doc.addImage(logo, 'PNG', 14, 10, 24, 24);
      }
    } catch {}
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.setFontSize(16);
    doc.text(business, 42, 18);
    doc.setFontSize(12);
    doc.text(title, 42, 26);
    doc.line(14, 36, 200, 36);
  }

  function drawInvoiceLike(rec) {
    header('FACTURA');
    doc.setFont("helvetica","normal");
    let y = 42;

    // Cliente
    doc.setFont("helvetica","bold"); doc.setFontSize(10);
    doc.text("Para:", 14, y); y += 6;
    doc.setFont("helvetica","normal");
    if (rec.client?.name)   { doc.text(String(rec.client.name), 14, y); y += 6; }
    if (rec.client?.phone)  { doc.text(String(rec.client.phone),14, y); y += 6; }
    if (rec.client?.address){ doc.text(String(rec.client.address),14, y); y += 6; }

    // Cabecera derecha
    let ry = 42;
    const rx = 200;
    doc.setFont("helvetica","bold");
    doc.text("Factura #", rx-70, ry);
    doc.setFont("helvetica","normal");
    doc.text(String(rec.number || ''), rx-20, ry, { align:'right' });
    ry += 6;

    doc.setFont("helvetica","bold");
    doc.text("Fecha", rx-70, ry);
    doc.setFont("helvetica","normal");
    doc.text(String(rec.date || ''), rx-20, ry, { align:'right' });
    ry += 6;

    y = Math.max(y, 74);
    doc.line(14, y, 200, y);
    y += 6;

    // Encabezado items
    const headers = ["Descripción","Cant.","Precio","Imp %","Importe"];
    const colW = [90,20,30,20,20];
    doc.setFont("helvetica","bold");
    let x = 14;
    headers.forEach((h,i) => {
      doc.text(h, x, y);
      x += colW[i];
    });
    y += 6;
    doc.line(14, y, 200, y);
    y += 6;
    doc.setFont("helvetica","normal");

    rec.items.forEach(it => {
      x = 14;
      const base = (it.qty || 0) * (it.price || 0);
      const tax  = base * ((it.tax || 0)/100);
      const amt  = base + tax;
      const row = [
        it.desc || '',
        String(it.qty || 0),
        Number(it.price || 0).toFixed(2),
        String(it.tax || 0),
        amt.toFixed(2)
      ];
      row.forEach((c,i) => {
        doc.text(String(c).slice(0,60), x, y);
        x += colW[i];
      });
      y += 6;
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
    });

    if (y + 30 > 290) {
      doc.addPage();
      y = 20;
    }
    y += 4;
    doc.line(120, y, 200, y);
    y += 6;

    doc.setFont("helvetica","bold");
    doc.text("Subtotal", 150, y);
    doc.setFont("helvetica","normal");
    doc.text(fmt(rec.subtotal || 0), 198, y, { align:'right' });
    y += 6;

    doc.setFont("helvetica","bold");
    doc.text("Impuestos", 150, y);
    doc.setFont("helvetica","normal");
    doc.text(fmt(rec.taxTotal || 0), 198, y, { align:'right' });
    y += 6;

    doc.setFont("helvetica","bold");
    doc.text("TOTAL", 150, y);
    doc.setFont("helvetica","bold");
    doc.text(fmt(rec.total || 0), 198, y, { align:'right' });
    y += 10;

    if (rec.note) {
      doc.setFont("helvetica","bold");
      doc.text("Nota:", 14, y);
      doc.setFont("helvetica","normal");
      doc.text(String(rec.note).slice(0,240), 14, y+6);
      y += 12;
    }
  }

  drawInvoiceLike(inv);
  const safeName = (state.settings.businessName || 'Negocio').replace(/\s+/g,'_');
  const num = (inv.number || '').toString().replace(/[^\w\-]/g,'');
  doc.save(`${safeName}_Factura_${num || 'sin_numero'}.pdf`);
}

// =========================================================
// WhatsApp: abrir chat con resumen de factura
// =========================================================
function openWhatsAppForInvoice(inv) {
  const phoneRaw = $('#invPhoneMobile').value.trim();
  if (!phoneRaw) {
    toast('No hay teléfono para WhatsApp');
    return;
  }
  const phone = phoneRaw.replace(/[^\d]/g,''); // limpiar
  if (!phone) {
    toast('Teléfono inválido');
    return;
  }

  const lines = [];
  const business = state.settings.businessName || 'Nexus Finance';

  lines.push(`*${business}*`);
  lines.push(`Factura #${inv.number || ''}`);
  lines.push(`Fecha: ${inv.date || ''}`);
  lines.push(`Cliente: ${inv.client?.name || ''}`);
  lines.push(`Total: ${fmt(inv.total || 0)}`);
  lines.push('');
  lines.push('*Detalle:*');
  inv.items.slice(0,5).forEach(it => {
    const base = (it.qty || 0) * (it.price || 0);
    const tax  = base * ((it.tax || 0)/100);
    const amt  = base + tax;
    lines.push(`- ${it.desc || 'Item'} (${it.qty} x ${it.price}) = ${amt.toFixed(2)}`);
  });
  if (inv.items.length > 5) {
    lines.push(`…y ${inv.items.length - 5} ítems más.`);
  }

  const text = encodeURIComponent(lines.join('\n'));
  const url  = `https://wa.me/${phone}?text=${text}`;
  window.open(url, '_blank');
}

// =========================================================
// Guardar factura (normal / con WhatsApp)
// =========================================================
function wireInvoice() {
  $('#btnGoInvoice')?.addEventListener('click', () => {
    $('#invDateMobile').value = todayStr();
    const cont = $('#invItemsContainer');
    if (cont) cont.innerHTML = '';
    addItemRow();
    calcInvoiceTotalsMobile();
    showScreen('invoice');
  });

  $('#btnAddItem')?.addEventListener('click', () => {
    addItemRow();
    calcInvoiceTotalsMobile();
  });

  $('#btnCalcInvoice')?.addEventListener('click', () => {
    calcInvoiceTotalsMobile();
    toast('Totales actualizados');
  });

  // Guardar factura (solo guardar)
  $('#formInvoice')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const inv = buildInvoiceFromForm();
    if (!inv) return; // error ya mostró toast

    // Guardar en estado compartido
    persistInvoice(inv);
    await exportInvoicePDF(inv); // descarga PDF igual que Desktop
    toast('Factura guardada y PDF generado');
    recalcToday();
    showScreen('home');
  });

  // Guardar + WhatsApp
  $('#btnSaveInvoiceWhatsApp')?.addEventListener('click', async () => {
    const inv = buildInvoiceFromForm();
    if (!inv) return;

    persistInvoice(inv);
    await exportInvoicePDF(inv);
    openWhatsAppForInvoice(inv);
    toast('Factura guardada');
    recalcToday();
    showScreen('home');
  });

  // Botones "volver"
  $$('.btn-back').forEach(b => {
    b.addEventListener('click', () => showScreen(b.dataset.back || 'home'));
  });
}

function buildInvoiceFromForm() {
  const date   = $('#invDateMobile').value || todayStr();
  const number = $('#invNumberMobile').value.trim();
  const client = $('#invClientMobile').value.trim();
  const phone  = $('#invPhoneMobile').value.trim();
  const method = $('#invMethodMobile').value;
  const note   = $('#invNoteMobile').value.trim();
  const items  = readItemsMobile();
  const totals = calcTotals(items);

  if (!date || !number) {
    toast('Fecha y número de factura son requeridos');
    return null;
  }
  if (!items.length) {
    toast('Añade al menos un ítem');
    return null;
  }

  const inv = {
    id: uid(),
    date,
    dueDate: '',
    number,
    method,
    client: {
      name: client,
      email: '',
      phone,
      address: ''
    },
    items,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    note,
    terms: ''
  };

  return inv;
}

function persistInvoice(inv) {
  // Crear ingreso vinculado (igual que Desktop)
  const income = {
    id: uid(),
    date: inv.date,
    client: inv.client?.name || '',
    method: inv.method,
    amount: inv.total,
    invoiceNumber: inv.number
  };
  state.incomesDaily.push(income);
  inv.incomeId = income.id;

  state.invoices.push(inv);
  saveState();
}

// =========================================================
// Sincronización MANUAL con Firebase (a través del Desktop)
// (Opcional: estos botones simplemente fuerzan cloudPull/cloudPush
//           si el Desktop ya está manejando Firestore)
// =========================================================

function wireSyncCard() {
  // Estos botones solo sirven como “atajos”.
  // Asumimos que la lógica real de Firebase está en la versión Desktop.
  $('#btnSyncPullMobile')?.addEventListener('click', () => {
    // Releer estado desde localStorage (la Desktop ya debió haber hecho cloudPull)
    state = loadState();
    recalcToday();
    toast('Datos recargados desde el almacenamiento local');
  });

  $('#btnSyncPushMobile')?.addEventListener('click', () => {
    // Guardamos el estado actual → la Desktop (si está abierta y con AutoSync)
    // se encargará de subirlo a Firebase.
    saveState();
    toast('Datos guardados, la versión Desktop puede sincronizar con la nube');
  });

  // Los botones Conectar / Cerrar sesión son “informativos” a menos que
  // quieras replicar TODO el código de Firebase aquí también.
  // Para no romper nada:
  $('#btnSignInMobile')?.addEventListener('click', () => {
    toast('Conéctate en la versión completa de Nexus para gestionar Firebase.');
  });
  $('#btnSignOutMobile')?.addEventListener('click', () => {
    toast('Cierra sesión desde la versión completa de Nexus.');
  });

  // AutoSync mobile: solo indicador visual
  $('#chkAutosyncMobile')?.addEventListener('change', e => {
    const on = e.target.checked;
    const st = $('#syncStatusMobile');
    if (st) st.textContent = on
      ? 'AutoSync activado (usa la versión Desktop para subir a Firebase)'
      : 'AutoSync desactivado';
  });
}

// =========================================================
// INIT
// =========================================================
function init() {
  // Home por defecto
  showScreen('home');
  recalcToday();

  wireQuickIncome();
  wireQuickExpense();
  wireInvoice();
  wireSyncCard();
}

document.addEventListener('DOMContentLoaded', init);
