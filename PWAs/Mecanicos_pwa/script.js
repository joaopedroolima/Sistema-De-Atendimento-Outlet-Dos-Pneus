import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, updateDoc, onSnapshot, collection, query, where, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Importação CORRETA da função de push blindada
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
        console.error("Erro config:", e);
        firebaseConfig = LOCAL_FIREBASE_CONFIG;
    }
} else {
    firebaseConfig = LOCAL_FIREBASE_CONFIG;
}

// =========================================================================
// ÁUDIO E NOTIFICAÇÕES (FIX ANDROID)
// =========================================================================
const notificationSound = new Audio('sounds/notify.mp3');
let interactionUnlocked = false;

// Função chamada no primeiro clique para liberar áudio e pedir notificação
async function unlockFeatures() {
    if (interactionUnlocked) return;
    interactionUnlocked = true;

    // 1. Desbloqueia Áudio (toca mudo rapidinho)
    notificationSound.volume = 0.1;
    notificationSound.play().then(() => {
        notificationSound.pause();
        notificationSound.currentTime = 0;
        notificationSound.volume = 1.0;
        console.log("🔊 Áudio desbloqueado no Android.");
    }).catch(e => console.warn("Ainda não foi possível desbloquear o áudio:", e));

    // 2. Tenta Registrar Push Notifications (Agora permitido pois é um evento de clique)
    if (currentUserRole && currentUserName) {
        console.log("📲 Tentando registrar Push após interação do usuário...");
        registerForPushNotifications(currentUserRole, currentUserName);
    }

    // Remove os ouvintes para não rodar de novo
    document.body.removeEventListener('click', unlockFeatures);
    document.body.removeEventListener('touchstart', unlockFeatures);
}

// Adiciona os ouvintes globais
document.body.addEventListener('click', unlockFeatures);
document.body.addEventListener('touchstart', unlockFeatures);

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

    // Verifica se é Mecânico
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

    // Se já tiver permissão garantida, tenta registrar direto.
    if (Notification.permission === 'granted') {
        registerForPushNotifications(user.role, user.username);
    } else {
        console.log("⚠️ Aguardando clique para pedir notificação no Android.");
    }
}

window.handleLogout = function() {
    currentUserRole = null;
    currentUserName = null;
    localStorage.removeItem('currentUser');
    window.location.href = 'auth.html';
}

function initializeAppAndAuth() {
    // 1. Registra SW imediatamente
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js', { scope: './' })
            .then(reg => console.log("✅ SW registrado:", reg.scope))
            .catch(err => console.error("❌ Erro SW:", err));
    }

    // 2. Verifica Login Local
    const savedUser = localStorage.getItem('currentUser');
    if (!savedUser) {
        window.location.replace('auth.html');
        return;
    }

    try {
        const user = JSON.parse(savedUser);
        // 3. Login Anônimo
        signInAnonymously(auth).then(() => {
            isAuthReady = true;
            console.log("Autenticação anônima OK.");
            postLoginSetup(user);
        }).catch((e) => {
            console.error("Erro auth anônima:", e);
            alert("Erro de conexão. Recarregue a página.");
        });
    } catch (e) {
        console.error("Erro init:", e);
        localStorage.removeItem('currentUser');
        window.location.replace('auth.html');
    }
}

// =========================================================================
// LÓGICA DE NEGÓCIO (MECÂNICOS)
// =========================================================================
let serviceJobs = [];
let currentJobToConfirm = { id: null, type: null, confirmAction: null, serviceType: null };

const SERVICE_COLLECTION_PATH = `/artifacts/${appId}/public/data/serviceJobs`;

const STATUS_PENDING = 'Pendente';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_GS_FINISHED = 'Serviço Geral Concluído';
const STATUS_TS_FINISHED = 'Serviço Pneus Concluído';

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
        if (!serviceDoc.exists()) throw new Error("Documento não encontrado.");

        const job = serviceDoc.data();
        const isGsReady = job.statusGS === STATUS_GS_FINISHED;
        const isTsReady = job.statusTS === STATUS_TS_FINISHED || job.statusTS === null;

        if (isGsReady && isTsReady && !job.requiresAlignment) {
            await updateDoc(serviceDocRef, { status: STATUS_READY });
        }
        // Recarrega página para garantir atualização visual
        // window.location.reload(); // Opcional, o listener deve cuidar disso
    } catch (error) {
        console.error("Erro ao marcar pronto:", error);
        alert(`Erro: ${error.message}`);
    }
}

// =========================================================================
// INTERFACE E MODAIS
// =========================================================================

// Listener do Botão "Sim, Confirmar"
const confirmBtn = document.getElementById("confirm-button");
if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
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
}

function showConfirmationModal(id, type, title, message, confirmAction, serviceType = null) {
    currentJobToConfirm = { id, type, confirmAction, serviceType };
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    document.getElementById('confirmation-modal').classList.remove('hidden');
}

window.hideConfirmationModal = function() {
    document.getElementById('confirmation-modal').classList.add('hidden');
    currentJobToConfirm = { id: null, confirmAction: null };
}

window.showServiceReadyConfirmation = function(docId, serviceType) {
    const title = 'Confirmar Conclusão';
    const message = `Tem certeza de que deseja marcar este serviço como <strong>PRONTO</strong>?`;
    showConfirmationModal(docId, 'service', title, message, 'service', serviceType);
}

function renderMechanicQueue() {
    const mechanicViewContainer = document.getElementById('mechanic-view');
    if (!mechanicViewContainer) return;

    const myJobs = serviceJobs.filter(job =>
        job.assignedMechanic === currentUserName &&
        job.status === STATUS_PENDING &&
        job.statusGS === STATUS_PENDING
    );

    myJobs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

    let mechanicViewHTML = `<h2 class="text-2xl font-semibold mb-6 text-gray-800 border-b pb-2">Minha Fila (${myJobs.length})</h2>`;

    if (myJobs.length > 0) {
        mechanicViewHTML += `<ul class="space-y-3">`;
        mechanicViewHTML += myJobs.map(job => {
            const isTsPending = job.statusTS === STATUS_PENDING;
            const statusText = isTsPending ? `(Aguardando Pneus)` : '';
            const statusColor = isTsPending ? 'text-red-500' : 'text-gray-500';
            const isDefined = job.isServiceDefined;

            let descriptionHTML = '';
            if (!isDefined) {
                descriptionHTML = '<p class="font-bold text-red-600">(Aguardando Definição)</p>';
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
                                ${!isDefined ? 'disabled' : ''} title="${!isDefined ? 'Aguardando definição' : 'Marcar como Pronto'}">
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
                <p class="text-lg font-medium text-gray-700 mt-4">Sua fila está vazia.</p>
            </div>
        `;
    }
    mechanicViewContainer.innerHTML = mechanicViewHTML;
}

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
        where('status', '==', STATUS_PENDING)
    );

    onSnapshot(serviceQuery, (snapshot) => {
        serviceJobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderMechanicQueue();
    }, (error) => {
        console.error("Erro listener Serviços:", error);
        document.getElementById('mechanic-view').innerHTML = `<p class="text-red-500">Erro de conexão.</p>`;
    });
}

// =========================================================================
// INICIALIZAÇÃO FINAL & PWA
// =========================================================================
initializeAppAndAuth();

let deferredPrompt;
const installButton = document.getElementById('install-button');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if(installButton) installButton.classList.remove('hidden');
});

if(installButton) {
    installButton.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        installButton.classList.add('hidden');
    });
}

// Ouvinte de Som do Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PLAY_SOUND') {
            notificationSound.currentTime = 0;
            notificationSound.play().catch(e => console.warn("Toque na tela para liberar som:", e));
        }
    });
}