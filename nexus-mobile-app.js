// -----------------------------------------
//  NEXUS FINANCE MOBILE – FIREBASE SYNC FIX
// -----------------------------------------

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

// -------------------------------
// 1. FIREBASE CONFIG
// -------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCN4wyOahZC49EWSHT0wFe8wNBLpDDddgU",
  authDomain: "oasis-services-f3dd0.firebaseapp.com",
  projectId: "oasis-services-f3dd0",
  storageBucket: "oasis-services-f3dd0.appspot.com",
  messagingSenderId: "815418940075",
  appId: "1:815418940075:web:c63221fea9e937d222f4e8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();

// CURRENT USER UID
let CURRENT_UID = null;

// -------------------------------
// 2. LOGIN
// -------------------------------
document.getElementById("btnSignInMobile").onclick = async () => {

  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);

    CURRENT_UID = result.user.uid;

    document.getElementById("syncStatusMobile").innerText =
      "Conectado como: " + result.user.email;

    document.getElementById("btnSignInMobile").style.display = "none";
    document.getElementById("btnSignOutMobile").style.display = "block";

  } catch (e) {
    alert("Error al conectar: " + e.message);
  }
};

document.getElementById("btnSignOutMobile").onclick = () => {
  signOut(auth);
  CURRENT_UID = null;
  document.getElementById("syncStatusMobile").innerText = "Sin conexión";

  document.getElementById("btnSignInMobile").style.display = "block";
  document.getElementById("btnSignOutMobile").style.display = "none";
};

// -------------------------------------------
// 3. LEER DATOS DE FIREBASE (FIX REAL)
// -------------------------------------------
async function getCloudData() {

  if (!CURRENT_UID) return null;

  const ref = doc(db, "nexusFinance", CURRENT_UID);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return snap.data();
}

// -------------------------------------------
// 4. CALCULAR KPIs HOY (FIX DEL –500)
// -------------------------------------------
function getTodayTotals(data) {

  const today = new Date().toISOString().substring(0, 10);

  let inc = 0;
  let exp = 0;

  if (data.incomes) {
    Object.values(data.incomes).forEach(i => {
      if (i.date === today) inc += Number(i.amount || 0);
    });
  }

  if (data.expenses) {
    Object.values(data.expenses).forEach(e => {
      if (e.date === today) exp += Number(e.amount || 0);
    });
  }

  return {
    ingresos: inc,
    gastos: exp,
    balance: inc - exp
  };
}

// -------------------------------------------
// 5. REFRESCAR KPIs EN PANTALLA
// -------------------------------------------
async function refreshKPIs() {

  if (!CURRENT_UID) return;

  const cloud = await getCloudData();
  if (!cloud) return;

  const today = getTodayTotals(cloud);

  document.getElementById("kpi-income-today").innerText =
    "$" + today.ingresos.toFixed(2);

  document.getElementById("kpi-expenses-today").innerText =
    "$" + today.gastos.toFixed(2);

  document.getElementById("kpi-balance-today").innerText =
    "$" + today.balance.toFixed(2);

  // 🔥 BALANCE DEL MES (USO EL MISMO CÓDIGO QUE DESKTOP)
  document.getElementById("kpi-balance-month").innerText =
    "$" + (cloud.balanceMonth || 0).toFixed(2);
}

// -------------------------------------------
// 6. BOTÓN: TRAER DATOS DESDE LA NUBE
// -------------------------------------------
document.getElementById("btnSyncPullMobile").onclick = async () => {
  await refreshKPIs();
  alert("Datos actualizados desde Firebase ✔️");
};

// -------------------------------------------
// 7. BOTÓN: ENVIAR DATOS A LA NUBE
// -------------------------------------------
document.getElementById("btnSyncPushMobile").onclick = async () => {

  if (!CURRENT_UID) return alert("Conéctate primero a Google");

  const ref = doc(db, "nexusFinance", CURRENT_UID);

  try {
    const local = JSON.parse(localStorage.getItem("nexusData")) || {};

    await setDoc(ref, local, { merge: true });

    alert("Datos guardados en la nube ✔️");

  } catch (err) {
    alert("Error al guardar: " + err.message);
  }
};

// REFRESCAR AUTOMÁTICAMENTE CADA VEZ QUE INICIA
auth.onAuthStateChanged((user) => {
  if (user) {
    CURRENT_UID = user.uid;
    refreshKPIs();
  }
});
