import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE',
  authDomain: 'finanzas-web-f4e05.firebaseapp.com',
  projectId: 'finanzas-web-f4e05',
  storageBucket: 'finanzas-web-f4e05.firebasestorage.app',
  messagingSenderId: '1047152523619',
  appId: '1:1047152523619:web:7d8f7d1f7a5ccc6090bb56'
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STORAGE_KEY = 'nexus-finance-pro-v1';
const AUTO_KEY = 'nexus-finance-autosync';
const SESSION_KEY = 'nexus-finance-session-ok';

const DEFAULT_STATE = {
  settings: {
    businessName: 'Nexus Finance',
    currency: 'USD',
    primary: '#050505',
    accent: '#c7a24b',
    logoBase64: '',
    pinHash: ''
  },
  incomes: [],
  expenses: [],
  invoices: [],
  quotes: [],
  _cloud: { updatedAt: 0 }
};

let state = loadState();
let activeHistory = 'invoices';
let cloudUser = null;
let autoSync = JSON.parse(localStorage.getItem(AUTO_KEY) || 'false');
let pushTimer = null;

const METHODS = ['Efectivo', 'Tarjeta', 'ATH Móvil', 'Transferencia', 'Cheque'];
const CATEGORIES = ['Gasolina', 'Materiales', 'Herramientas', 'Nómina', 'Comida', 'Mantenimiento', 'Renta', 'Servicios', 'Publicidad', 'Impuestos', 'Software', 'Seguros', 'Otros'];

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return clone(DEFAULT_STATE);
    const saved = JSON.parse(raw);
    return {
      ...clone(DEFAULT_STATE),
      ...saved,
      settings: { ...clone(DEFAULT_STATE).settings, ...(saved.settings || {}) }
    };
  }catch{ return clone(DEFAULT_STATE); }
}
function saveState({ skipCloud = false } = {}){
  state._cloud.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  if(!skipCloud && autoSync && cloudUser) debouncePush();
}
function today(){ return new Date().toISOString().slice(0,10); }
function monthBounds(d = new Date()){
  return [new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10), new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10)];
}
function weekStart(){ const d = new Date(); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return d.toISOString().slice(0,10); }
function yearStart(){ const d = new Date(); return new Date(d.getFullYear(),0,1).toISOString().slice(0,10); }
function inRange(date, from, to){ const t = +new Date(date || '1970-01-01'); return (!from || t >= +new Date(from)) && (!to || t <= +new Date(to) + 86399999); }
function money(n){
  try{ return new Intl.NumberFormat('es-PR',{style:'currency',currency:state.settings.currency || 'USD'}).format(Number(n||0)); }
  catch{ return `$${Number(n||0).toFixed(2)}`; }
}
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now(); }
async function hash(text){
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._timer); t._timer = setTimeout(()=>t.classList.remove('show'), 2300); }
function setDefaultDates(){
  ['incomeDate','expenseDate','invoiceDate','quoteDate'].forEach(id => { const el = $('#'+id); if(el && !el.value) el.value = today(); });
  if(!$('#invoiceNumber').value) $('#invoiceNumber').value = nextNumber('FAC', state.invoices);
  if(!$('#quoteNumber').value) $('#quoteNumber').value = nextNumber('COT', state.quotes);
}
function nextNumber(prefix, list){
  const y = new Date().getFullYear();
  const nums = list.map(x => String(x.number||'')).filter(n => n.startsWith(`${prefix}-${y}-`)).map(n => Number(n.split('-').pop()) || 0);
  return `${prefix}-${y}-${String((Math.max(0,...nums)+1)).padStart(4,'0')}`;
}
function fillSelects(){
  const add = (id, arr) => { const el = $('#'+id); if(!el) return; el.innerHTML = arr.map(x=>`<option>${x}</option>`).join(''); };
  ['incomeMethod','expenseMethod','invoiceMethod','quoteMethod'].forEach(id => add(id, METHODS));
  add('expenseCategory', CATEGORIES);
}
function applyTheme(){
  document.documentElement.style.setProperty('--bg', state.settings.primary || '#050505');
  document.documentElement.style.setProperty('--accent', state.settings.accent || '#c7a24b');
  $('#brandName').textContent = state.settings.businessName || 'Nexus Finance';
  $('#setBusinessName').value = state.settings.businessName || '';
  $('#setCurrency').value = state.settings.currency || 'USD';
  $('#setPrimary').value = state.settings.primary || '#050505';
  $('#setAccent').value = state.settings.accent || '#c7a24b';
}

function showView(id){
  $$('.view').forEach(v => v.classList.toggle('visible', v.id === id));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  const titles = { home:'Inicio', income:'Ingresos', expense:'Gastos', invoice:'Facturas', quote:'Cotizaciones', history:'Historial', reports:'Reportes', settings:'Configuración' };
  $('#viewTitle').textContent = titles[id] || 'Nexus Finance';
  $('#sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
}

async function initPin(){
  const locked = $('#lockScreen');
  const app = $('#app');
  if(sessionStorage.getItem(SESSION_KEY) === '1' && state.settings.pinHash){ locked.classList.add('hidden'); app.classList.remove('hidden'); return; }
  locked.classList.remove('hidden'); app.classList.add('hidden');
  const create = !state.settings.pinHash;
  $('#pinConfirm').hidden = !create;
  $('#lockHint').textContent = create ? 'Crea un PIN de 4 a 8 dígitos' : 'Introduce tu PIN para continuar';
  $('#pinInput').focus();
}
function unlock(){ $('#lockScreen').classList.add('hidden'); $('#app').classList.remove('hidden'); sessionStorage.setItem(SESSION_KEY, '1'); }

function sum(list, from, to){ return list.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount || b.total || 0),0); }
function renderHome(){
  const [m1,m2] = monthBounds();
  const income = sum(state.incomes,m1,m2);
  const expense = sum(state.expenses,m1,m2);
  const inv = sum(state.invoices,m1,m2);
  $('#kpiIncome').textContent = money(income);
  $('#kpiExpense').textContent = money(expense);
  $('#kpiBalance').textContent = money(income-expense);
  $('#kpiInvoices').textContent = money(inv);

  const recent = [...state.incomes.map(x=>({...x,type:'Ingreso'})), ...state.expenses.map(x=>({...x,type:'Gasto'}))].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  $('#recentList').innerHTML = recent.length ? recent.map(x => `<div class="item-card"><div><strong>${x.type}</strong><small>${x.date} · ${x.source || x.category || ''}</small></div><b>${money(x.amount)}</b></div>`).join('') : 'Sin movimientos todavía.';
  $('#recentList').classList.toggle('empty', !recent.length);

  const invToday = state.invoices.filter(x => x.date === today());
  $('#todayInvoices').innerHTML = invToday.length ? invToday.map(x => `<div class="item-card"><div><strong>${x.client?.name || 'Cliente'}</strong><small>${x.number} · ${x.method || ''}</small></div><b>${money(x.total)}</b></div>`).join('') : 'No hay facturas registradas hoy.';
  $('#todayInvoices').classList.toggle('empty', !invToday.length);
}
function renderTables(){
  const incBody = $('#incomeTable tbody');
  incBody.innerHTML = state.incomes.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(x=>`<tr><td>${x.date}</td><td>${x.source||''}</td><td>${x.method||''}</td><td>${x.ref||''}</td><td>${money(x.amount)}</td><td><button class="btn ghost" data-del-income="${x.id}">Eliminar</button></td></tr>`).join('');
  $('#incomeTotal').textContent = money(sum(state.incomes));

  const expBody = $('#expenseTable tbody');
  expBody.innerHTML = state.expenses.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(x=>`<tr><td>${x.date}</td><td>${x.category||''}</td><td>${x.desc||''}</td><td>${x.method||''}</td><td>${money(x.amount)}</td><td><button class="btn ghost" data-del-expense="${x.id}">Eliminar</button></td></tr>`).join('');
  $('#expenseTotal').textContent = money(sum(state.expenses));
}
function renderHistory(){
  const q = ($('#historySearch').value || '').toLowerCase();
  const list = activeHistory === 'invoices' ? state.invoices : state.quotes;
  $('#historyTable tbody').innerHTML = list.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).filter(x => `${x.date} ${x.number} ${x.client?.name}`.toLowerCase().includes(q)).map(x=>`<tr><td>${x.date}</td><td>${x.number}</td><td>${x.client?.name||''}</td><td>${money(x.total)}</td><td>${x.status || 'Pendiente'}</td><td><div class="mini-actions"><button class="btn ghost" data-pdf-${activeHistory}="${x.id}">PDF</button>${activeHistory==='invoices'?`<button class="btn ghost" data-paid="${x.id}">Pagada</button>`:''}<button class="btn ghost" data-del-${activeHistory}="${x.id}">Eliminar</button></div></td></tr>`).join('');
}
function renderReports(){
  const todayStr = today();
  const labels = [ ['repToday',todayStr,todayStr], ['repWeek',weekStart(),todayStr], ['repMonth',monthBounds()[0],todayStr], ['repYear',yearStart(),todayStr] ];
  labels.forEach(([id,from,to]) => { const i=sum(state.incomes,from,to), e=sum(state.expenses,from,to); $('#'+id).textContent = `${money(i)} / ${money(e)}`; });
  drawChart();
}
function drawChart(){
  const c = $('#chart'); if(!c) return; const ctx = c.getContext('2d'); const w=c.width=c.clientWidth, h=c.height=180; ctx.clearRect(0,0,w,h);
  const now = new Date(), months=[], inc=[], exp=[];
  for(let i=5;i>=0;i--){ const d = new Date(now.getFullYear(), now.getMonth()-i, 1); const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10); const to = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10); months.push(d.toLocaleDateString('es-ES',{month:'short'})); inc.push(sum(state.incomes,from,to)); exp.push(sum(state.expenses,from,to)); }
  const max = Math.max(1,...inc,...exp); const gap = w / months.length; ctx.font='12px system-ui';
  months.forEach((m,i)=>{ const x=i*gap+18; const hi=(inc[i]/max)*(h-38), he=(exp[i]/max)*(h-38); ctx.fillStyle=state.settings.accent; ctx.fillRect(x,h-24-hi,18,hi); ctx.fillStyle='#666'; ctx.fillRect(x+22,h-24-he,18,he); ctx.fillStyle='#aaa'; ctx.fillText(m,x,h-6); });
}
function renderAll(){ applyTheme(); renderHome(); renderTables(); renderHistory(); renderReports(); updateCloudUI(); }

function addItemRow(tableId){
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input placeholder="Descripción"></td><td><input type="number" step="0.01" value="1"></td><td><input type="number" step="0.01" value="0"></td><td><input type="number" step="0.01" value="0"></td><td class="amount">$0.00</td><td><button type="button" class="btn ghost">✕</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); calcDoc(tableId); };
  tr.querySelectorAll('input').forEach(i => i.addEventListener('input',()=>calcDoc(tableId)));
  $('#'+tableId+' tbody').appendChild(tr); calcDoc(tableId);
}
function getItems(tableId){
  return $$('#'+tableId+' tbody tr').map(tr => { const i = $$('input',tr); return { desc:i[0].value, qty:Number(i[1].value||0), price:Number(i[2].value||0), tax:Number(i[3].value||0) }; });
}
function totals(items){ let subtotal=0,tax=0; items.forEach(x=>{ const base=x.qty*x.price; subtotal += base; tax += base*(x.tax/100); }); return { subtotal, tax, total:subtotal+tax }; }
function calcDoc(tableId){
  const items = getItems(tableId); const t = totals(items);
  $$('#'+tableId+' tbody tr').forEach((tr,idx)=>{ const x=items[idx]; const base=x.qty*x.price; $('.amount',tr).textContent = money(base + base*(x.tax/100)); });
  const prefix = tableId === 'invoiceItems' ? 'invoice' : 'quote';
  $('#'+prefix+'Subtotal').textContent = money(t.subtotal); $('#'+prefix+'Tax').textContent = money(t.tax); $('#'+prefix+'Total').textContent = money(t.total);
  return { items, ...t };
}
function buildDoc(type){
  const p = type === 'invoice' ? 'invoice' : 'quote'; const tableId = p+'Items'; const t = calcDoc(tableId);
  if(!t.items.length) throw new Error('Añade al menos un ítem.');
  return { id:uid(), type, date:$('#'+p+'Date').value, due:$('#invoiceDue')?.value || '', valid:$('#quoteValid')?.value || '', number:$('#'+p+'Number').value, method:$('#'+p+'Method').value, status:'Pendiente', client:{ name:$('#'+p+'Client').value, email:$('#'+p+'Email').value, phone:$('#'+p+'Phone').value, address:$('#'+p+'Address').value }, items:t.items, subtotal:t.subtotal, taxTotal:t.tax, total:t.total, note:$('#'+p+'Note').value, terms:$('#'+p+'Terms').value };
}
function clearDoc(type){
  const p = type === 'invoice' ? 'invoice' : 'quote'; $('#'+p+'Form').reset(); $('#'+p+'Items tbody').innerHTML=''; setDefaultDates(); $('#'+p+'Number').value = nextNumber(type==='invoice'?'FAC':'COT', type==='invoice'?state.invoices:state.quotes); calcDoc(p+'Items');
}

async function makePdf(docData, save=true){
  const { jsPDF } = window.jspdf; const pdf = new jsPDF({unit:'mm',format:'a4'}); const title = docData.type === 'invoice' ? 'FACTURA' : 'COTIZACIÓN';
  if(state.settings.logoBase64){ try{ pdf.addImage(state.settings.logoBase64,'PNG',14,10,24,24); }catch{} }
  pdf.setFont('helvetica','bold'); pdf.setFontSize(17); pdf.text(state.settings.businessName || 'Nexus Finance', state.settings.logoBase64 ? 42 : 14, 18); pdf.setFontSize(12); pdf.text(title, state.settings.logoBase64 ? 42 : 14, 26); pdf.line(14,36,200,36);
  pdf.setFontSize(10); let y=44; pdf.setFont('helvetica','bold'); pdf.text('Cliente',14,y); pdf.setFont('helvetica','normal'); y+=6; [docData.client.name,docData.client.phone,docData.client.email,docData.client.address].filter(Boolean).forEach(v=>{ pdf.text(String(v).slice(0,80),14,y); y+=6; });
  let ry=44; pdf.setFont('helvetica','bold'); pdf.text('#',145,ry); pdf.setFont('helvetica','normal'); pdf.text(docData.number,198,ry,{align:'right'}); ry+=6; pdf.setFont('helvetica','bold'); pdf.text('Fecha',145,ry); pdf.setFont('helvetica','normal'); pdf.text(docData.date,198,ry,{align:'right'}); ry+=6; pdf.setFont('helvetica','bold'); pdf.text(docData.type==='invoice'?'Vence':'Válida',145,ry); pdf.setFont('helvetica','normal'); pdf.text(docData.due || docData.valid || '',198,ry,{align:'right'});
  y=Math.max(y,78); pdf.line(14,y,200,y); y+=7; pdf.setFont('helvetica','bold'); ['Descripción','Cant.','Precio','Imp','Importe'].forEach((h,i)=>pdf.text(h,[14,112,132,154,176][i],y)); y+=6; pdf.line(14,y,200,y); y+=7; pdf.setFont('helvetica','normal');
  docData.items.forEach(it=>{ const base=it.qty*it.price, amt=base+base*(it.tax/100); pdf.text(String(it.desc||'').slice(0,55),14,y); pdf.text(String(it.qty),112,y); pdf.text(Number(it.price).toFixed(2),132,y); pdf.text(String(it.tax)+'%',154,y); pdf.text(Number(amt).toFixed(2),198,y,{align:'right'}); y+=7; if(y>265){pdf.addPage(); y=20;} });
  y+=6; pdf.line(130,y,200,y); y+=7; pdf.setFont('helvetica','bold'); pdf.text('Subtotal',145,y); pdf.text(money(docData.subtotal),198,y,{align:'right'}); y+=7; pdf.text('Impuestos',145,y); pdf.text(money(docData.taxTotal),198,y,{align:'right'}); y+=7; pdf.setFontSize(13); pdf.text('TOTAL',145,y); pdf.text(money(docData.total),198,y,{align:'right'}); y+=14; pdf.setFontSize(10);
  if(docData.note){ pdf.setFont('helvetica','bold'); pdf.text('Nota:',14,y); pdf.setFont('helvetica','normal'); pdf.text(String(docData.note).slice(0,180),14,y+6); y+=14; }
  if(docData.terms){ pdf.setFont('helvetica','bold'); pdf.text('Términos:',14,y); pdf.setFont('helvetica','normal'); pdf.text(String(docData.terms).slice(0,180),14,y+6); }
  if(save) pdf.save(`${docData.number || title}.pdf`);
  return pdf;
}
async function reportPdf(){
  const { jsPDF } = window.jspdf; const pdf = new jsPDF(); const [m1,m2]=monthBounds();
  pdf.setFont('helvetica','bold'); pdf.setFontSize(16); pdf.text(state.settings.businessName || 'Nexus Finance',14,18); pdf.setFontSize(12); pdf.text('REPORTE FINANCIERO',14,28); pdf.line(14,34,200,34); let y=44;
  [['Ingresos mes',sum(state.incomes,m1,m2)],['Gastos mes',sum(state.expenses,m1,m2)],['Balance mes',sum(state.incomes,m1,m2)-sum(state.expenses,m1,m2)],['Facturado mes',sum(state.invoices,m1,m2)]].forEach(r=>{ pdf.text(r[0],14,y); pdf.text(money(r[1]),190,y,{align:'right'}); y+=9; });
  pdf.save('reporte-financiero.pdf');
}

function exportJson(){ const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nexus-finance-backup.json'; a.click(); URL.revokeObjectURL(a.href); }
async function importJson(file){ try{ state = { ...clone(DEFAULT_STATE), ...JSON.parse(await file.text()) }; saveState(); toast('Datos importados'); }catch{ toast('JSON inválido'); } }
function docRef(){ return cloudUser ? doc(db,'users',cloudUser.uid,'state','nexusFinance') : null; }
async function pullCloud(){ const ref=docRef(); if(!ref) return toast('Conecta Google primero'); const snap=await getDoc(ref); if(!snap.exists()) return toast('No hay datos en la nube'); state = { ...clone(DEFAULT_STATE), ...snap.data() }; saveState({skipCloud:true}); toast('Datos traídos de la nube'); }
async function pushCloud(){ const ref=docRef(); if(!ref) return toast('Conecta Google primero'); await setDoc(ref,{...state,_serverUpdatedAt:serverTimestamp()},{merge:true}); toast('Datos enviados a la nube'); }
function debouncePush(){ clearTimeout(pushTimer); pushTimer=setTimeout(pushCloud,900); }
function updateCloudUI(){ $('#cloudStatus').textContent = cloudUser ? `Conectado: ${cloudUser.email || cloudUser.displayName}` : 'Sin conexión'; $('#autoSync').checked = autoSync; $('#signOutGoogleBtn').style.display = cloudUser ? 'inline-flex' : 'none'; $('#googleBtn').style.display = cloudUser ? 'none' : 'inline-flex'; }

function wire(){
  fillSelects(); applyTheme(); setDefaultDates(); addItemRow('invoiceItems'); addItemRow('quoteItems');
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-PR',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  $$('.nav-btn').forEach(b=>b.onclick=()=>showView(b.dataset.view)); $$('[data-jump]').forEach(b=>b.onclick=()=>showView(b.dataset.jump)); $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
  $('#pinForm').onsubmit = async e => { e.preventDefault(); const pin=$('#pinInput').value.trim(), pin2=$('#pinConfirm').value.trim(); if(!state.settings.pinHash){ if(pin.length<4 || pin!==pin2) return toast('PIN inválido o no coincide'); state.settings.pinHash=await hash(pin); saveState({skipCloud:true}); unlock(); return; } if(await hash(pin)===state.settings.pinHash) unlock(); else toast('PIN incorrecto'); };
  $('#resetPinBtn').onclick = async()=>{ if(confirm('¿Borrar el PIN local?')){ state.settings.pinHash=''; sessionStorage.removeItem(SESSION_KEY); saveState({skipCloud:true}); initPin(); } };
  $('#logoutBtn').onclick=()=>{ sessionStorage.removeItem(SESSION_KEY); initPin(); };

  $('#incomeForm').onsubmit=e=>{ e.preventDefault(); state.incomes.push({id:uid(),date:$('#incomeDate').value,source:$('#incomeSource').value,method:$('#incomeMethod').value,ref:$('#incomeRef').value,amount:Number($('#incomeAmount').value||0)}); e.target.reset(); setDefaultDates(); saveState(); toast('Ingreso guardado'); };
  $('#expenseForm').onsubmit=e=>{ e.preventDefault(); state.expenses.push({id:uid(),date:$('#expenseDate').value,category:$('#expenseCategory').value,method:$('#expenseMethod').value,ref:$('#expenseRef').value,desc:$('#expenseDesc').value,amount:Number($('#expenseAmount').value||0)}); e.target.reset(); setDefaultDates(); saveState(); toast('Gasto guardado'); };
  document.addEventListener('click', async e=>{
    const t=e.target;
    if(t.dataset.delIncome){ state.incomes=state.incomes.filter(x=>x.id!==t.dataset.delIncome); saveState(); }
    if(t.dataset.delExpense){ state.expenses=state.expenses.filter(x=>x.id!==t.dataset.delExpense); saveState(); }
    if(t.dataset.delInvoices){ state.invoices=state.invoices.filter(x=>x.id!==t.dataset.delInvoices); saveState(); }
    if(t.dataset.delQuotes){ state.quotes=state.quotes.filter(x=>x.id!==t.dataset.delQuotes); saveState(); }
    if(t.dataset.pdfInvoices){ const d=state.invoices.find(x=>x.id===t.dataset.pdfInvoices); if(d) await makePdf(d); }
    if(t.dataset.pdfQuotes){ const d=state.quotes.find(x=>x.id===t.dataset.pdfQuotes); if(d) await makePdf(d); }
    if(t.dataset.paid){ const d=state.invoices.find(x=>x.id===t.dataset.paid); if(d){ d.status='Pagada'; saveState(); toast('Factura marcada pagada'); } }
  });
  $('#addInvoiceItem').onclick=()=>addItemRow('invoiceItems'); $('#addQuoteItem').onclick=()=>addItemRow('quoteItems'); $('#calcInvoiceBtn').onclick=()=>calcDoc('invoiceItems'); $('#calcQuoteBtn').onclick=()=>calcDoc('quoteItems');
  $('#invoiceForm').onsubmit=async e=>{ e.preventDefault(); try{ const d=buildDoc('invoice'); state.invoices.push(d); state.incomes.push({id:uid(),date:d.date,source:d.client.name,method:d.method,ref:d.number,amount:d.total}); saveState(); await makePdf(d); clearDoc('invoice'); toast('Factura guardada'); }catch(err){ toast(err.message); } };
  $('#saveInvoiceWhatsapp').onclick=async()=>{ try{ const d=buildDoc('invoice'); state.invoices.push(d); state.incomes.push({id:uid(),date:d.date,source:d.client.name,method:d.method,ref:d.number,amount:d.total}); saveState(); await makePdf(d); const phone=String(d.client.phone||'').replace(/\D/g,''); if(phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`Saludos, adjunto el resumen de su factura ${d.number}. Total: ${money(d.total)}.`)}`,'_blank'); clearDoc('invoice'); toast('Factura guardada'); }catch(err){ toast(err.message); } };
  $('#quoteForm').onsubmit=async e=>{ e.preventDefault(); try{ const d=buildDoc('quote'); state.quotes.push(d); saveState(); await makePdf(d); clearDoc('quote'); toast('Cotización guardada'); }catch(err){ toast(err.message); } };
  $$('.tab').forEach(b=>b.onclick=()=>{ $$('.tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); activeHistory=b.dataset.history; renderHistory(); }); $('#historySearch').oninput=renderHistory;
  $('#exportPdfBtn').onclick=reportPdf; $('#quickPdfBtn').onclick=reportPdf;
  $('#saveSettingsBtn').onclick=()=>{ state.settings.businessName=$('#setBusinessName').value||'Nexus Finance'; state.settings.currency=$('#setCurrency').value; state.settings.primary=$('#setPrimary').value; state.settings.accent=$('#setAccent').value; saveState(); toast('Configuración guardada'); };
  $('#setLogo').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ state.settings.logoBase64=r.result; saveState(); toast('Logo guardado'); }; r.readAsDataURL(f); };
  $('#exportJsonBtn').onclick=exportJson; $('#importJsonInput').onchange=e=>e.target.files[0] && importJson(e.target.files[0]); $('#wipeBtn').onclick=()=>{ if(confirm('¿Borrar todos los datos locales?')){ state=clone(DEFAULT_STATE); localStorage.removeItem(STORAGE_KEY); saveState({skipCloud:true}); location.reload(); } };
  const provider = new GoogleAuthProvider(); $('#googleBtn').onclick=async()=>{ try{ await signInWithPopup(auth,provider); }catch{ await signInWithRedirect(auth,provider); } }; $('#signOutGoogleBtn').onclick=()=>signOut(auth); $('#pullBtn').onclick=pullCloud; $('#pushBtn').onclick=pushCloud; $('#autoSync').onchange=e=>{ autoSync=e.target.checked; localStorage.setItem(AUTO_KEY,JSON.stringify(autoSync)); updateCloudUI(); };
  onAuthStateChanged(auth,u=>{ cloudUser=u; updateCloudUI(); });
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  renderAll(); initPin();
}

document.addEventListener('DOMContentLoaded', wire);
