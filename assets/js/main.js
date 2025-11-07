import { initializeFirebase, auth } from './firebaseConfig.js';
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { handleLogin, handleLogout, postLoginSetup, ALIGNER_ROLE } from './auth.js';
import { initMechanicsHandlers } from './mechanics.js';
import { state } from './appState.js';
import { initModalHandlers } from './modals.js';
import { initAlignmentHandlers } from './alignment.js';
import { initServiceFormHandler, initAlignmentFormHandler } from './services.js';

function showInitialUI() {
    // Esconde o conteúdo principal e mostra a tela de login por padrão
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('login-container').classList.remove('hidden');
}

async function initApp() {
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');

    try {
        await initializeFirebase();

        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                try {
                    // Tenta login anônimo para ter permissões de leitura/escrita
                    await signInAnonymously(auth);
                    state.userId = auth.currentUser.uid;
                } catch (e) {
                    console.error("Falha no login anônimo (Necessário para Firestore):", e);
                    document.getElementById('service-error').textContent = "Erro de conexão com o banco de dados.";
                    return;
                }
            } else {
                state.userId = user.uid;
            }

            // A autenticação do Firebase está pronta, podemos mostrar a UI de login.
            state.isAuthReady = true;
            showInitialUI();
        });

    } catch (e) {
        console.error("Erro fatal na inicialização do Firebase:", e);
        document.getElementById('main-content').classList.remove('hidden');
        document.getElementById('service-error').textContent = `Erro Fatal: Falha na inicialização do Firebase. Verifique a console.`;
    }

    // --- Configuração dos Handlers e Event Listeners ---
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    window.handleLogout = handleLogout; // Expor para o onclick do HTML

    initMechanicsHandlers();
    initModalHandlers();
    initAlignmentHandlers();
    initServiceFormHandler();
    initAlignmentFormHandler();

    // Controle de Navegação por Abas
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            if (state.currentUserRole === ALIGNER_ROLE) return;
            const tabId = button.dataset.tab;
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // Expor o estado para depuração
    window._AT_STATE = state;
}

window.addEventListener('DOMContentLoaded', initApp);
