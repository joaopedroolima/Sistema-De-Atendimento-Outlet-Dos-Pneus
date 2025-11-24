import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, updateDoc, onSnapshot, collection, query, where, getDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Importação CORRETA da nova função de push
import { registerForPushNotifications } from './push.js';

// =========================================================================
// CONFIGURAÇÃO FIREBASE
// =========================================================================
const isCanvasEnvironment = typeof __app_id !== 'undefined';
const LOCAL_APP_ID = 'local-autocenter-app';
const appId = isCanvasEnvironment ? (typeof __app_id !== 'undefined' ? __app_id : LOCAL_APP_ID) : LOCAL_APP_ID;

const LOCAL_FIREBASE_CONFIG = {
    apiKey: "AIzaSyDleQ5Y1-o7Uoo3zOXKIm35KljdxJuxvWo",
    authDomain: "banco-de-dados-outlet2-0.firebaseapp.com",
    projectId: "banco-de-dados-outlet2-0",
    storageBucket: "banco-de-dados-outlet2-0.firebasestorage.app",
    messagingSenderId: "917605669915",
    appId: "1:917605669915:web:6a9ee233227cfd250bacbe",
    measurementId: "G-5SZ5F2WKXD"
};

let firebaseConfig = {};
if (isCanvasEnvironment && typeof __firebase_config !== 'undefined') {
    try {
        firebaseConfig = JSON.parse(__firebase_config);
    } catch (e) {
        console.error("Erro ao fazer parse da configuração do Firebase da plataforma. Usando placeholders.", e);
        firebaseConfig = LOCAL_FIREBASE_CONFIG;
    }
} else {
    firebaseConfig = LOCAL_FIREBASE_CONFIG;
}

// =========================================================================
// INICIALIZAÇÃO E AUTENTICAÇÃO
// =========================================================================
let db;
let auth;
let isAuthReady = false;
let currentUserRole = null;
let currentUserName = null;

const MECANICO_ROLE = 'mecanico';

const app = initializeApp(firebaseConfig);
db = getFirestore(app);
auth = getAuth(app);

function postLoginSetup(user) {
    currentUserRole = user.role;
    currentUserName = user.username;

    // Se o usuário não for um mecânico, bloqueia o acesso.
    if (currentUserRole !== MECANICO_ROLE) {
        document.body.innerHTML = `<div class="w-screen h-screen flex items-center justify-center bg-red-100 text-red-800 p-8">
            <div class="text-center">
                <h1 class="text-2xl font-bold">Acesso Negado</h1>
                <p>Este aplicativo é de uso exclusivo dos mecânicos.</p>
                <button onclick="handleLogout()" class="mt-4 text-sm font-medium py-2 px-4 bg-red-600 text-white hover:bg-red-700 rounded-lg transition duration-150">Sair</button>
            </div>
        </div>`;
        return;
    }

    document.getElementById('main-content').classList.remove('hidden');
    document.getElementById('user-info').textContent = `Usuário: ${user.username}`;

    setupRealtimeListeners();

    // REGISTRA O TOKEN COM O NOME DO USUÁRIO
    registerForPushNotifications(user.role, user.username);
}

window.handleLogout = function() {
    currentUserRole = null;
    currentUserName = null;
    localStorage.removeItem('currentUser');
    // Redireciona para a página de login local do PWA
    window.location.href = 'auth.html';
}

/**
 * NOVO: Simulador de login para ambiente de desenvolvimento.
 */
function devLogin() {
    if (!isCanvasEnvironment && !localStorage.getItem('currentUser')) {
        console.warn("MODO DE DESENVOLVIMENTO: Logando como usuário 'Mecânico Teste'.");
        const devUser = { username: 'Mecânico Teste', role: 'mecanico' };
        localStorage.setItem('currentUser', JSON.stringify(devUser));
    }
}

function initializeAppAndAuth() {
    // Verifica se há um usuário salvo no armazenamento local.
    const savedUser = localStorage.getItem('currentUser');
    if (!savedUser) {
        window.location.replace('auth.html'); // Redireciona para a página de login local
        return;
    }

    try {
        const user = JSON.parse(savedUser);
        isAuthReady = true;
        postLoginSetup(user);
    } catch (e) {
        console.error("Erro ao inicializar:", e);
        document.body.innerHTML = `<p>Erro fatal ao carregar dados do usuário. Tente fazer login novamente.</p>`;
    }
}

// =========================================================================
// ESTADO E CONSTANTES
// =========================================================================
let serviceJobs = [];
let currentJobToConfirm = { id: null, type: null, confirmAction: null, serviceType: null };

// COLEÇÕES DO FIRESTORE
const SERVICE_COLLECTION_PATH = `/artifacts/${appId}/public/data/serviceJobs`;

// STATUS GLOBAIS
const STATUS_PENDING = 'Pendente';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_GS_FINISHED = 'Serviço Geral Concluído';
const STATUS_TS_FINISHED = 'Serviço Pneus Concluído';

// =========================================================================
// LÓGICA DE NEGÓCIO E AÇÕES
// =========================================================================

async function markServiceReady(docId, serviceType) {
    if (serviceType !== 'GS') return;

    const dataToUpdate = {
        statusGS: STATUS_GS_FINISHED,
        gsFinishedAt: serverTimestamp()
    };

    try {
        const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, docId);
        await updateDoc(serviceDocRef, dataToUpdate);

        const serviceDoc = await getDoc(serviceDocRef);
        if (!serviceDoc.exists()) throw new Error("Documento de Serviço não encontrado.");

        const job = serviceDoc.data();
        const isGsReady = job.statusGS === STATUS_GS_FINISHED;
        const isTsReady = job.statusTS === STATUS_TS_FINISHED || job.statusTS === null;

        // Se todas as etapas estiverem prontas e não precisar de alinhamento, o serviço fica pronto para pagamento
        if (isGsReady && isTsReady && !job.requiresAlignment) {
            await updateDoc(serviceDocRef, { status: STATUS_READY });
        }
    } catch (error) {
        console.error("Erro ao marcar serviço como pronto:", error);
        alert(`Erro no Banco de Dados: ${error.message}`);
    }
}

// =========================================================================
// MODAL DE CONFIRMAÇÃO
// =========================================================================

document.getElementById("confirm-button").addEventListener("click", () => {
    const { id, confirmAction, serviceType } = currentJobToConfirm;
    if (!id || !confirmAction) {
        hideConfirmationModal();
        return;
    }

    if (confirmAction === "service") {
        markServiceReady(id, serviceType);
    }
    hideConfirmationModal();
});

function showConfirmationModal(id, type, title, message, confirmAction, serviceType = null) {
    currentJobToConfirm = { id, type, confirmAction, serviceType };
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    document.getElementById('confirmation-modal').classList.remove('hidden');
}

window.hideConfirmationModal = function() {
    document.getElementById('confirmation-modal').classList.add('hidden');
    currentJobToConfirm = { id: null, type: null, confirmAction: null, serviceType: null };
}

window.showServiceReadyConfirmation = function(docId, serviceType) {
    const title = 'Confirmar Serviço Concluído';
    const message = `Tem certeza de que deseja marcar este serviço como <strong>PRONTO</strong>?`;
    showConfirmationModal(docId, 'service', title, message, 'service', serviceType);
}

// =========================================================================
// RENDERIZAÇÃO DA INTERFACE
// =========================================================================

function renderMechanicQueue() {
    const mechanicViewContainer = document.getElementById('mechanic-view');
    if (!mechanicViewContainer) return;

    const myJobs = serviceJobs.filter(job =>
        job.assignedMechanic === currentUserName &&
        job.status === STATUS_PENDING &&
        job.statusGS === STATUS_PENDING
    );

    myJobs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

    let mechanicViewHTML = `<h2 class="text-2xl font-semibold mb-6 text-gray-800 border-b pb-2">Minha Fila de Serviços (${myJobs.length})</h2>`;

    if (myJobs.length > 0) {
        mechanicViewHTML += `<ul class="space-y-3">`;
        mechanicViewHTML += myJobs.map(job => {
            const isTsPending = job.statusTS === STATUS_PENDING;
            const statusText = isTsPending ? `(Aguardando Pneus)` : '';
            const statusColor = isTsPending ? 'text-red-500' : 'text-gray-500';
            const isDefined = job.isServiceDefined;

            let descriptionHTML = '';
            if (!isDefined) {
                descriptionHTML = '<p class="font-bold text-red-600">(Aguardando Definição de Serviço pela Gerência)</p>';
            } else {
                const descriptionText = job.serviceDescription || 'N/A';
                if (descriptionText.length > 25) {
                    const shortText = `${descriptionText.substring(0, 25)}...`;
                    descriptionHTML = `
                        <p class="text-sm ${statusColor} break-words">${shortText}</p>
                        <button onclick="showFullDescriptionModal(\`${escape(descriptionText)}\`)" class="text-xs text-blue-500 hover:underline mt-1">Ver mais</button>
                    `;
                } else {
                    descriptionHTML = `<p class="text-sm ${statusColor} break-words">${descriptionText}</p>`;
                }
            }

            return `
                <li class="relative p-4 bg-white border-l-4 border-blue-500 rounded-lg shadow-md min-h-[100px]">
                    <div class="pr-24">
                        <div>
                            <p class="text-lg font-bold text-gray-800">${job.licensePlate}</p>
                            <p class="text-md text-gray-600 mb-2">${job.carModel}</p>
                            ${descriptionHTML}
                            <p class="text-xs text-gray-400 mt-1">Vendedor: ${job.vendedorName} <span class="font-semibold ${statusColor}">${statusText}</span></p>
                        </div>
                    </div>
                    <div class="absolute top-4 right-4">
                        <button onclick="showServiceReadyConfirmation('${job.id}', 'GS')"
                                class="text-sm font-medium bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                ${!isDefined ? 'disabled' : ''} title="${!isDefined ? 'Aguardando definição do serviço pela gerência' : 'Marcar como Pronto'}">
                            Pronto
                        </button>
                    </div>
                </li>
            `;
        }).join('');
        mechanicViewHTML += `</ul>`;
    } else {
        mechanicViewHTML += `
            <div class="text-center p-10 bg-white rounded-lg shadow-md border">
                <svg class="mx-auto h-12 w-12 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <p class="text-lg font-medium text-gray-700 mt-4">Nenhum carro na sua fila no momento.</p>
                <p class="text-gray-500">Aproveite para organizar a oficina!</p>
            </div>
        `;
    }
    mechanicViewContainer.innerHTML = mechanicViewHTML;
}

// =========================================================================
// MODAIS ADICIONAIS E LISTENERS
// =========================================================================

window.showFullDescriptionModal = function(encodedText) {
    const text = unescape(encodedText);
    document.getElementById('text-display-content').textContent = text;
    document.getElementById('text-display-modal').classList.remove('hidden');
}

window.hideTextDisplayModal = function() {
    document.getElementById('text-display-modal').classList.add('hidden');
}

function setupRealtimeListeners() {
    if (!isAuthReady) return;

    const serviceQuery = query(
        collection(db, SERVICE_COLLECTION_PATH),
        where('status', '==', STATUS_PENDING) // Apenas serviços pendentes
    );

    onSnapshot(serviceQuery, (snapshot) => {
        serviceJobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderMechanicQueue();
    }, (error) => {
        console.error("Erro no listener de Serviços:", error);
        document.getElementById('mechanic-view').innerHTML = `<p class="text-red-500">Erro de conexão: ${error.message}</p>`;
    });
}

// =========================================================================
// INICIALIZAÇÃO
// =========================================================================
initializeAppAndAuth();

// =========================================================================
// LÓGICA DE INSTALAÇÃO DO PWA
// =========================================================================
let deferredPrompt;
const installButton = document.getElementById('install-button');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installButton.classList.remove('hidden');
    console.log('PWA está pronto para ser instalado.');
});

installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`Resultado da instalação: ${outcome}`);
    deferredPrompt = null;
    installButton.classList.add('hidden');
});

// =========================================================================
// SOM DE NOTIFICAÇÃO (FIX) - OUVINTE DO SERVICE WORKER
// =========================================================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        // Ouve o comando enviado pelo Service Worker para tocar o som
        if (event.data && event.data.type === 'PLAY_SOUND') {
            console.log("🔊 Tocando som de notificação...");
            const audio = new Audio('sounds/notify.mp3');
            audio.play().catch(e => console.warn("Erro ao tocar som (interaja com a página primeiro):", e));
        }
    });
}