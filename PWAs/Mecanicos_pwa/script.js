import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
// ADICIONADO: 'getDocs' para buscar na coleção de alinhamento
import { getFirestore, doc, updateDoc, onSnapshot, collection, query, where, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
// ÁUDIO (Lógica Simples Restaurada - Apenas destrava o som)
// =========================================================================
const notificationSound = new Audio('sounds/notify.mp3');

// Função simples apenas para permitir áudio no Android/iOS no primeiro clique
function unlockAudioContext() {
    notificationSound.volume = 0.1;
    notificationSound.play().then(() => {
        notificationSound.pause();
        notificationSound.currentTime = 0;
        notificationSound.volume = 1.0;
    }).catch(e => {});
    document.body.removeEventListener('click', unlockAudioContext);
    document.body.removeEventListener('touchstart', unlockAudioContext);
}

document.body.addEventListener('click', unlockAudioContext);
document.body.addEventListener('touchstart', unlockAudioContext);

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

    // RESTAURADO: Push é chamado automaticamente ao logar, sem depender de clique
    registerForPushNotifications(user.role, user.username);
}

window.handleLogout = function() {
    currentUserRole = null;
    currentUserName = null;
    localStorage.removeItem('currentUser');
    window.location.href = 'auth.html';
}

function initializeAppAndAuth() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js', { scope: './' })
            .then(reg => console.log("✅ SW registrado:", reg.scope))
            .catch(err => console.error("❌ Erro SW:", err));
    }

    const savedUser = localStorage.getItem('currentUser');
    if (!savedUser) {
        window.location.replace('auth.html');
        return;
    }

    try {
        const user = JSON.parse(savedUser);
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

// --- ADICIONADO: Constantes necessárias para o Alinhamento ---
const ALIGNMENT_COLLECTION_PATH = `/artifacts/${appId}/public/data/alignmentQueue`;
const STATUS_WAITING = 'Aguardando'; 
const STATUS_FINALIZED = 'Finalizado';
const STATUS_LOST = 'Perdido';
// -------------------------------------------------------------

const STATUS_PENDING = 'Pendente';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_GS_FINISHED = 'Serviço Geral Concluído';
const STATUS_TS_FINISHED = 'Serviço Pneus Concluído';

// --- FUNÇÃO DE PRONTO CORRIGIDA ---
async function markServiceReady(docId, serviceType) {
    if (serviceType !== 'GS') return;

    const dataToUpdate = {
        statusGS: STATUS_GS_FINISHED,
        gsFinishedAt: serverTimestamp()
    };

    try {
        const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, docId);
        
        // 1. Marca Mecânica como concluída
        await updateDoc(serviceDocRef, dataToUpdate);

        // 2. Busca dados atualizados para decidir o próximo passo
        const serviceDoc = await getDoc(serviceDocRef);
        if (!serviceDoc.exists()) throw new Error("Documento não encontrado.");

        const job = serviceDoc.data();
        const isGsReady = job.statusGS === STATUS_GS_FINISHED;
        const isTsReady = job.statusTS === STATUS_TS_FINISHED || job.statusTS === null; // Null significa que não tem pneu

        // Se ambos (Mecânica e Pneus) acabaram
        if (isGsReady && isTsReady) {
            
            if (job.requiresAlignment) {
                // --- LÓGICA DE ALINHAMENTO ---
                // Busca o ticket de alinhamento vinculado pelo ID do serviço
                const alignQuery = query(
                    collection(db, ALIGNMENT_COLLECTION_PATH),
                    where('serviceJobId', '==', docId)
                );
                
                const alignSnapshot = await getDocs(alignQuery);

                if (!alignSnapshot.empty) {
                    const alignDocSnapshot = alignSnapshot.docs[0];
                    const alignData = alignDocSnapshot.data();

                    // Só libera se não estiver finalizado ou perdido (segurança)
                    if (alignData.status !== STATUS_FINALIZED && alignData.status !== STATUS_LOST && alignData.status !== STATUS_READY) {
                        // MUDA O STATUS DO ALINHAMENTO PARA 'AGUARDANDO' (Disponível na tela do Alinhador)
                        await updateDoc(alignDocSnapshot.ref, { status: STATUS_WAITING });
                        console.log("Alinhamento liberado com sucesso.");
                    }
                    
                    // Mantém o serviço principal como 'Serviço Geral Concluído' (Não libera pagamento ainda)
                    await updateDoc(serviceDocRef, { status: STATUS_GS_FINISHED });
                } else {
                    // Fallback: Se deveria ter alinhamento mas não achou o doc, finaliza para não travar
                    console.warn("Alinhamento não encontrado. Finalizando serviço.");
                    await updateDoc(serviceDocRef, { status: STATUS_READY });
                }

            } else {
                // --- NÃO REQUER ALINHAMENTO ---
                // Libera direto para Pagamento
                await updateDoc(serviceDocRef, { status: STATUS_READY });
            }
        }
        
    } catch (error) {
        console.error("Erro ao marcar pronto:", error);
        alert(`Erro: ${error.message}`);
    }
}

// =========================================================================
// INTERFACE E MODAIS
// =========================================================================

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

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PLAY_SOUND') {
            notificationSound.currentTime = 0;
            notificationSound.play().catch(e => console.warn("Toque na tela para liberar som:", e));
        }
    });
}