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

// SUA CHAVE VAPID
const VAPID_PUBLIC_KEY = 'BI4ETZDqademtj-ZFFq5f93hUKtLAuJGYt0DsfF12wg09DkmYVz5xwlg2gmC0qBGrtQBuUtcBBysIWaZIQjnur0'; 

export async function registerForPushNotifications(role, username) {
  console.log(`🔧 [${username}] Iniciando processo de Push (${role})...`);

  if (!('serviceWorker' in navigator)) {
      alert('Erro: Este navegador não suporta Service Workers.');
      return;
  }

  try {
    // 1. Aguarda o Service Worker estar PRONTO e ATIVO
    const registration = await navigator.serviceWorker.ready;
    console.log('✅ Service Worker detectado e pronto:', registration.scope);

    // 2. Pede permissão
    const permission = await Notification.requestPermission();
    
    if (permission !== 'granted') {
      console.warn('Permissão negada pelo usuário.');
      return;
    }

    // 3. Tenta obter o Token
    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration
    });

    if (currentToken) {
      await saveTokenToFirestore(currentToken, role, username);
    } else {
      alert('Erro: O Firebase não retornou nenhum token. Verifique a VAPID Key.');
    }

  } catch (err) {
    console.error('❌ Erro fatal no Push:', err);
    alert(`Erro Push: ${err.message}`);
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
      platform: 'web_pwa',
      userAgent: navigator.userAgent
    }, { merge: true });

    console.log(`✅ Token salvo no banco para ${username}!`);
    // alert(`Notificações ativas para ${username}!`); 
  } catch (e) {
    console.error('❌ Erro ao salvar no Firestore:', e);
    alert(`Erro ao salvar no banco: ${e.message}`);
  }
}