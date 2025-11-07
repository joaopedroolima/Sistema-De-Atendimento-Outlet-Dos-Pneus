// assets/js/firebaseConfig.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  serverTimestamp,
  collection,
  addDoc,
  updateDoc,
  getDocs,
  doc,
  onSnapshot,
  query,
  orderBy,
  where
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { state } from "./appState.js";

const isCanvasEnvironment = typeof __app_id !== "undefined";
const LOCAL_APP_ID = "local-autocenter-app";
export const appId = isCanvasEnvironment
  ? typeof __app_id !== "undefined"
    ? __app_id
    : LOCAL_APP_ID
  : LOCAL_APP_ID;

const LOCAL_FIREBASE_CONFIG = {
  apiKey: "AIzaSyASPbbCpk4A2ZM_imbgoWixsFyMXYrCvQU",
  authDomain: "atendimentosoutlet.firebaseapp.com",
  projectId: "atendimentosoutlet",
  storageBucket: "atendimentosoutlet.firebasestorage.app",
  messagingSenderId: "815053643953",
  appId: "1:815053643953:web:dbf29a57abaa869d1cc290",
  measurementId: "G-JZ7B6ZBGYJ",
};

let firebaseConfig = {};
if (isCanvasEnvironment && typeof __firebase_config !== "undefined") {
  try {
    firebaseConfig = JSON.parse(__firebase_config);
  } catch (e) {
    console.error("Erro ao carregar config do Canvas, usando local.", e);
    firebaseConfig = LOCAL_FIREBASE_CONFIG;
  }
} else {
  firebaseConfig = LOCAL_FIREBASE_CONFIG;
}

export let db = null;
export let auth = null;
export let analytics = null;

// Caminhos agora como arrays (hierárquicos válidos)
export const SERVICE_COLLECTION_PATH = ["artifacts", appId, "public", "data", "serviceJobs"];
export const ALIGNMENT_COLLECTION_PATH = ["artifacts", appId, "public", "data", "alignmentQueue"];

export async function initializeFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    analytics = getAnalytics(app);
    state.db = db;
    state.auth = auth;
    state.analytics = analytics;
    console.log("🔥 Firebase inicializado com sucesso:", appId);
  } catch (e) {
    console.error("Erro ao inicializar Firebase:", e);
    throw e;
  }
}

export function serverNow() {
  return serverTimestamp();
}

// Exporta funções Firestore para uso global
export {
  collection,
  addDoc,
  updateDoc,
  getDocs,
  doc,
  onSnapshot,
  query,
  orderBy,
  where
};
