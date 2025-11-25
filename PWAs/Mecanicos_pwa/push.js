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

// SUA CHAVE VAPID (Confira se não há espaços extras no final)
const VAPID_PUBLIC_KEY = 'BI4ETZDqademtj-ZFFq5f93hUKtLAuJGYt0DsfF12wg09DkmYVz5xwlg2gmC0qBGrtQBuUtcBBysIWaZIQjnur0'; 

export async function registerForPushNotifications(role, username) {
  console.log(`🔧 [${username}] Iniciando processo de Push...`);

  if (!('serviceWorker' in navigator)) {
      alert('Erro: Este navegador não suporta Service Workers.');
      return;
  }

  try {
    // 1. Aguarda o Service Worker estar PRONTO e ATIVO (Crucial para Android)
    const registration = await navigator.serviceWorker.ready;
    console.log('✅ Service Worker detectado e pronto:', registration.scope);

    // 2. Pede permissão (No Android, isso deve ocorrer após um clique)
    const permission = await Notification.requestPermission();
    
    if (permission !== 'granted') {
      alert('Permissão de notificação foi negada ou fechada.');
      return;
    }

    // 3. Tenta obter o Token
    // alert('Gerando token... aguarde.'); // (Opcional: descomente se quiser ver esse passo)

    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration
    });

    if (currentToken) {
      console.log('Token gerado:', currentToken);
      await saveTokenToFirestore(currentToken, role, username);
    } else {
      alert('Erro: O Firebase não retornou nenhum token. Verifique a VAPID Key.');
    }

  } catch (err) {
    console.error('❌ Erro fatal no Push:', err);
    // Este alerta vai te dizer o motivo exato do erro no celular
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

    console.log(`✅ Token salvo no banco!`);
    // Se você ver este alerta, funcionou 100%
    // alert(`Tudo pronto! Notificações ativas para ${username}.`); 
  } catch (e) {
    console.error('❌ Erro ao salvar no Firestore:', e);
    alert(`Erro ao salvar no banco: ${e.message}`);
  }
}