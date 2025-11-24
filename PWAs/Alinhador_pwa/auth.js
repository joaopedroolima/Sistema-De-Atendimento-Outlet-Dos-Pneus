import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

// --- Constantes de Perfis e Coleções ---
const MANAGER_ROLE = 'manager';
const VENDEDOR_ROLE = 'vendedor';
const ANALISTA_MARKETING_ROLE = 'analista_marketing'; // Novo perfil
const CLIENT_ROLE = 'cliente'; // NOVO: Perfil para a tela da fila (RF008)

const ALLOWED_MARKETING_PROFILES = [VENDEDOR_ROLE, ANALISTA_MARKETING_ROLE];
const ALLOWED_OPERATIONAL_PROFILES = [VENDEDOR_ROLE, MANAGER_ROLE, 'mecanico', 'aligner'];
const ALLOWED_CLIENT_PROFILES = [CLIENT_ROLE]; // NOVO

const USERS_COLLECTION_PATH = `artifacts/local-autocenter-app/public/data/users`;
const LOG_COLLECTION_PATH = `artifacts/local-autocenter-app/public/data/access_logs`;

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
        if (ALLOWED_OPERATIONAL_PROFILES.includes(user.role)) {
            await logAccessAttempt(user.id, user.role, true, 'operacional_system');
            // Redireciona para o sistema do Alinhador (index.html) se for 'aligner' ou 'manager'
            if (user.role === 'aligner' || user.role === 'manager') {
                 window.location.href = 'index.html';
            } else {
                 // CORREÇÃO: O caminho correto provavelmente não existe, mas a lógica é esta.
                 // Se existir um sistema operacional genérico, o caminho seria algo como:
                 // window.location.href = '../Operacional_system/index.html';
                 errorElement.textContent = `Perfil ${user.role} válido, mas sistema não encontrado.`;
                 localStorage.removeItem('currentUser');
            }
        } else if (ALLOWED_MARKETING_PROFILES.includes(user.role)) {
            await logAccessAttempt(user.id, user.role, true, 'marketing_interface');
            window.location.href = '../marketing_interface/marketing.html';
        } else if (ALLOWED_CLIENT_PROFILES.includes(user.role)) {
            await logAccessAttempt(user.id, user.role, true, 'Cliente_queue');
            await signInAnonymously(auth); // Garante permissão de leitura para a tela do cliente
            window.location.href = '../Cliente_queue/cliente.html';
        } else {
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

// Adiciona o listener ao formulário
document.getElementById('login-form').addEventListener('submit', handleLogin);

// Garante que o app tenha permissões de leitura assim que a página carregar.
// Isso resolve o problema de "corrida" após limpar o cache.
(async () => {
    try {
        await signInAnonymously(auth);
        console.log('Sessão anônima estabelecida na inicialização da página.');
    } catch (error) {
        console.error('Falha ao estabelecer sessão anônima na inicialização:', error);
        document.getElementById('login-error').textContent = 'Falha ao conectar com o servidor.';
    }
})();