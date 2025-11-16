import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, setDoc, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuração do Firebase (copiada do script.js original) ---
const LOCAL_FIREBASE_CONFIG = {
    apiKey: "AIzaSyDleQ5Y1-o7Uoo3zOXKIm35KljdxJuxvWo",
    authDomain: "banco-de-dados-outlet2-0.firebaseapp.com",
    projectId: "banco-de-dados-outlet2-0",
    storageBucket: "banco-de-dados-outlet2-0.firebasestorage.app",
    messagingSenderId: "917605669915",
    appId: "1:917605669915:web:6a9ee233227cfd250bacbe",
    measurementId: "G-5SZ5F2WKXD"
};

const app = initializeApp(LOCAL_FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

// **CORREÇÃO:** Realiza um login anônimo para obter permissão de leitura no Firestore.
// Isso é essencial para que a consulta de usuários funcione antes do login real.
signInAnonymously(auth)
    .then(() => {
        console.log("Login anônimo bem-sucedido. Pronto para consultar usuários.");
    })
    .catch((error) => {
        console.error("Erro no login anônimo:", error);
        const errorElement = document.getElementById('login-error');
        if(errorElement) errorElement.textContent = 'Falha na conexão inicial com o servidor. Verifique suas regras de segurança do Firebase.';
    });

// --- Constantes de Perfis e Coleções ---
const MANAGER_ROLE = 'manager';
const VENDEDOR_ROLE = 'vendedor';
const ANALISTA_MARKETING_ROLE = 'analista_marketing'; // Novo perfil
const CLIENT_ROLE = 'cliente'; // NOVO: Perfil para a tela da fila (RF008)

const ALLOWED_MARKETING_PROFILES = [VENDEDOR_ROLE, MANAGER_ROLE, ANALISTA_MARKETING_ROLE];
const ALLOWED_OPERATIONAL_PROFILES = [VENDEDOR_ROLE, MANAGER_ROLE, 'mecanico', 'aligner'];
const ALLOWED_CLIENT_PROFILES = [CLIENT_ROLE]; // NOVO

const USERS_COLLECTION_PATH = `/artifacts/local-autocenter-app/public/data/users`;
const LOG_COLLECTION_PATH = `/artifacts/local-autocenter-app/public/data/access_logs`;

/**
 * Registra uma tentativa de acesso no log de auditoria (RF007)
 * @param {string} userId - ID do usuário que tentou o acesso.
 * @param {string} profile - Perfil do usuário.
 * @param {boolean} authorized - Se o acesso foi autorizado ou não.
 * @param {string} target - O sistema que o usuário tentou acessar.
 */
async function logAccessAttempt(userId, profile, authorized, target) {
    try {
        await addDoc(collection(db, LOG_COLLECTION_PATH), {
            userId,
            profile,
            target,
            action: authorized ? 'acesso_autorizado' : 'acesso_negado',
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Erro ao registrar log de auditoria:", error);
    }
}

/**
 * Lida com o submit do formulário de login.
 */
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorElement = document.getElementById('login-error');
    errorElement.textContent = '';

    let user = null;

    // Busca o usuário no Firestore
    try {
        const q = query(collection(db, USERS_COLLECTION_PATH), where("username", "==", username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const userData = querySnapshot.docs[0].data();
            if (userData.password === password) {
                user = { id: querySnapshot.docs[0].id, username: userData.username, role: userData.role };
            }
        }
    } catch (err) {
        console.error("Erro ao buscar usuário no Firestore:", err);
        errorElement.textContent = 'Erro de comunicação com o servidor.';
        return;
    }

    // Se encontrou um usuário válido
    if (user) {
        // Salva os dados do usuário no localStorage para ser usado pelos outros sistemas
        localStorage.setItem('currentUser', JSON.stringify(user));

        // RF003: Redirecionamento baseado no perfil
        if (user.role === ANALISTA_MARKETING_ROLE) {
            await logAccessAttempt(user.id, user.role, true, 'marketing_interface');
            window.location.href = '../marketing_interface/index.html';
        } else if (ALLOWED_OPERATIONAL_PROFILES.includes(user.role)) {
            await logAccessAttempt(user.id, user.role, true, 'operacional_system');
            window.location.href = '../Operacional_system/index.html';
        } else if (ALLOWED_CLIENT_PROFILES.includes(user.role)) {
            await logAccessAttempt(user.id, user.role, true, 'Cliente_queue');
            // NOVO: Realiza login anônimo para dar permissão de leitura à tela do cliente.
            // Isso é necessário para que os listeners do Firestore funcionem.
            await signInAnonymously(auth);
            window.location.href = '../Cliente_queue/index.html';
        } else {
            // RF002: Bloqueia perfis não autorizados
            await logAccessAttempt(user.id, user.role, false, 'any');
            errorElement.textContent = 'Seu perfil não tem permissão para acessar nenhum sistema.';
            localStorage.removeItem('currentUser'); // Limpa a sessão inválida
        }
    } else {
        await logAccessAttempt(username, 'desconhecido', false, 'any');
        errorElement.textContent = 'Credenciais inválidas.';
    }
}

// --- Inicialização ---

// Limpa qualquer sessão antiga ao carregar a página de login
localStorage.removeItem('currentUser');

document.getElementById('login-form').addEventListener('submit', handleLogin);

// **CORREÇÃO:** Garante que o usuário gerente exista no banco de dados para o login funcionar.
const managerUserRef = doc(db, USERS_COLLECTION_PATH, 'gerente.outlet');
setDoc(managerUserRef, { username: 'gerente.outlet', password: 'gerenteitapoa', role: 'manager' }, { merge: true });
