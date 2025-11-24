// =========================================================================
// PUSH INTELIGENTE (SALVA NO FIRESTORE) - CORRIGIDO
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuração do Firebase (A mesma do script.js) ---
const firebaseConfig = {
    apiKey: "AIzaSyDleQ5Y1-o7Uoo3zOXKIm35KljdxJuxvWo",
    authDomain: "banco-de-dados-outlet2-0.firebaseapp.com",
    projectId: "banco-de-dados-outlet2-0",
    storageBucket: "banco-de-dados-outlet2-0.firebasestorage.app",
    messagingSenderId: "917605669915",
    appId: "1:917605669915:web:6a9ee233227cfd250bacbe",
    measurementId: "G-5SZ5F2WKXD"
};

// Inicializa o Firebase DENTRO deste arquivo para evitar o erro "No Firebase App"
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);

// Sua chave VAPID
const VAPID_PUBLIC_KEY = 'BI4ETZDqademtj-ZFFq5f93hUKtLAuJGYt0DsfF12wg09DkmYVz5xwlg2gmC0qBGrtQBuUtcBBysIWaZIQjnur0'; 

/**
 * Registra o dispositivo para receber notificações.
 * Agora aceita 'role' e 'username' para sabermos QUEM é o dono do dispositivo.
 */
export async function registerForPushNotifications(role, username) {
  console.log('🏁 INICIANDO REGISTRO PUSH...');

  if (!('serviceWorker' in navigator)) {
    console.warn('❌ Service Worker não suportado neste navegador.');
    return;
  }

  try {
    // 1. Pede permissão ao usuário
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('❌ Permissão de notificação negada.');
      return;
    }

    // 2. Aguarda o Service Worker estar pronto
    const registration = await navigator.serviceWorker.ready;

    // 3. Pede o Token ao Firebase usando sua chave VAPID
    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration
    });

    if (currentToken) {
      // 4. Salva no banco de dados com as informações do usuário
      await saveTokenToFirestore(currentToken, role, username);
      
    } else {
      console.log('⚠️ Nenhum token disponível. Tente limpar os dados do site.');
    }

  } catch (err) {
    console.error('❌ Erro ao registrar notificações:', err);
  }
}

/**
 * Salva o token na coleção 'device_tokens' junto com o cargo e nome.
 */
async function saveTokenToFirestore(token, role, username) {
  try {
    const tokenRef = doc(db, 'device_tokens', token);
    
    await setDoc(tokenRef, {
      token: token,
      role: role,          
      username: username,  
      updatedAt: serverTimestamp(),
      platform: 'web'
    }, { merge: true });

    console.log(`✅ Token vinculado a ${username} (${role}) no banco de dados.`);
  } catch (e) {
    console.error('❌ Erro ao salvar token no Firestore:', e);
  }
}