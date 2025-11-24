import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, addDoc, updateDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// MUDANÇA 1: Importação limpa
import { registerForPushNotifications } from './push.js';

// =========================================================================
// CONFIGURAÇÃO E ESTADO GLOBAL
// =========================================================================
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
const auth = getAuth(app); 

// --- Constantes de Papéis e Status ---
const ALIGNER_ROLE = 'aligner';
const MANAGER_ROLE = 'manager';
const VENDEDOR_ROLE = 'vendedor';
const MECANICO_ROLE = 'mecanico';

const STATUS_WAITING_GS = 'Aguardando Serviço Geral';
const STATUS_WAITING = 'Aguardando';
const STATUS_ATTENDING = 'Em Atendimento';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_LOST = 'Perdido';
const STATUS_PENDING = 'Pendente';
const STATUS_REWORK = 'Em Retrabalho';

// --- Coleções do Firestore ---
const APP_ID = 'local-autocenter-app';
const ALIGNMENT_COLLECTION_PATH = `artifacts/${APP_ID}/public/data/alignmentQueue`;
const SERVICE_COLLECTION_PATH = `artifacts/${APP_ID}/public/data/serviceJobs`;
const USERS_COLLECTION_PATH = `artifacts/${APP_ID}/public/data/users`;

// --- Estado da Aplicação ---
let currentUserRole = null;
let currentUserName = null;
let alignmentQueue = [];
let mecanicosGeral = [];
let vendedores = [];
let currentJobToConfirm = { id: null, confirmAction: null };
let currentAlignmentJobForRework = null;
let deferredInstallPrompt = null; 

// =========================================================================
// INICIALIZAÇÃO E AUTENTICAÇÃO
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const savedUser = localStorage.getItem('currentUser');

    if (!savedUser) {
        window.location.href = 'auth.html';
        return;
    }

    const user = JSON.parse(savedUser);
    if (user.role !== ALIGNER_ROLE && user.role !== MANAGER_ROLE) {
        alert('Acesso negado. Esta área é restrita para Alinhadores e Gerentes.');
        localStorage.removeItem('currentUser');
        window.location.href = 'auth.html';
        return;
    }
    
    try {
        await signInAnonymously(auth);
        console.log("Autenticação anônima com Firebase bem-sucedida.");
        
        postLoginSetup(user);

    } catch (error) {
        console.error("Erro na autenticação anônima com Firebase:", error);
        alert("Falha ao conectar com o servidor. Verifique o console e tente recarregar a página.");
    }
});

function postLoginSetup(user) {
    currentUserRole = user.role;
    currentUserName = user.username;

    // Listeners do Banco
    setupRealtimeListeners(); 
    setupUserListener();
    setupServiceWorkerListener();
    
    // Configuração dos Botões
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    const alignForm = document.getElementById('alignment-form');
    if (alignForm) alignForm.addEventListener('submit', handleAddAlignment);

    const reworkForm = document.getElementById('rework-form');
    if (reworkForm) reworkForm.addEventListener('submit', handleReturnToMechanic);

    const confirmBtn = document.getElementById("confirm-button");
    if (confirmBtn) confirmBtn.addEventListener("click", handleConfirmAction);

    // MUDANÇA 2: Registra Push enviando QUEM é o usuário
    // Isso garante que o token seja salvo com 'aligner' ou 'manager' no banco
    registerForPushNotifications(user.role, user.username);

    try {
        setupPwaInstallHandlers(); 
    } catch (error) {
        console.warn("Aviso: Botão de instalação PWA não configurado.", error);
    }
}

function handleLogout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'auth.html';
}

// =========================================================================
// SERVICE WORKER E NOTIFICAÇÕES (CLIENT-SIDE)
// =========================================================================

function setupPwaInstallHandlers() {
    const installButton = document.getElementById('install-pwa-btn');

    if (window.matchMedia('(display-mode: standalone)').matches) {
        return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); 
        deferredInstallPrompt = e; 
        installButton.classList.remove('hidden'); 
    });

    installButton.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt(); 
            const { outcome } = await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            installButton.classList.add('hidden');
        }
    });

    window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; });
}

function setupServiceWorkerListener() {
    // MUDANÇA 3: Atualizado para ouvir o evento PLAY_SOUND (Maiúsculo)
    // Isso deve bater com o que colocamos no service-worker.js
    navigator.serviceWorker.addEventListener('message', event => {
        console.log('Página: Mensagem recebida do Service Worker:', event.data);
        
        // Verifica PLAY_SOUND (novo padrão) ou play-sound (legado)
        if (event.data && (event.data.type === 'PLAY_SOUND' || event.data.type === 'play-sound')) {
            console.log("🔊 Tocando notificação sonora...");
            const notificationSound = new Audio('sounds/notify.mp3');
            notificationSound.volume = 1.0;
            notificationSound.play().catch(error => {
                console.warn('Não foi possível tocar o som (bloqueio do navegador):', error);
                // Fallback visual opcional
                alertUser('Nova notificação recebida!', 'success');
            });
        }
    });
}

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
    }, (error) => {
        console.error("Erro no listener de Usuários:", error);
        alertUser("Erro de conexão ao buscar usuários.");
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
        console.error("Erro no listener de Alinhamento:", error);
        alertUser("Erro de conexão com o banco de dados.");
    });
}

function populateDropdowns() {
    if (currentUserRole === MANAGER_ROLE || currentUserRole === ALIGNER_ROLE) {
        const vendedorSelect = document.getElementById('aliVendedorName');
        if (vendedorSelect) {
            vendedorSelect.disabled = false; 
            vendedorSelect.innerHTML = vendedores.map(v => `<option value="${v.username}">${v.username}</option>`).join('');
        }
    }
    
    const reworkMechanicSelect = document.getElementById('rework-mechanic-select');
    if (reworkMechanicSelect) {
        reworkMechanicSelect.innerHTML = mecanicosGeral.map(m => `<option value="${m.username}">${m.username}</option>`).join('');
    }
}

// =========================================================================
// RENDERIZAÇÃO DA FILA DE ALINHAMENTO
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
        if(emptyMessage) emptyMessage.style.display = 'block';
        return;
    }
    
    if(emptyMessage) emptyMessage.style.display = 'none';

    const nextCarIndex = activeCars.findIndex(c => c.status === STATUS_WAITING);

    let tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modelo / Placa</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendedor</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mover</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
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
        const rowClass = isWaitingGS ? 'bg-red-50/50' : (isNextWaiting ? 'bg-yellow-50/50' : '');

        const discardIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
        const returnIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>`;

        let actions = '';
        if (isAttending) {
            actions = `
                <button onclick="showReturnToMechanicModal('${car.id}')" title="Retornar ao Mecânico" class="p-2 text-blue-600 hover:bg-blue-100 rounded-full transition" ${!car.serviceJobId ? 'disabled' : ''}>${returnIcon}</button>
                <button onclick="showDiscardAlignmentConfirmation('${car.id}')" title="Descartar / Perdido" class="p-1 text-red-600 hover:bg-red-100 rounded-full transition">${discardIcon}</button>
                <button onclick="showAlignmentReadyConfirmation('${car.id}')" class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-md hover:bg-green-600 transition">Pronto</button>
            `;
        } else if (isNextWaiting) {
            actions = `
                <button onclick="showReturnToMechanicModal('${car.id}')" title="Retornar ao Mecânico" class="p-2 text-blue-600 hover:bg-blue-100 rounded-full transition" ${!car.serviceJobId ? 'disabled' : ''}>${returnIcon}</button>
                <button onclick="showDiscardAlignmentConfirmation('${car.id}')" title="Descartar / Perdido" class="p-1 text-red-600 hover:bg-red-100 rounded-full transition">${discardIcon}</button>
                <button onclick="updateAlignmentStatus('${car.id}', '${STATUS_ATTENDING}')" class="text-xs font-medium bg-yellow-500 text-white py-1 px-3 rounded-md hover:bg-yellow-600 transition">Iniciar</button>
            `;
        } else {
            actions = `
                <button onclick="showReturnToMechanicModal('${car.id}')" title="Retornar ao Mecânico" class="p-2 text-blue-600 hover:bg-blue-100 rounded-full transition" ${!car.serviceJobId ? 'disabled' : ''}>${returnIcon}</button>
                <button onclick="showDiscardAlignmentConfirmation('${car.id}')" title="Descartar / Perdido" class="p-1 text-red-600 hover:bg-red-100 rounded-full transition">${discardIcon}</button>
                <span class="text-xs text-gray-400 pr-2">Na fila...</span>
            `;
        }

        let moverButtons = '';
        const canMove = currentUserRole === MANAGER_ROLE && isWaiting;

        const waitingOnlyList = activeCars.filter(c => c.status === STATUS_WAITING);
        const waitingIndex = waitingOnlyList.findIndex(c => c.id === car.id);
        const isLastWaiting = waitingIndex === waitingOnlyList.length - 1;
        const isFirstWaiting = waitingIndex === 0;

        moverButtons = `
            <div class="flex items-center justify-center space-x-1">
                <button onclick="moveAlignmentUp('${car.id}')"
                        class="text-sm p-1 rounded-full text-blue-600 hover:bg-gray-200 disabled:text-gray-300 transition"
                        ${!canMove || isFirstWaiting ? 'disabled' : ''} title="Mover para cima">&#9650;</button>
                <button onclick="moveAlignmentDown('${car.id}')"
                        class="text-sm p-1 rounded-full text-blue-600 hover:bg-gray-200 disabled:text-gray-300 transition"
                        ${!canMove || isLastWaiting ? 'disabled' : ''} title="Mover para baixo">&#9660;</button>
            </div>
        `;

        tableHTML += `
            <tr class="${rowClass}">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${index + 1}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    <span class="font-semibold">${car.carModel}</span>
                    <span class="text-xs text-gray-500 block">${car.licensePlate}</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${car.vendedorName || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex flex-col">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor} self-start">${statusText}</span>
                        ${isWaitingGS ? `<div class="text-xs text-gray-500 pt-1 description-truncate" title="${car.gsDescription}">${car.gsDescription}</div>` : ''}
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">${moverButtons}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div class="flex items-center space-x-2 justify-end">${actions}</div>
                </td>
            </tr>
        `;
    });

    tableHTML += `</tbody></table>`;
    tableContainer.innerHTML = tableHTML;
}

// =========================================================================
// AÇÕES DO USUÁRIO (Formulários e Botões)
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
        alertUser('Carro adicionado à fila de alinhamento!', 'success');
        document.getElementById('alignment-form').reset();
    } catch (error) {
        console.error("Erro ao adicionar à fila:", error);
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
        const docRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
        await updateDoc(docRef, dataToUpdate);
    } catch (error) {
        console.error("Erro ao atualizar status:", error);
        alertUser(`Erro no Banco de Dados: ${error.message}`);
    }
}

async function discardAlignmentJob(docId) {
    const dataToUpdate = {
        status: STATUS_LOST,
        finalizedAt: serverTimestamp()
    };
    try {
        const docRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
        await updateDoc(docRef, dataToUpdate);
        alertUser("Serviço de alinhamento marcado como 'Perdido'.", "success");
    } catch (error) {
        console.error("Erro ao descartar alinhamento:", error);
        alertUser("Erro ao atualizar o status no banco de dados.");
    }
}

async function returnToMechanic(alignmentDocId, targetMechanic, shouldReturnToAlignment) {
    const alignmentJob = alignmentQueue.find(c => c.id === alignmentDocId);
    if (!alignmentJob || !alignmentJob.serviceJobId) return;

    const serviceJobId = alignmentJob.serviceJobId;

    const serviceUpdate = {
        status: STATUS_PENDING,
        statusGS: STATUS_REWORK,
        assignedMechanic: targetMechanic,
        requiresAlignmentAfterRework: shouldReturnToAlignment,
        reworkRequestedBy: currentUserName,
        reworkRequestedAt: serverTimestamp()
    };

    const alignmentUpdate = { status: STATUS_LOST };

    try {
        const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, serviceJobId);
        await updateDoc(serviceDocRef, serviceUpdate);

        const alignmentDocRef = doc(db, ALIGNMENT_COLLECTION_PATH, alignmentDocId);
        await updateDoc(alignmentDocRef, alignmentUpdate);

        alertUser(`Serviço retornado para ${targetMechanic}.`, "success");
    } catch (error) {
        console.error("Erro ao retornar serviço:", error);
        alertUser("Erro ao salvar as alterações no banco de dados.");
    }
}

// =========================================================================
// LÓGICA DOS MODAIS
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
    showConfirmationModal(docId, 'Confirmar Alinhamento Concluído', 'Tem certeza que o alinhamento está <strong>PRONTO</strong> e deve ser enviado para a gerência?', 'alignmentReady');
}

window.showDiscardAlignmentConfirmation = function(docId) {
    const car = alignmentQueue.find(c => c.id === docId);
    showConfirmationModal(docId, 'Descartar Serviço', `Deseja marcar o alinhamento do carro <strong>${car.licensePlate}</strong> como 'Perdido'?`, 'discardAlignment', 'bg-red-600 hover:bg-red-700', 'Sim, Descartar');
}

window.showReturnToMechanicModal = function(docId) {
    const car = alignmentQueue.find(c => c.id === docId);
    if (!car || !car.serviceJobId) {
        alertUser("Ação não permitida: Este serviço foi adicionado manualmente e não pode retornar a um mecânico.");
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
// FUNÇÕES DE ORDENAÇÃO (GERENTE) E UTILITÁRIOS
// =========================================================================
function findAdjacentCar(currentIndex, direction) {
    const activeCars = getSortedAlignmentQueue();

    let adjacentIndex = currentIndex + direction;
    while(adjacentIndex >= 0 && adjacentIndex < activeCars.length) {
        if (activeCars[adjacentIndex].status === STATUS_WAITING) {
            return activeCars[adjacentIndex];
        }
        adjacentIndex += direction;
    }
    return null;
}

async function moveAlignmentUp(docId) {
    if (currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado. Apenas Gerentes podem mover carros na fila.");

    const sortedQueue = getSortedAlignmentQueue();
    const index = sortedQueue.findIndex(car => car.id === docId);
    if (index === -1 || sortedQueue[index].status !== STATUS_WAITING) return;

    const carBefore = findAdjacentCar(index, -1);
    if (!carBefore) return alertUser("Este carro já está no topo da fila de espera.");

    const newTimeMillis = (carBefore.timestamp.seconds * 1000) - 1000;
    const newTimestamp = Timestamp.fromMillis(newTimeMillis);

    try {
        const docRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
        await updateDoc(docRef, { timestamp: newTimestamp });
        alertUser("Ordem da fila atualizada.", "success");
    } catch (e) {
        console.error("Erro ao mover para cima:", e);
        alertUser("Erro ao atualizar a ordem no banco de dados.");
    }
}

async function moveAlignmentDown(docId) {
    if (currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado. Apenas Gerentes podem mover carros na fila.");

    const sortedQueue = getSortedAlignmentQueue();
    const index = sortedQueue.findIndex(car => car.id === docId);
    if (index === -1 || sortedQueue[index].status !== STATUS_WAITING) return;

    const carAfter = findAdjacentCar(index, +1);
    if (!carAfter) return alertUser("Este carro já é o último na fila de espera.");

    const newTimeMillis = (carAfter.timestamp.seconds * 1000) + 1000;
    const newTimestamp = Timestamp.fromMillis(newTimeMillis);

    try {
        const docRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
        await updateDoc(docRef, { timestamp: newTimestamp });
        alertUser("Ordem da fila atualizada.", "success");
    } catch (e) {
        console.error("Erro ao mover para baixo:", e);
        alertUser("Erro ao atualizar a ordem no banco de dados.");
    }
}

function alertUser(message, type = 'error') {
    const errorElement = document.getElementById('alignment-error');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.className = `mt-3 text-center text-sm font-medium ${type === 'success' ? 'text-green-600' : 'text-red-600'}`;
        setTimeout(() => errorElement.textContent = '', 5000);
    } else {
        alert(message);
    }
}

// Expondo funções globais chamadas pelo HTML
window.updateAlignmentStatus = updateAlignmentStatus;
window.moveAlignmentUp = moveAlignmentUp;
window.moveAlignmentDown = moveAlignmentDown;
window.handleLogout = handleLogout;