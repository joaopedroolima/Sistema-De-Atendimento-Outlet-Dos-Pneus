import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuração do Firebase ---
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

// --- Constantes ---
const MECANICO_ROLE = 'mecanico';
const USERS_COLLECTION_PATH = `/artifacts/local-autocenter-app/public/data/users`;

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
            // Verifica a senha e o perfil do usuário
            if (userData.password === password && userData.role === MECANICO_ROLE) {
                user = { id: querySnapshot.docs[0].id, username: userData.username, role: userData.role };
            }
        }
    } catch (err) {
        console.error("Erro ao buscar usuário no Firestore:", err);
        errorElement.textContent = 'Erro de comunicação com o servidor.';
        return;
    }

    // Se encontrou um usuário de mecânico válido
    if (user) {
        // Salva os dados do usuário no localStorage
        localStorage.setItem('currentUser', JSON.stringify(user));
        // Redireciona para a página principal do PWA
        window.location.href = 'index.html';
    } else {
        errorElement.textContent = 'Credenciais inválidas ou acesso não permitido.';
    }
}

// --- Inicialização ---

// Limpa qualquer sessão antiga ao carregar a página de login
localStorage.removeItem('currentUser');

// Realiza login anônimo para obter permissão de leitura da coleção de usuários.
signInAnonymously(auth)
    .then(() => {
        console.log("Sessão anônima estabelecida para verificação de login.");
    })
    .catch((error) => {
        console.error("Erro no login anônimo:", error);
        document.getElementById('login-error').textContent = 'Falha ao conectar com o servidor de autenticação.';
    });

document.getElementById('login-form').addEventListener('submit', handleLogin);