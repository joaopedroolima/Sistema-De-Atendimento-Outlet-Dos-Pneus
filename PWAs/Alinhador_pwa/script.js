import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, addDoc, updateDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
        console.error("Erro ao fazer parse da configuração", e);
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

// Constantes de Papéis
const ALIGNER_ROLE = 'aligner';
const MANAGER_ROLE = 'manager';
const VENDEDOR_ROLE = 'vendedor';
const MECANICO_ROLE = 'mecanico';

const app = initializeApp(firebaseConfig);
db = getFirestore(app);
auth = getAuth(app);

function postLoginSetup(user) {
    currentUserRole = user.role;
    currentUserName = user.username;

    // Verifica se é Alinhador ou Gerente
    if (user.role !== ALIGNER_ROLE && user.role !== MANAGER_ROLE) {
        document.body.innerHTML = `<div class="flex items-center justify-center h-screen bg-red-100 text-red-800 p-8 text-center">
            <div>
                <h1 class="text-2xl font-bold">Acesso Negado</h1>
                <p>Área restrita para Alinhadores.</p>
                <button onclick="handleLogout()" class="mt-4 py-2 px-4 bg-red-600 text-white rounded">Sair</button>
            </div>
        </div>`;
        return;
    }

    // Configura a interface
    const userInfo = document.getElementById('user-info');
    if(userInfo) userInfo.textContent = `${user.username} (${user.role})`;

    // Listeners de formulários
    const alignForm = document.getElementById('alignment-form');
    if (alignForm) alignForm.addEventListener('submit', handleAddAlignment);

    const reworkForm = document.getElementById('rework-form');
    if (reworkForm) reworkForm.addEventListener('submit', handleReturnToMechanic);

    const confirmBtn = document.getElementById("confirm-button");
    if (confirmBtn) confirmBtn.addEventListener("click", handleConfirmAction);

    setupRealtimeListeners();
    setupUserListener(); // Para preencher dropdowns de vendedores/mecânicos

    // Se já tiver permissão, tenta registrar. Se não, espera o clique (unlockFeatures).
    if (Notification.permission === 'granted') {
        registerForPushNotifications(user.role, user.username);
    } else {
        console.log("⚠️ Aguardando clique para pedir notificação.");
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
        // 3. Login Anônimo no Firebase
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
// CONSTANTES E ESTADO DO ALINHAMENTO
// =========================================================================
let alignmentQueue = [];
let mecanicosGeral = [];
let vendedores = [];
let currentJobToConfirm = { id: null, confirmAction: null };
let currentAlignmentJobForRework = null;

const ALIGNMENT_COLLECTION_PATH = `artifacts/${appId}/public/data/alignmentQueue`;
const SERVICE_COLLECTION_PATH = `artifacts/${appId}/public/data/serviceJobs`;
const USERS_COLLECTION_PATH = `artifacts/${appId}/public/data/users`;

const STATUS_WAITING_GS = 'Aguardando Serviço Geral';
const STATUS_WAITING = 'Aguardando';
const STATUS_ATTENDING = 'Em Atendimento';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_LOST = 'Perdido';
const STATUS_PENDING = 'Pendente';
const STATUS_REWORK = 'Em Retrabalho';

// =========================================================================
// LISTENERS DO FIRESTORE
// =========================================================================
function setupUserListener() {
    const usersQuery = query(collection(db, USERS_COLLECTION_PATH));
    onSnapshot(usersQuery, (snapshot) => {
        const systemUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        vendedores = systemUsers.filter(u => u.role === VENDEDOR_ROLE);
        mecanicosGeral = systemUsers.filter(u => u.role === MECANICO_ROLE);
        populateDropdowns();
    });
}

function setupRealtimeListeners() {
    const alignmentQuery = query(
        collection(db, ALIGNMENT_COLLECTION_PATH),
        where('status', 'in', [STATUS_WAITING, STATUS_ATTENDING, STATUS_WAITING_GS])
    );

    onSnapshot(alignmentQuery, (snapshot) => {
        alignmentQueue = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAlignmentQueue();
    }, (error) => {
        console.error("Erro listener Alinhamento:", error);
    });
}

function populateDropdowns() {
    // Preenche dropdown de adicionar carro
    const vendedorSelect = document.getElementById('aliVendedorName');
    
    if (vendedorSelect) {
        // Preenche as opções
        vendedorSelect.innerHTML = `<option value="" disabled selected>Vendedor...</option>` + 
            vendedores.map(v => `<option value="${v.username}">${v.username}</option>`).join('');
            
        // --- A CORREÇÃO ESTÁ AQUI EMBAIXO ---
        // Se a lista de vendedores foi carregada, habilita o campo
        if (vendedores.length > 0) {
            vendedorSelect.disabled = false;
        }
    }

    // Preenche dropdown do modal de retrabalho
    const reworkMechanicSelect = document.getElementById('rework-mechanic-select');
    if (reworkMechanicSelect) {
        reworkMechanicSelect.innerHTML = mecanicosGeral.map(m => `<option value="${m.username}">${m.username}</option>`).join('');
    }
}

// =========================================================================
// RENDERIZAÇÃO E LÓGICA DE FILA
// =========================================================================
function getSortedAlignmentQueue() {
    const activeCars = alignmentQueue.filter(car =>
        [STATUS_WAITING, STATUS_ATTENDING, STATUS_WAITING_GS].includes(car.status)
    );

    activeCars.sort((a, b) => {
        const priority = { [STATUS_ATTENDING]: 1, [STATUS_WAITING]: 2, [STATUS_WAITING_GS]: 3 };
        const priorityA = priority[a.status] || 4;
        const priorityB = priority[b.status] || 4;

        if (priorityA !== priorityB) return priorityA - priorityB;
        const timeA = a.timestamp?.seconds || 0;
        const timeB = b.timestamp?.seconds || 0;
        return timeA - timeB;
    });
    return activeCars;
}

function renderAlignmentQueue() {
    const tableContainer = document.getElementById('alignment-table-container');
    const emptyMessage = document.getElementById('alignment-empty-message');
    const activeCars = getSortedAlignmentQueue();

    if (activeCars.length === 0) {
        tableContainer.innerHTML = '';
        if (emptyMessage) emptyMessage.style.display = 'block';
        return;
    }
    if (emptyMessage) emptyMessage.style.display = 'none';

    const nextCarIndex = activeCars.findIndex(c => c.status === STATUS_WAITING);

    let tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50 sticky top-0 z-10">
                <tr>
                    <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                    <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Veículo</th>
                    <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Vendedor</th>
                    <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th class="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                    <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mover</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
    `;

    activeCars.forEach((car, index) => {
        const isNextWaiting = (index === nextCarIndex);
        const isWaiting = car.status === STATUS_WAITING;
        const isAttending = car.status === STATUS_ATTENDING;
        const isWaitingGS = car.status === STATUS_WAITING_GS;

        const statusColor = isAttending ? 'bg-yellow-100 text-yellow-800' :
                            isWaitingGS ? 'bg-red-100 text-red-800' :
                            'bg-blue-100 text-blue-800';
        const statusText = isAttending ? 'Em Atendimento' : isWaitingGS ? `Aguardando GS` : 'Disponível';
        const rowClass = isWaitingGS ? 'bg-red-50/30' : (isNextWaiting ? 'bg-yellow-50/30' : '');

        // Ícone de lixeira
        const discardIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
        
        // Ícone de retrabalho (chave inglesa)
        const reworkIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" /></svg>`;

        const deleteButton = (currentUserRole === MANAGER_ROLE) 
            ? `<button onclick="showDiscardAlignmentConfirmation('${car.id}')" title="Descartar" class="p-1 text-red-400 hover:text-red-600 transition">${discardIcon}</button>`
            : ``;

        // Botão de retrabalho só aparece se o carro veio de um serviço (tem serviceJobId)
        const reworkButton = (car.serviceJobId)
            ? `<button onclick="showReturnToMechanicModal('${car.id}')" title="Retornar ao Mecânico" class="p-1 text-orange-400 hover:text-orange-600 transition">${reworkIcon}</button>`
            : ``;

        let actions = '';
        if (isAttending) {
            actions = `
                <div class="flex items-center justify-end gap-1">
                    ${reworkButton}
                    ${deleteButton}
                    <button onclick="showAlignmentReadyConfirmation('${car.id}')" class="text-xs font-bold bg-green-500 text-white py-1 px-2 rounded hover:bg-green-600">Pronto</button>
                </div>
            `;
        } else if (isNextWaiting) {
            actions = `
                <div class="flex items-center justify-end gap-1">
                    ${deleteButton}
                    <button onclick="updateAlignmentStatus('${car.id}', '${STATUS_ATTENDING}')" class="text-xs font-bold bg-yellow-500 text-white py-1 px-2 rounded hover:bg-yellow-600">Iniciar</button>
                </div>
            `;
        } else {
            actions = `<div class="flex items-center justify-end gap-1">${deleteButton}</div>`;
        }

        // Botões de Mover (Gerente apenas)
        let moverButtons = '';
        const canMove = currentUserRole === MANAGER_ROLE && isWaiting;
        const waitingOnlyList = activeCars.filter(c => c.status === STATUS_WAITING);
        const waitingIndex = waitingOnlyList.findIndex(c => c.id === car.id);
        const isFirstWaiting = waitingIndex === 0;
        const isLastWaiting = waitingIndex === waitingOnlyList.length - 1;

        moverButtons = `
            <div class="flex flex-col sm:flex-row items-center justify-center">
                <button onclick="moveAlignmentUp('${car.id}')" class="text-gray-400 hover:text-blue-600 disabled:opacity-20 px-1" ${!canMove || isFirstWaiting ? 'disabled' : ''}>▲</button>
                <button onclick="moveAlignmentDown('${car.id}')" class="text-gray-400 hover:text-blue-600 disabled:opacity-20 px-1" ${!canMove || isLastWaiting ? 'disabled' : ''}>▼</button>
            </div>
        `;

        tableHTML += `
            <tr class="${rowClass} hover:bg-gray-50 transition-colors">
                <td class="px-3 py-3 whitespace-nowrap text-xs font-bold text-gray-500">${index + 1}</td>
                <td class="px-3 py-3 whitespace-nowrap">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-gray-900 uppercase">${car.licensePlate}</span>
                        <span class="text-xs text-gray-500 truncate max-w-[100px]">${car.carModel}</span>
                    </div>
                </td>
                <td class="px-3 py-3 whitespace-nowrap text-xs text-gray-500 hidden sm:table-cell">${car.vendedorName || '-'}</td>
                <td class="px-3 py-3 whitespace-nowrap">
                    <div class="flex flex-col items-start">
                        <span class="px-2 py-0.5 inline-flex text-[10px] leading-4 font-semibold rounded-full ${statusColor} border border-opacity-20 border-black">
                            ${statusText}
                        </span>
                        ${isWaitingGS ? `<span class="text-[10px] text-gray-400 mt-1 truncate max-w-[80px]" title="${car.gsDescription}">${car.gsDescription}</span>` : ''}
                    </div>
                </td>
                <td class="px-3 py-3 whitespace-nowrap text-right">${actions}</td>
                <td class="px-1 py-3 whitespace-nowrap text-center">${moverButtons}</td>
            </tr>
        `;
    });

    tableHTML += `</tbody></table>`;
    tableContainer.innerHTML = tableHTML;
}

// =========================================================================
// AÇÕES DO ALINHADOR (Adicionar, Mover, Status)
// =========================================================================
async function handleAddAlignment(e) {
    e.preventDefault();
    const vendedorName = document.getElementById('aliVendedorName').value;
    const licensePlate = document.getElementById('aliLicensePlate').value.trim().toUpperCase();
    const carModel = document.getElementById('aliCarModel').value.trim();

    if (!vendedorName || !licensePlate || !carModel) {
        return alertUser("Todos os campos são obrigatórios.");
    }

    const newAlignmentCar = {
        vendedorName,
        licensePlate,
        carModel,
        status: STATUS_WAITING,
        timestamp: serverTimestamp(),
        addedBy: currentUserName,
        type: 'Alinhamento',
        gsDescription: 'N/A (Adicionado Manualmente)',
    };

    try {
        await addDoc(collection(db, ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
        alertUser('Carro adicionado à fila!', 'success');
        document.getElementById('alignment-form').reset();
        document.getElementById('aliVendedorName').value = ""; 
    } catch (error) {
        console.error("Erro ao adicionar:", error);
        alertUser(`Erro: ${error.message}`);
    }
}

async function updateAlignmentStatus(docId, newStatus) {
    let dataToUpdate = { status: newStatus };
    if (newStatus === STATUS_ATTENDING) {
        dataToUpdate.alignmentStartedAt = serverTimestamp();
    } else if (newStatus === 'Done') { 
        dataToUpdate.status = STATUS_READY;
        dataToUpdate.readyAt = serverTimestamp();
    }

    try {
        await updateDoc(doc(db, ALIGNMENT_COLLECTION_PATH, docId), dataToUpdate);
    } catch (error) {
        console.error("Erro ao atualizar status:", error);
        alertUser(`Erro: ${error.message}`);
    }
}

async function discardAlignmentJob(docId) {
    try {
        await updateDoc(doc(db, ALIGNMENT_COLLECTION_PATH, docId), {
            status: STATUS_LOST,
            finalizedAt: serverTimestamp()
        });
        alertUser("Serviço descartado.", "success");
    } catch (error) {
        console.error("Erro ao descartar:", error);
    }
}

async function returnToMechanic(alignmentDocId, targetMechanic, shouldReturnToAlignment) {
    const alignmentJob = alignmentQueue.find(c => c.id === alignmentDocId);
    if (!alignmentJob || !alignmentJob.serviceJobId) return;

    try {
        // Atualiza o Serviço (Volta para o Mecânico)
        await updateDoc(doc(db, SERVICE_COLLECTION_PATH, alignmentJob.serviceJobId), {
            status: STATUS_PENDING,
            statusGS: STATUS_REWORK,
            assignedMechanic: targetMechanic,
            requiresAlignmentAfterRework: shouldReturnToAlignment,
            reworkRequestedBy: currentUserName,
            reworkRequestedAt: serverTimestamp()
        });

        // Remove da fila de alinhamento
        await updateDoc(doc(db, ALIGNMENT_COLLECTION_PATH, alignmentDocId), { status: STATUS_LOST });

        alertUser(`Serviço retornado para ${targetMechanic}.`, "success");
    } catch (error) {
        console.error("Erro ao retornar serviço:", error);
        alertUser("Erro ao salvar alterações.");
    }
}

// =========================================================================
// LÓGICA DE MODAIS
// =========================================================================
function handleConfirmAction() {
    const { id, confirmAction } = currentJobToConfirm;
    if (!id || !confirmAction) return hideConfirmationModal();

    if (confirmAction === "alignmentReady") updateAlignmentStatus(id, 'Done');
    if (confirmAction === "discardAlignment") discardAlignmentJob(id);

    hideConfirmationModal();
}

function showConfirmationModal(id, title, message, action, buttonClass = 'bg-green-600 hover:bg-green-700', buttonText = 'Sim, Confirmar') {
    currentJobToConfirm = { id, confirmAction: action };
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    
    const confirmButton = document.getElementById('confirm-button');
    confirmButton.className = `py-2 px-4 text-white font-semibold rounded-lg shadow-md transition ${buttonClass}`;
    confirmButton.textContent = buttonText;

    document.getElementById('confirmation-modal').classList.remove('hidden');
}

window.hideConfirmationModal = function() {
    document.getElementById('confirmation-modal').classList.add('hidden');
    currentJobToConfirm = { id: null, confirmAction: null };
}

window.showAlignmentReadyConfirmation = function(docId) {
    showConfirmationModal(docId, 'Concluir Alinhamento', 'O alinhamento está <strong>PRONTO</strong>?', 'alignmentReady');
}

window.showDiscardAlignmentConfirmation = function(docId) {
    const car = alignmentQueue.find(c => c.id === docId);
    showConfirmationModal(docId, 'Descartar Serviço', `Remover <strong>${car.licensePlate}</strong> da fila?`, 'discardAlignment', 'bg-red-600 hover:bg-red-700', 'Descartar');
}

window.showReturnToMechanicModal = function(docId) {
    const car = alignmentQueue.find(c => c.id === docId);
    if (!car || !car.serviceJobId) {
        alertUser("Erro: Este carro foi adicionado manualmente, não tem mecânico vinculado.");
        return;
    }
    currentAlignmentJobForRework = docId;
    document.getElementById('rework-modal-subtitle').textContent = `Carro: ${car.carModel} (${car.licensePlate})`;
    document.getElementById('rework-modal').classList.remove('hidden');
}

window.hideReturnToMechanicModal = function() {
    document.getElementById('rework-modal').classList.add('hidden');
    currentAlignmentJobForRework = null;
}

async function handleReturnToMechanic(e) {
    e.preventDefault();
    const docId = currentAlignmentJobForRework;
    if (!docId) return;

    const targetMechanic = document.getElementById('rework-mechanic-select').value;
    const shouldReturn = document.querySelector('input[name="rework-return-to-alignment"]:checked').value === 'Sim';

    await returnToMechanic(docId, targetMechanic, shouldReturn);
    hideReturnToMechanicModal();
}

// =========================================================================
// ORDENAÇÃO DA FILA (GERENTE)
// =========================================================================
function findAdjacentCar(currentIndex, direction) {
    const activeCars = getSortedAlignmentQueue();
    let adjacentIndex = currentIndex + direction;
    while(adjacentIndex >= 0 && adjacentIndex < activeCars.length) {
        if (activeCars[adjacentIndex].status === STATUS_WAITING) return activeCars[adjacentIndex];
        adjacentIndex += direction;
    }
    return null;
}

async function moveAlignmentUp(docId) {
    if (currentUserRole !== MANAGER_ROLE) return alertUser("Apenas Gerentes podem mover a fila.");
    const sortedQueue = getSortedAlignmentQueue();
    const index = sortedQueue.findIndex(car => car.id === docId);
    if (index === -1) return;

    const carBefore = findAdjacentCar(index, -1);
    if (!carBefore) return alertUser("Já está no topo.");

    const newTimestamp = Timestamp.fromMillis((carBefore.timestamp.seconds * 1000) - 1000);
    try {
        await updateDoc(doc(db, ALIGNMENT_COLLECTION_PATH, docId), { timestamp: newTimestamp });
    } catch (e) { console.error(e); }
}

async function moveAlignmentDown(docId) {
    if (currentUserRole !== MANAGER_ROLE) return alertUser("Apenas Gerentes podem mover a fila.");
    const sortedQueue = getSortedAlignmentQueue();
    const index = sortedQueue.findIndex(car => car.id === docId);
    if (index === -1) return;

    const carAfter = findAdjacentCar(index, +1);
    if (!carAfter) return alertUser("Já é o último.");

    const newTimestamp = Timestamp.fromMillis((carAfter.timestamp.seconds * 1000) + 1000);
    try {
        await updateDoc(doc(db, ALIGNMENT_COLLECTION_PATH, docId), { timestamp: newTimestamp });
    } catch (e) { console.error(e); }
}

// =========================================================================
// UTILITÁRIOS E INICIALIZAÇÃO
// =========================================================================
function alertUser(message, type = 'error') {
    const errorElement = document.getElementById('alignment-error');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.className = `mt-3 text-center text-sm font-medium ${type === 'success' ? 'text-green-600' : 'text-red-600'}`;
        setTimeout(() => errorElement.textContent = '', 5000);
    } else {
        if(type === 'error') alert(message);
    }
}

// PWA Installation Logic
let deferredPrompt;
const installButton = document.getElementById('install-pwa-btn');
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if(installButton) {
        installButton.classList.remove('hidden');
        installButton.classList.add('flex');
    }
});
if(installButton) {
    installButton.addEventListener('click', async () => {
        if(deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt = null;
            installButton.classList.add('hidden');
        }
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

// Expor funções para HTML
window.updateAlignmentStatus = updateAlignmentStatus;
window.moveAlignmentUp = moveAlignmentUp;
window.moveAlignmentDown = moveAlignmentDown;

// Inicia App
initializeAppAndAuth();