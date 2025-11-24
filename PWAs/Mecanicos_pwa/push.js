// =========================================================================
// PUSH INTELIGENTE - MECÂNICOS (CORRIGIDO)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuração do Firebase ---
const firebaseConfig = {
    apiKey: "AIzaSyDleQ5Y1-o7Uoo3zOXKIm35KljdxJuxvWo",
    authDomain: "banco-de-dados-outlet2-0.firebaseapp.com",
    projectId: "banco-de-dados-outlet2-0",
    storageBucket: "banco-de-dados-outlet2-0.firebasestorage.app",
    messagingSenderId: "917605669915",
    appId: "1:917605669915:web:6a9ee233227cfd250bacbe",
    measurementId: "G-5SZ5F2WKXD"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);

// SUA CHAVE CORRIGIDA (Do Console do Firebase)
const VAPID_PUBLIC_KEY = 'BI4ETZDqademtj-ZFFq5f93hUKtLAuJGYt0DsfF12wg09DkmYVz5xwlg2gmC0qBGrtQBuUtcBBysIWaZIQjnur0'; 

export async function registerForPushNotifications(role, username) {
  console.log(`🔧 [${username}] Iniciando registro de Push...`);

  if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker não suportado.');
      return;
  }

  try {
    // 1. OBRIGATÓRIO: Registrar o Service Worker antes de usar
    // (Isso estava faltando e causava o travamento)
    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
    console.log('✅ Service Worker registrado.');

    // 2. Pede permissão
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('❌ Permissão de notificação negada.');
      return;
    }

    // 3. Aguarda ele estar ativo
    await navigator.serviceWorker.ready;

    // 4. Pede o Token
    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration
    });

    if (currentToken) {
      await saveTokenToFirestore(currentToken, role, username);
    } else {
      console.log('⚠️ Nenhum token disponível.');
    }

  } catch (err) {
    console.error('❌ Erro ao registrar notificações:', err);
  }
}

async function saveTokenToFirestore(token, role, username) {
  try {
    const tokenRef = doc(db, 'device_tokens', token);
    
    await setDoc(tokenRef, {
      token: token,
      role: role,
      username: username,
      updatedAt: serverTimestamp(),
      platform: 'web_mechanic'
    }, { merge: true });

    console.log(`✅ Token vinculado com sucesso: ${username} (${role})`);
  } catch (e) {
    console.error('❌ Erro ao salvar token no banco:', e);
  }
}