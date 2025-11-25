import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp, setLogLevel, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; // CORREÇÃO: Removendo import duplicado

// =========================================================================
// CONFIGURAÇÃO FIREBASE
// =========================================================================
const isCanvasEnvironment = typeof __app_id !== 'undefined';
const LOCAL_APP_ID = 'local-autocenter-app';

const appId = isCanvasEnvironment ? (typeof __app_id !== 'undefined' ? __app_id : LOCAL_APP_ID) : LOCAL_APP_ID;

// --- Configuração do Firebase (copiada do auth.js) ---
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
const app = initializeApp(firebaseConfig); // CORREÇÃO: Usar a config correta
const initialAuthToken = (isCanvasEnvironment && typeof __initial_auth_token !== 'undefined') ? __initial_auth_token : null; // CORREÇÃO: Removendo import duplicado
// --- Constantes ---
const CLIENT_ROLE = 'cliente';

let db;
let auth;
let analytics;
let userId = 'loading';
let isAuthReady = false;
let isDemoMode = false;

if (firebaseConfig.apiKey === "SUA_API_KEY_AQUI") {
    console.warn("Chaves do Firebase não configuradas. Entrando no Modo Demo.");
    isDemoMode = true;
}

// =========================================================================
// AUTENTICAÇÃO E PERMISSÕES
// =========================================================================
const USER_CREDENTIALS = {
    'gerente.outlet': { password: 'gerenteitapoa', role: 'manager' },
    'alinhador': { password: 'alinhador123', role: 'aligner' },
};
// ATUALIZADO: Novos papéis (Req 1.1)
const MANAGER_ROLE = 'manager';
const ALIGNER_ROLE = 'aligner';
const VENDEDOR_ROLE = 'vendedor';
const MECANICO_ROLE = 'mecanico';

let currentUserRole = null;
let currentUserName = null; // NOVO: Para armazenar o nome do usuário logado
let isLoggedIn = false;

// =========================================================================
// ESTADO GLOBAL
// =========================================================================
let systemUsers = []; // NOVO: Armazena todos os usuários do Firestore (Req 2.2)
let vendedores = []; // NOVO: Lista de vendedores para dropdowns
let mecanicosGeral = []; // NOVO: Lista de mecânicos para dropdowns

let serviceJobs = [];
let alignmentQueue = [];
let jobIdCounter = 100;
let aliIdCounter = 200;

let currentJobToDefineId = null;
let currentJobToEditId = null;
let currentJobToConfirm = { id: null, type: null, confirmAction: null, serviceType: null };
let currentAlignmentJobForRework = null; // NOVO: Para o modal de retorno
let currentUserToEditId = null; // NOVO: Para edição de usuário
let lastAssignedMechanicIndex = -1; // NOVO: Para o rodízio de mecânicos (Req 3.1)

// NOVO: Estado para o filtro de período do histórico
let historyPeriod = 'daily'; // 'daily', 'weekly', 'monthly', 'yearly'
let historyDate = null; // NOVO: Para armazenar a data selecionada no filtro diário
let historyMonth = new Date().getMonth(); // NOVO: Para o filtro mensal
let historyYear = new Date().getFullYear(); // NOVO: Para os filtros mensal e anual

// NOVO: Variável global para a lista de histórico detalhado, para ser usada pelo exportador de PDF.
let detailedHistoryList = [];
let performanceList = []; // NOVO: Movido para o escopo global para ser acessível pelo exportador de PDF.
let lostHistoryList = []; // NOVO: Movido para o escopo global para ser acessível pelo exportador de PDF.

// NOVO: Variáveis de métricas movidas para o escopo global para serem acessíveis pelo exportador de PDF.
let allWaitTimes = [];
let allGsDurations = [];
let allTsDurations = [];
let allAliDurations = [];
let mechanicStats = {}; // NOVO: Movido para o escopo global para ser acessível pelo exportador de PDF.

// NOVO: Armazena os objetos de dados para os destaques do dashboard, para que possam ser clicados.
let dashboardHighlightData = {
    bestPerformer: null,
    worstPerformer: null,
    slowestCar: null,
    fastestCar: null,
};

let MECHANICS = ['José', 'Wendell']; // MANTIDO: Como fallback inicial, será substituído pelo Firestore
const TIRE_SHOP_MECHANIC = 'Borracheiro';
const ALIGNMENT_MECHANIC = 'Alinhador'; // NOVO: Constante para o Alinhador

// COLEÇÕES DO FIRESTORE
const SERVICE_COLLECTION_PATH = `/artifacts/${appId}/public/data/serviceJobs`;
const ALIGNMENT_COLLECTION_PATH = `/artifacts/${appId}/public/data/alignmentQueue`;
// CORREÇÃO: Movendo a coleção de usuários para um caminho com permissão.
const USERS_COLLECTION_PATH = `/artifacts/${appId}/public/data/users`;

// STATUS GLOBAIS
const STATUS_PENDING = 'Pendente';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_FINALIZED = 'Finalizado';
const STATUS_LOST = 'Perdido';

// STATUS DE SERVIÇO GERAL (GS)
const STATUS_GS_FINISHED = 'Serviço Geral Concluído';
const STATUS_TS_FINISHED = 'Serviço Pneus Concluído';
const STATUS_REWORK = 'Em Retrabalho'; // NOVO: Para serviços que voltam do alinhamento

// STATUS DE ALINHAMENTO
const STATUS_WAITING_GS = 'Aguardando Serviço Geral';
const STATUS_WAITING = 'Aguardando';
const STATUS_ATTENDING = 'Em Atendimento';

// ------------------------------------
// 1. Configuração e Autenticação
// ------------------------------------

function postLoginSetup(user) {
    const { username, role } = user;
    isLoggedIn = true;
    currentUserRole = role;
    currentUserName = username;

    document.getElementById('main-content').classList.remove('hidden');

    // Salva sessão no localStorage (Req 1.3)
    // A sessão já foi salva pelo módulo de autenticação
    localStorage.setItem('currentUser', JSON.stringify(user));
    document.getElementById('user-info').textContent = `Usuário: ${username} | Cargo: ${role.toUpperCase()}`;

    // O título agora é estático no HTML, não precisa mais ser definido aqui.

    const tabServicos = document.getElementById('tab-servicos');
    const tabAlinhamento = document.getElementById('tab-alinhamento');
    const tabMonitor = document.getElementById('tab-monitor');
    const btnMarketing = document.getElementById('btn-marketing'); // RF004 - CORRIGIDO para usar o ID do botão
    const tabAdmin = document.getElementById('tab-admin');

    const contentServicos = document.getElementById('servicos');
    const contentAlinhamento = document.getElementById('alinhamento');
    const contentMonitor = document.getElementById('monitor');
    const contentAdmin = document.getElementById('admin');
    const mechanicView = document.getElementById('mechanic-view');
    const mainNav = document.getElementById('main-nav');

    const alignmentForm = document.getElementById('alignment-form');
    const alignmentFormTitle = document.getElementById('alignment-form-title');

    // **CORREÇÃO:** Limpeza e centralização do reset da UI.
    [tabServicos, tabAlinhamento, tabMonitor, tabAdmin, btnMarketing, alignmentForm, alignmentFormTitle, mechanicView].forEach(el => el.classList.add('hidden'));
    [contentServicos, contentAlinhamento, contentMonitor, contentAdmin, mechanicView].forEach(el => el.classList.remove('active'));
    mainNav.classList.remove('hidden');

    if (role === ALIGNER_ROLE) {
        // ATUALIZADO: Alinhador agora pode adicionar carros, como o vendedor.
        // Esconde as outras abas principais.
        [tabServicos, tabMonitor, tabAdmin, btnMarketing].forEach(el => el.classList.add('hidden'));

        // Mostra a aba de alinhamento e o formulário de adição.
        [tabAlinhamento, alignmentForm, alignmentFormTitle].forEach(el => el.classList.remove('hidden'));

        // Define a aba de alinhamento como a ativa.
        tabAlinhamento.classList.remove('hidden');
        contentServicos.classList.remove('active');
        contentMonitor.classList.remove('active');
        tabAlinhamento.classList.add('active');
        contentAlinhamento.classList.add('active');

    } else if (role === MANAGER_ROLE) {
        [tabServicos, tabAlinhamento, tabMonitor, tabAdmin, btnMarketing, alignmentForm, alignmentFormTitle].forEach(el => el.classList.remove('hidden', 'aligner-hidden'));
        alignmentFormTitle.textContent = "Adicionar Manualmente à Fila de Alinhamento";

        tabServicos.classList.add('active');
        contentServicos.classList.add('active');
        tabAlinhamento.classList.remove('active');
        contentAlinhamento.classList.remove('active');

    } else if (role === VENDEDOR_ROLE) {
        // Req 1.4: Visão do Vendedor
        [tabServicos, tabAlinhamento, alignmentForm, alignmentFormTitle].forEach(el => el.classList.remove('hidden', 'aligner-hidden'));
        [tabMonitor, tabAdmin].forEach(el => el.classList.add('hidden'));

        tabServicos.classList.add('active');
        contentServicos.classList.add('active');

        // Pré-seleciona e desabilita o campo vendedor
        const vendedorSelect = document.getElementById('vendedorName');
        vendedorSelect.value = username;
        vendedorSelect.disabled = true;
        const aliVendedorSelect = document.getElementById('aliVendedorName');
        aliVendedorSelect.value = username;
        aliVendedorSelect.disabled = true;

        // CORREÇÃO: Garante que a lista de mecânicos seja renderizada
        // para o vendedor na inicialização. A função renderMechanicsManagement
        // é chamada mais abaixo, mas a lista de títulos precisa ser
        // atualizada aqui para a primeira renderização.
        // O título agora é estático no HTML.

    } else if (role === MECANICO_ROLE) { // **CORREÇÃO:** Restaurando a visão do mecânico.
        mainNav.classList.add('hidden'); // Esconde a navegação principal
        // Garante que nenhum conteúdo principal esteja ativo
        [contentServicos, contentAlinhamento, contentMonitor, contentAdmin].forEach(el => el.classList.remove('active'));
        // Mostra a visão do mecânico
        mechanicView.classList.remove('hidden');
        mechanicView.classList.add('active');
    }

    renderMechanicsManagement();

    if (!isDemoMode) {
        setupRealtimeListeners();
        setupUserListener(); // CORREÇÃO: Chamada centralizada aqui.
    }

    renderServiceQueues(serviceJobs);
    renderAlignmentQueue(alignmentQueue);
    renderAlignmentMirror(alignmentQueue);
    renderReadyJobs(serviceJobs, alignmentQueue);
    createReworkModal(); // NOVO: Garante que o modal de retorno exista
    calculateAndRenderDashboard(); // ATUALIZADO: Chamando o novo dashboard
}

window.handleLogout = function() {
    isLoggedIn = false;
    currentUserRole = null;
    currentUserName = null;
    localStorage.removeItem('currentUser'); // Limpa a sessão (Req 1.3)
    // Redireciona para a página de login centralizada
    window.location.href = '../auth/index.html';
}

function initializeFirebase() {
    document.getElementById('main-content').classList.add('hidden'); // Esconde o conteúdo principal inicialmente
    // Verifica se há um usuário na sessão. Se não, redireciona para o login.
    const savedUser = localStorage.getItem('currentUser');
    if (!savedUser) {

        window.location.href = '../auth/index.html'; // Redireciona para login se não houver sessão
        return; // Para a execução para evitar erros
    } 

    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        analytics = getAnalytics(app);

        // Como a autenticação já foi feita, apenas lemos os dados e iniciamos o sistema
        const user = JSON.parse(savedUser); // Lê o usuário da sessão
        isAuthReady = true;
        postLoginSetup(user); // Configura a UI com os dados do usuário

    } catch (e) {
        console.error("Erro ao inicializar Firebase:", e);
        document.getElementById('main-content').classList.remove('hidden');
        document.getElementById('service-error').textContent = `Erro Fatal: Falha na inicialização do Firebase. Verifique a console.`;
    }
}

// ------------------------------------
// 1.2. Gerenciamento de Usuários (Admin)
// ------------------------------------

async function handleCreateUser(e) {
    e.preventDefault();
    if (currentUserRole !== MANAGER_ROLE) return;

    const username = document.getElementById('new-user-name').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;
    const messageEl = document.getElementById('create-user-message');

    if (!username || !password || !role) {
        messageEl.textContent = "Todos os campos são obrigatórios.";
        messageEl.className = 'mt-3 text-center text-sm font-medium text-red-600';
        return;
    }

    try {
        // Usamos o username como ID do documento para facilitar a verificação de duplicados
        const userRef = doc(db, USERS_COLLECTION_PATH, username);
        await setDoc(userRef, { username, password, role });
        messageEl.textContent = `Usuário '${username}' criado com sucesso!`;
        messageEl.className = 'mt-3 text-center text-sm font-medium text-green-600';
        document.getElementById('create-user-form').reset();
    } catch (error) {
        console.error("Erro ao criar usuário:", error);
        messageEl.textContent = "Erro ao criar usuário. Tente novamente.";
        messageEl.className = 'mt-3 text-center text-sm font-medium text-red-600';
    }
}

// NOVO: Função para deletar usuário (Req 2.3)
async function deleteUser(userId) {
    if (currentUserRole !== MANAGER_ROLE) return;

    const userToDelete = systemUsers.find(u => u.id === userId);
    if (!userToDelete || userToDelete.role === MANAGER_ROLE) {
        alertUser("Ação não permitida. Não é possível excluir gerentes.");
        return;
    }

    if (isDemoMode) {
        systemUsers = systemUsers.filter(u => u.id !== userId);
        renderUserList(systemUsers);
        alertUser(`MODO DEMO: Usuário ${userId} removido da lista.`);
    } else {
        try {
            await deleteDoc(doc(db, USERS_COLLECTION_PATH, userId));
            alertUser(`Usuário ${userId} excluído com sucesso.`);
        } catch (error) {
            console.error("Erro ao excluir usuário:", error);
            alertUser("Erro ao conectar com o banco de dados para excluir usuário.");
        }
    }
}

function renderUserList(users) {
    const container = document.getElementById('user-list-container');
    const emptyMessage = document.getElementById('user-list-empty-message');

    // HOTFIX 2: Se o container ou a mensagem não existem (ex: visão de vendedor), não faz nada.
    if (!container || !emptyMessage) return;

    if (users.length === 0) { // A verificação de usuários vem DEPOIS da verificação dos elementos.
        container.innerHTML = '';
        container.appendChild(emptyMessage);
        emptyMessage.style.display = 'block';
        return;
    }

    emptyMessage.style.display = 'none';
    // Ícones para os botões de ação
    const deleteIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;
    const editIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.536L16.732 3.732z" /></svg>`;

    container.innerHTML = `
        <ul class="divide-y divide-gray-200">
            ${users.map(user => `
                <li class="p-4 flex justify-between items-center">
                    <div>
                        <p class="text-sm font-medium text-gray-900">${user.username}</p>
                        <p class="text-sm text-gray-500">${user.role}</p>
                    </div>
                    <div class="flex items-center space-x-2">
                        ${user.role !== MANAGER_ROLE ? `
                            <button onclick="showEditUserModal('${user.id}')" title="Editar Usuário" class="p-2 text-blue-500 hover:bg-blue-100 rounded-full transition-colors">                                        ${editIcon}
                            </button>
                            <button onclick="showDeleteUserConfirmation('${user.id}')" title="Excluir Usuário" class="p-2 text-red-500 hover:bg-red-100 rounded-full transition-colors">
                                ${deleteIcon}
                            </button>
                        ` : `
                            <span class="text-xs text-gray-400 italic pr-2">Ações desabilitadas para Gerente</span>
                        `}
                    </div>
                </li>
            `).join('')}
        </ul>`;
}
// ------------------------------------
// 1.5. Gerenciamento de Mecânicos
// ------------------------------------

function renderMechanicsManagement() {
    const manualSelect = document.getElementById('manualMechanic');
    const editSelect = document.getElementById('edit-assignedMechanic');
    const vendedorSelect = document.getElementById('vendedorName');
    const aliVendedorSelect = document.getElementById('aliVendedorName');

    MECHANICS = mecanicosGeral.map(u => u.username); // Atualiza a lista de mecânicos

    // O título agora é estático no HTML, não precisa mais ser definido aqui.

    let optionsHTML = '<option value="">-- Automático --</option>';
    optionsHTML += MECHANICS.map(m => `<option value="${m}">${m}</option>`).join('');

    if (manualSelect) manualSelect.innerHTML = optionsHTML;
    if (editSelect) editSelect.innerHTML = MECHANICS.map(m => `<option value="${m}">${m}</option>`).join('');

    // Popula dropdowns de vendedores (Req 6.2)
    const vendedorOptionsHTML = vendedores.map(v => `<option value="${v.username}">${v.username}</option>`).join('');
    if (vendedorSelect) vendedorSelect.innerHTML = vendedorOptionsHTML;
    if (aliVendedorSelect) aliVendedorSelect.innerHTML = vendedorOptionsHTML;


    renderServiceQueues(serviceJobs);
    calculateAndRenderDashboard(); // ATUALIZADO
}


// ------------------------------------
// 2. Lógica de Atribuição e Persistência
// ------------------------------------

// NOVO: Lógica de atribuição Round-Robin (Req 3.1)
function getNextMechanicInRotation() {
    if (MECHANICS.length === 0) {
        throw new Error("Nenhum mecânico (Geral) ativo para atribuição.");
    }

    // CORREÇÃO: Garante que a lista de mecânicos esteja sempre na mesma ordem (alfabética)
    // para que o rodízio (lastAssignedMechanicIndex) funcione de forma consistente.
    const sortedMechanics = [...MECHANICS].sort();

    // NOVO: Carrega o último índice salvo do localStorage
    let lastIndex = parseInt(localStorage.getItem('lastAssignedMechanicIndex'), 10);
    if (isNaN(lastIndex)) {
        lastIndex = -1;
    }

    // Incrementa o índice para pegar o próximo mecânico
    lastIndex++;

    // Se o índice passar do tamanho do array, volta para o início (rodízio)
    if (lastIndex >= sortedMechanics.length) {
        lastIndex = 0;
    }

    // NOVO: Salva o novo índice no localStorage para persistência
    localStorage.setItem('lastAssignedMechanicIndex', lastIndex);
    lastAssignedMechanicIndex = lastIndex; // Atualiza a variável global

    const nextMechanic = sortedMechanics[lastIndex];
    console.log(`Atribuição Round-Robin: Próximo mecânico é ${nextMechanic} (índice ${lastIndex})`);
    return nextMechanic;
}


// ------------------------------------
// 3. Handlers de Formulário e Ações
// ------------------------------------

document.getElementById('service-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isLoggedIn) return alertUser("Você precisa estar logado para cadastrar serviços.");

    // HOTFIX: Pega o nome do vendedor corretamente.
    // Se for gerente, pega do select. Se for vendedor, pega do usuário logado.
    let vendedorName = '';
    if (currentUserRole === MANAGER_ROLE) {
        vendedorName = document.getElementById('vendedorName').value;
    } else {
        vendedorName = currentUserName;
    }
    const licensePlate = document.getElementById('licensePlate').value.trim().toUpperCase();
    const carModel = document.getElementById('carModel').value.trim();

    let serviceDescription = document.getElementById('serviceDescription').value.trim();
    const isServiceDefined = serviceDescription !== '';
    if (!isServiceDefined) {
        serviceDescription = "Avaliação";
    }

    const manualSelection = document.getElementById('manualMechanic').value;
    const willAlign = document.querySelector('input[name="willAlign"]:checked').value === 'Sim';
    const willTireChange = document.querySelector('input[name="willTireChange"]:checked').value === 'Sim';

    const errorElement = document.getElementById('service-error');
    const messageElement = document.getElementById('assignment-message');
    errorElement.textContent = '';
    messageElement.textContent = 'Atribuindo...';

    if (!isAuthReady) {
        errorElement.textContent = 'Aguardando inicialização do sistema...';
        return;
    }

    let assignedMechanic;
    let assignedTireShop = null;

    if (manualSelection && MECHANICS.includes(manualSelection)) {
        assignedMechanic = manualSelection;
    } else {
        try {
            // ATUALIZADO: Usa a nova função de rodízio (Req 3.1)
            assignedMechanic = getNextMechanicInRotation();
        } catch (e) {
            errorElement.textContent = `Erro na atribuição: ${e.message}`;
            messageElement.textContent = '';
            return;
        }
    }

    if (willTireChange) {
        assignedTireShop = TIRE_SHOP_MECHANIC;
    }

    const newJob = {
        customerName: 'N/A', // REMOVIDO (Req 6.1)
        vendedorName,
        licensePlate,
        carModel,
        serviceDescription,
        isServiceDefined,
        assignedMechanic,
        assignedTireShop,
        status: STATUS_PENDING,
        statusGS: STATUS_PENDING,
        statusTS: willTireChange ? STATUS_PENDING : null,
        requiresAlignment: willAlign,
        timestamp: isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp(),
        gsStartedAt: isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp(), // NOVO: Início automático do serviço
        registeredBy: userId, // Mantido para rastreabilidade
        id: `job_${jobIdCounter++}`,
        type: 'Serviço Geral',
        finalizedAt: null
    };

    try {
        if (isDemoMode) {
            serviceJobs.push(newJob);

            let statusMessage = ` Simulação: Serviço Geral atribuído a ${assignedMechanic}!`;
            if (willTireChange) {
                statusMessage += ` e Serviço de Pneus ao Borracheiro!`;
            }

            if (willAlign) {
                const newAlignmentCar = {
                    customerName: 'N/A',
                    vendedorName,
                    licensePlate,
                    carModel,
                    status: STATUS_WAITING_GS,
                    gsDescription: newJob.serviceDescription,
                    gsMechanic: newJob.assignedMechanic,
                    serviceJobId: newJob.id,
                    timestamp: Timestamp.fromMillis(Date.now() + 10),
                    addedBy: userId,
            gsStartedAt: newJob.gsStartedAt, // NOVO: Propaga o tempo de início
                    id: `ali_${aliIdCounter++}`,
                    type: 'Alinhamento',
                    finalizedAt: null
                };
                alignmentQueue.push(newAlignmentCar);

                renderAlignmentQueue(alignmentQueue);
                renderAlignmentMirror(alignmentQueue);
                statusMessage += ` e adicionado à fila de Alinhamento (Aguardando)!`;
            }

            renderServiceQueues(serviceJobs);
            renderReadyJobs(serviceJobs, alignmentQueue);

            errorElement.textContent = "MODO DEMO: Dados não salvos.";
            messageElement.textContent = statusMessage;
        } else {
            const serviceJobId = newJob.id;
            delete newJob.id;

            const jobRef = await addDoc(collection(db, SERVICE_COLLECTION_PATH), newJob);

            if (willAlign) {
                 const newAlignmentCar = {
                    customerName: 'N/A',
                    vendedorName,
                    licensePlate,
                    carModel,
                    status: STATUS_WAITING_GS,
                    gsDescription: newJob.serviceDescription,
                    gsMechanic: newJob.assignedMechanic,
                    timestamp: serverTimestamp(),
                    addedBy: userId,
                    gsStartedAt: newJob.gsStartedAt, // NOVO: Propaga o tempo de início
                    type: 'Alinhamento',
                    serviceJobId: jobRef.id,
                    finalizedAt: null
                };
                await addDoc(collection(db, ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
            }

            messageElement.textContent = ` Serviço Geral atribuído a ${assignedMechanic}!`;
            if (willTireChange) {
                messageElement.textContent += ` e Pneus ao Borracheiro!`;
            }
            if (willAlign) {
                messageElement.textContent += ` e carro na fila de alinhamento (Aguardando GS)!`;
            }
        }

        document.getElementById('service-form').reset();
        setTimeout(() => messageElement.textContent = isDemoMode ? "Modo Demo Ativo." : '', 5000);

    } catch (error) {
        console.error("Erro ao cadastrar serviço:", error);
        errorElement.textContent = `Erro no cadastro: ${error.message}`;
        messageElement.textContent = '';
    } // Fim do try-catch
}); // Fim do addEventListener para 'service-form'

document.getElementById('alignment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isLoggedIn) return alertUser("Você precisa estar logado para cadastrar serviços.");

    // CORREÇÃO: Pega o nome do vendedor corretamente, dependendo do cargo do usuário.
    // Se for gerente, pega do select. Se for vendedor ou alinhador, pega do usuário logado.
    let vendedorName = '';
    if (currentUserRole === MANAGER_ROLE) {
        vendedorName = document.getElementById('aliVendedorName').value;
    } else {
        vendedorName = currentUserName;
    }

    const licensePlate = document.getElementById('aliLicensePlate').value.trim().toUpperCase();
    const carModel = document.getElementById('aliCarModel').value.trim();
    const errorElement = document.getElementById('alignment-error');
    errorElement.textContent = '';

    if (!isAuthReady) {
        errorElement.textContent = 'Aguardando inicialização do sistema...';
        return;
    }

    try {
        const newAlignmentCar = {
            customerName: 'N/A', // REMOVIDO (Req 6.1)
            vendedorName,
            licensePlate,
            carModel,
            status: STATUS_WAITING,
            timestamp: isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp(),
            addedBy: userId,
            id: `ali_${aliIdCounter++}`,
            type: 'Alinhamento',
            gsDescription: 'N/A (Adicionado Manualmente)',
            gsMechanic: 'N/A',
            finalizedAt: null
        };

        if (isDemoMode) {
            alignmentQueue.push(newAlignmentCar);
            renderAlignmentQueue(alignmentQueue);
            renderAlignmentMirror(alignmentQueue);
            renderReadyJobs(serviceJobs, alignmentQueue);
            errorElement.textContent = 'MODO DEMO: Cliente adicionado (Não salvo).';
        } else {
            delete newAlignmentCar.id;
            await addDoc(collection(db, ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
            errorElement.textContent = ' Cliente adicionado à fila de alinhamento com sucesso!';
        }

        document.getElementById('alignment-form').reset();
        setTimeout(() => errorElement.textContent = '', 5000);

    } catch (error)
    {
        console.error("Erro ao adicionar à fila de alinhamento:", error);
        errorElement.textContent = `Erro: ${error.message}`;
    }
});

// =========================================================================
// Funções de Reordenação da Fila de Alinhamento (Gerente)
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

    const currentCar = sortedQueue[index];
    const carBefore = findAdjacentCar(index, -1);

    if (!carBefore) {
         alertUser("Este carro já está no topo da fila de espera.");
         return;
    }

    const newTimeMillis = (getTimestampSeconds(carBefore.timestamp) * 1000) - 1000;
    const newTimestamp = Timestamp.fromMillis(newTimeMillis);

    if (isDemoMode) {
        const jobIndex = alignmentQueue.findIndex(j => j.id === docId);
        alignmentQueue[jobIndex].timestamp = newTimestamp;
        renderAlignmentQueue(alignmentQueue);
        renderAlignmentMirror(alignmentQueue);
        return;
    }

    try {
        const docRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
        await updateDoc(docRef, { timestamp: newTimestamp });
        alertUser("Ordem da fila atualizada.");
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

    const currentCar = sortedQueue[index];
    const carAfter = findAdjacentCar(index, +1);

    if (!carAfter) {
        alertUser("Este carro já é o último na fila de espera.");
        return;
    }

    const newTimeMillis = (getTimestampSeconds(carAfter.timestamp) * 1000) + 1000;
    const newTimestamp = Timestamp.fromMillis(newTimeMillis);


    if (isDemoMode) {
        const jobIndex = alignmentQueue.findIndex(j => j.id === docId);
        alignmentQueue[jobIndex].timestamp = newTimestamp;
        renderAlignmentQueue(alignmentQueue);
        renderAlignmentMirror(alignmentQueue);
        return;
    }

    try {
        const docRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
        await updateDoc(docRef, { timestamp: newTimestamp });
        alertUser("Ordem da fila atualizada.");
    } catch (e) {
        console.error("Erro ao mover para baixo:", e);
        alertUser("Erro ao atualizar a ordem no banco de dados.");
    }
}

// =========================================================================
// MODAL DE CONFIRMAÇÃO
// =========================================================================

document.getElementById("confirm-button").addEventListener("click", () => {
    const { id, confirmAction, type, serviceType } = currentJobToConfirm;
    if (!id || !confirmAction) {
        console.warn("Ação de confirmação cancelada.", currentJobToConfirm);
        hideConfirmationModal();
        return;
    }

    if (confirmAction === "service") confirmServiceReady(serviceType);
    if (confirmAction === "alignment") confirmAlignmentReady();
    if (confirmAction === "finalize") confirmFinalizeJob();
    if (confirmAction === "markAsLost") confirmMarkAsLost();
    if (confirmAction === "deleteUser") confirmDeleteUser(); // NOVO: Confirmação de exclusão de usuário
    if (confirmAction === "discardAlignment") confirmDiscardAlignment(); // NOVO
    if (confirmAction === "finalizeAlignmentFromRework") confirmFinalizeAlignmentFromRework(); // NOVO

    if (confirmAction === "updateUser") handleUpdateUser(); // NOVO: Confirmação de edição de usuário
});

function showConfirmationModal(id, type, title, message, confirmAction, serviceType = null) {
    currentJobToConfirm = { id, type, confirmAction, serviceType };
    const modal = document.getElementById('confirmation-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;

    const confirmButton = document.getElementById('confirm-button');
    confirmButton.classList.remove('bg-red-600', 'hover:bg-red-700');
    confirmButton.classList.add('bg-green-600', 'hover:bg-green-700');
    confirmButton.textContent = 'Sim, Confirmar';

    modal.classList.remove('hidden');
}

function showFinalizeModal(id, type, title, message, confirmAction) {
    currentJobToConfirm = { id, type, confirmAction, serviceType: null };
    const modal = document.getElementById('confirmation-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;

    const confirmButton = document.getElementById('confirm-button');
    confirmButton.classList.remove('bg-green-600', 'hover:bg-green-700');
    confirmButton.classList.add('bg-red-600', 'hover:bg-red-700');

    // CORREÇÃO CRÍTICA: A lógica de atribuição da ação estava incompleta.
    if (confirmAction === 'finalize') confirmButton.textContent = 'Sim, Finalizar e Receber';
    else if (confirmAction === 'markAsLost') confirmButton.textContent = 'Sim, Marcar como Perdido';
    else if (confirmAction === 'deleteUser') confirmButton.textContent = 'Sim, Excluir Usuário';
    else if (confirmAction === 'discardAlignment') confirmButton.textContent = 'Sim, Descartar';
    else if (confirmAction === 'finalizeAlignmentFromRework') {
        confirmButton.textContent = 'Sim, Finalizar';
        // A ação de clique é tratada pelo listener global do #confirm-button,
        // que agora reconhecerá 'finalizeAlignmentFromRework'.
    }
    else confirmButton.textContent = 'Sim, Confirmar';

    modal.classList.remove('hidden');
}

window.hideConfirmationModal = function() {
    const modal = document.getElementById('confirmation-modal');
    modal.classList.add('hidden');
    currentJobToConfirm = { id: null, type: null, confirmAction: null, serviceType: null };
}

window.showServiceReadyConfirmation = function(docId, serviceType) {
    if (!isLoggedIn) return alertUser("Você precisa estar logado para realizar esta ação.");

    const title = serviceType === 'GS' ? 'Confirmar Serviço Geral Concluído' : 'Confirmar Serviço de Pneus Concluído';
    const message = `Tem certeza de que deseja marcar este serviço (${serviceType === 'GS' ? 'Geral' : 'Pneus'}) como PRONTO e liberá-lo?`;

    showConfirmationModal(docId, 'service', title, message, 'service', serviceType);
}

window.showAlignmentReadyConfirmation = function(docId) {
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== ALIGNER_ROLE) return alertUser("Acesso negado. Faça login como Alinhador ou Gerente.");

     showConfirmationModal(docId, 'alignment', 'Confirmar Alinhamento Concluído', 'Tem certeza de que o **Alinhamento** está PRONTO e deve ser enviado para a Gerência?', 'alignment');
}

window.showFinalizeConfirmation = function(docId, collectionType) { // CORREÇÃO: Permite que Alinhadores também finalizem
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== ALIGNER_ROLE) return alertUser("Acesso negado. Apenas Gerentes ou Alinhadores podem finalizar pagamentos.");

    const title = collectionType === 'service' ? 'Finalizar Pagamento (Mecânica)' : 'Finalizar Pagamento (Alinhamento)';
    const message = `Confirma a finalização e recebimento do pagamento para o serviço de **${collectionType === 'service' ? 'Mecânica' : 'Alinhamento'}**? Esta ação marcará o carro como 'Finalizado'.`;

     showFinalizeModal(docId, collectionType, title, message, 'finalize');
}

// NOVO: Modal para confirmar o envio do alinhamento para o gerente (pronto para pagamento)
window.showSendToManagerConfirmation = function(docId) {
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== ALIGNER_ROLE) return alertUser("Acesso negado.");

    const title = 'Enviar para Gerência';
    const message = `Tem certeza de que o serviço de alinhamento está concluído e deve ser enviado para a fila de pagamento do gerente?`;

    showConfirmationModal(docId, 'alignment', title, message, 'alignment'); // Reutiliza a ação 'alignment' que chama `confirmAlignmentReady`
}

window.showMarkAsLostConfirmation = function(docId) {
    // ATUALIZAÇÃO: Permite que Vendedores também marquem como perdido.
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== VENDEDOR_ROLE) return alertUser("Acesso negado.");

    const title = 'Confirmar Serviço Perdido';
    const message = `Tem certeza que deseja marcar este serviço como **PERDIDO**? Ele será removido das filas ativas e contado nas estatísticas de perdas. Esta ação não pode ser desfeita.`;

     showFinalizeModal(docId, 'service', title, message, 'markAsLost');
}

// NOVO: Modal de confirmação para descartar item do alinhamento
window.showDiscardAlignmentConfirmation = function(docId) {
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== ALIGNER_ROLE) return alertUser("Acesso negado.");

    const car = alignmentQueue.find(c => c.id === docId);
    if (!car) return;
    const title = 'Descartar Serviço de Alinhamento';
    const message = `Tem certeza que deseja marcar o alinhamento do carro <strong>${car.licensePlate}</strong> como 'Perdido'? Ele será removido da fila ativa.`;
    showFinalizeModal(docId, 'alignment', title, message, 'discardAlignment');
}

// NOVO: Modal de confirmação para deletar usuário (Req 2.3)
window.showDeleteUserConfirmation = function(userId) {
    if (currentUserRole !== MANAGER_ROLE) return;
    const user = systemUsers.find(u => u.id === userId);
    if (!user) return;

    // Validação para impedir exclusão com serviço em andamento
    let hasActiveService = false;
    if (user.role === MECANICO_ROLE) {
        hasActiveService = serviceJobs.some(job => job.assignedMechanic === user.username && job.status === STATUS_PENDING);
    } else if (user.role === ALIGNER_ROLE) {
        hasActiveService = alignmentQueue.some(car => car.status === STATUS_ATTENDING);
    }

    if (hasActiveService) {
        alertUser("Não é possível excluir este profissional enquanto houver serviços em andamento.");
        return;
    }

    // Se não houver serviços ativos, prossegue com a confirmação
    const title = `Excluir Usuário`;
    const message = `Tem certeza que deseja excluir o usuário <strong>${user.username}</strong> (${user.role})? Esta ação é irreversível.`;
    showFinalizeModal(userId, 'user', title, message, 'deleteUser');
}

// HOTFIX: Restaurando a função que foi removida acidentalmente.
window.confirmServiceReady = function(serviceType) {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'service') {
        markServiceReady(currentJobToConfirm.id, serviceType);
    }
    hideConfirmationModal();
}

window.confirmAlignmentReady = function() {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'alignment') {
        updateAlignmentStatus(currentJobToConfirm.id, 'Done');
    }
    hideConfirmationModal();
}

window.confirmFinalizeJob = function() {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'finalize') {
        finalizeJob(currentJobToConfirm.id, currentJobToConfirm.type);
    }
    hideConfirmationModal();
}

window.confirmMarkAsLost = function() {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'markAsLost') {
        markServiceAsLost(currentJobToConfirm.id);
    }
    hideConfirmationModal();
}

// NOVO: Ação de descartar alinhamento
window.confirmDiscardAlignment = function() {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'discardAlignment') {
        discardAlignmentJob(currentJobToConfirm.id);
    }
    hideConfirmationModal();
}

// NOVO: Ação de finalizar direto do modal de retrabalho
window.confirmFinalizeAlignmentFromRework = function() {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'finalizeAlignmentFromRework') {
        const alignmentJobId = currentJobToConfirm.id;
        const alignmentJob = alignmentQueue.find(c => c.id === alignmentJobId);

        // 1. Marca o próprio serviço de alinhamento como 'Pronto para Pagamento'
        updateAlignmentStatus(alignmentJobId, 'Done'); // 'Done' internamente vira STATUS_READY

        // 2. CORREÇÃO: Se houver um serviço geral associado, ele TAMBÉM deve ser
        //    marcado como 'Pronto para Pagamento' para que apareça na fila do gerente.
        if (alignmentJob?.serviceJobId) {
            const serviceJobRef = doc(db, SERVICE_COLLECTION_PATH, alignmentJob.serviceJobId);
            updateDoc(serviceJobRef, {
                status: STATUS_READY
            }).catch(e => console.error("Erro ao finalizar o serviço geral associado a partir do retrabalho:", e));
        } else {
            // Se não houver serviço geral, o alinhamento manual já foi tratado pelo updateAlignmentStatus.
            console.log("Finalizando alinhamento manual a partir do modal de retrabalho.");
        }

        hideConfirmationModal();
    } else {
        hideConfirmationModal();
    }
}

// NOVO: Ação de deletar usuário (Req 2.3)
window.confirmDeleteUser = function() {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'deleteUser') {
        deleteUser(currentJobToConfirm.id);
    }
    hideConfirmationModal();
}

// =========================================================================
// NOVO: Funções do Modal "Retornar ao Mecânico"
// =========================================================================

function createReworkModal() {
    // CORREÇÃO: Se o modal já existe, apenas garante que os listeners estão corretos.
    if (document.getElementById('rework-modal')) {
        document.getElementById('rework-form').addEventListener('submit', handleReturnToMechanic);
        return;
    }

    // NOVO: Ícone para o modal
    const reworkIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-blue-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><path stroke-linecap="round" stroke-linejoin="round" d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>`;
    const modalHTML = `
        <div id="rework-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full hidden z-50">
            <div class="relative top-20 mx-auto p-5 border w-full max-w-md shadow-lg rounded-md bg-white">
                <div class="mt-3 text-center">
                    ${reworkIcon}
                    <h3 class="text-xl leading-6 font-bold text-gray-900 mt-2" id="rework-modal-title">Retornar Serviço</h3>
                    <p class="text-sm text-gray-500 mt-2" id="rework-modal-subtitle">Envie o serviço de volta para a mecânica para um ajuste ou retrabalho.</p>
                    <form id="rework-form" class="mt-4 space-y-4 text-left">
                        <div>
                            <label for="rework-mechanic-select" class="block text-sm font-medium text-gray-700">Selecione o Mecânico de Destino *</label>
                            <select id="rework-mechanic-select" required class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
                                <!-- Options will be populated by JS -->
                            </select>
                        </div>
                        <div class="pt-2">
                            <label class="block text-sm font-medium text-gray-700">Voltar para o Alinhamento após o reparo?</label>
                            <div class="mt-2 flex items-center space-x-4">
                                <label class="inline-flex items-center">
                                    <input type="radio" class="form-radio h-4 w-4 text-indigo-600" name="rework-return-to-alignment" value="Sim" checked>
                                    <span class="ml-2">Sim</span>
                                </label>
                                <label class="inline-flex items-center">
                                    <input type="radio" class="form-radio h-4 w-4 text-indigo-600" name="rework-return-to-alignment" value="Nao">
                                    <span class="ml-2">Não</span>
                                </label>
                            </div>
                        </div>
                        <div class="items-center px-4 py-3 bg-gray-50 rounded-b-md -mx-5 -mb-5 mt-6 flex justify-end space-x-3">
                            <button id="rework-confirm-button" type="submit" class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                                Retornar ao Mecânico
                            </button>
                             <button id="rework-cancel-button" type="button" onclick="hideReturnToMechanicModal()" class="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded-md shadow-sm hover:bg-gray-300">
                                Cancelar
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // CORREÇÃO: Garante que os listeners sejam adicionados uma única vez, após a criação do modal.
    // Isso evita problemas de botões não funcionais.
    const reworkForm = document.getElementById('rework-form');
    if (reworkForm.dataset.listenerAttached) return; // Previne adicionar listeners múltiplos

    reworkForm.dataset.listenerAttached = 'true';
    document.getElementById('rework-form').addEventListener('submit', handleReturnToMechanic);
}

window.showReturnToMechanicModal = function(docId) {
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== ALIGNER_ROLE) return alertUser("Acesso negado.");

    const car = alignmentQueue.find(c => c.id === docId);
    if (!car) return alertUser("Erro: Carro não encontrado na fila de alinhamento.");
    if (!car.serviceJobId) return alertUser("Ação não permitida: Este serviço foi adicionado manualmente e não pode retornar a um mecânico.");

    currentAlignmentJobForRework = docId;

    const select = document.getElementById('rework-mechanic-select');
    select.innerHTML = mecanicosGeral.map(m => `<option value="${m.username}">${m.username}</option>`).join('');

    // NOVO: Atualiza o título do modal com as informações do carro
    document.getElementById('rework-modal-subtitle').textContent = `Carro: ${car.carModel} (${car.licensePlate})`;

    document.getElementById('rework-modal').classList.remove('hidden');
}

window.hideReturnToMechanicModal = function() {
    document.getElementById('rework-modal').classList.add('hidden');
    document.getElementById('rework-form').reset();
    currentAlignmentJobForRework = null;
}

async function handleReturnToMechanic(e) {
    e.preventDefault();
    const docId = currentAlignmentJobForRework;
    if (!docId) return;

    const targetMechanic = document.getElementById('rework-mechanic-select').value;
    const shouldReturnToAlignment = document.querySelector('input[name="rework-return-to-alignment"]:checked').value === 'Sim';

    if (!targetMechanic) {
        alertUser("Por favor, selecione um mecânico de destino.");
        return;
    }

    await returnToMechanic(docId, targetMechanic, shouldReturnToAlignment);

    hideReturnToMechanicModal();
}

// =========================================================================
// NOVO: Funções do Modal "Editar Usuário"
// =========================================================================

window.showEditUserModal = function(userId) {
    if (currentUserRole !== MANAGER_ROLE) return;

    const user = systemUsers.find(u => u.id === userId);
    if (!user) {
        alertUser("Erro: Usuário não encontrado.");
        return;
    }

    currentUserToEditId = userId;

    document.getElementById('edit-user-modal-username').textContent = `Usuário: ${user.username}`;
    document.getElementById('edit-user-role').value = user.role;
    document.getElementById('edit-user-password').value = ''; // Limpa o campo de senha

    document.getElementById('edit-user-modal').classList.remove('hidden');
}

window.hideEditUserModal = function() {
    document.getElementById('edit-user-modal').classList.add('hidden');
    document.getElementById('edit-user-form').reset();
    currentUserToEditId = null;
}

async function handleUpdateUser(e) {
    e.preventDefault();
    const userId = currentUserToEditId;
    if (!userId) return;

    const newPassword = document.getElementById('edit-user-password').value;
    const newRole = document.getElementById('edit-user-role').value;

    const dataToUpdate = {
        role: newRole
    };

    // Apenas adiciona a senha ao objeto de atualização se ela foi preenchida
    if (newPassword && newPassword.trim() !== '') {
        dataToUpdate.password = newPassword;
    }

    if (isDemoMode) {
        const userIndex = systemUsers.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            systemUsers[userIndex] = { ...systemUsers[userIndex], ...dataToUpdate };
            renderUserList(systemUsers);
            alertUser("MODO DEMO: Usuário atualizado na lista.");
        }
    } else {
        try {
            const userRef = doc(db, USERS_COLLECTION_PATH, userId);
            await updateDoc(userRef, dataToUpdate);
            alertUser("Usuário atualizado com sucesso!");
        } catch (error) {
            console.error("Erro ao atualizar usuário:", error);
            alertUser("Erro ao salvar as alterações no banco de dados.");
        }
    }

    hideEditUserModal();
}

// Adiciona o listener ao formulário de edição de usuário
document.getElementById('edit-user-form').addEventListener('submit', handleUpdateUser);


// =========================================================================
// Funções do Modal "Definir Serviço"
// =========================================================================

window.showDefineServiceModal = function(docId) {
    if (currentUserRole !== MANAGER_ROLE) return;

    const job = serviceJobs.find(j => j.id === docId);
    if (!job) {
        alertUser("Erro: Serviço não encontrado.");
        return;
    }

    currentJobToDefineId = docId;
    document.getElementById('service-modal-car-info').textContent = `Carro: ${job.carModel} (${job.licensePlate})`;

    const currentDescription = job.serviceDescription === "Avaliação" ? "" : job.serviceDescription;
    document.getElementById('new-service-description').value = currentDescription;

    document.getElementById('define-service-modal').classList.remove('hidden');
    document.getElementById('new-service-description').focus();
}

window.hideDefineServiceModal = function() {
    document.getElementById('define-service-modal').classList.add('hidden');
    document.getElementById('define-service-form').reset();
    currentJobToDefineId = null;
}

document.getElementById('define-service-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newDescription = document.getElementById('new-service-description').value.trim();
    const docId = currentJobToDefineId;

    if (!newDescription || !docId) {
        alertUser("A descrição do serviço não pode estar vazia.");
        return;
    }

    const dataToUpdate = {
        serviceDescription: newDescription,
        isServiceDefined: true
    };

    if (isDemoMode) {
        const jobIndex = serviceJobs.findIndex(j => j.id === docId);
        if (jobIndex !== -1) {
            serviceJobs[jobIndex].serviceDescription = newDescription;
            serviceJobs[jobIndex].isServiceDefined = true;
        }

        const alignmentIndex = alignmentQueue.findIndex(a => a.serviceJobId === docId);
        if (alignmentIndex !== -1) {
            alignmentQueue[alignmentIndex].gsDescription = newDescription;
        }

        renderServiceQueues(serviceJobs);
        renderAlignmentMirror(alignmentQueue);
        renderAlignmentQueue(alignmentQueue);
    } else {
        try {
            const docRef = doc(db, SERVICE_COLLECTION_PATH, docId);
            await updateDoc(docRef, dataToUpdate);

            const alignQuery = query(collection(db, ALIGNMENT_COLLECTION_PATH), where('serviceJobId', '==', docId));
            const alignSnapshot = await getDocs(alignQuery);

            if (!alignSnapshot.empty) {
                const alignDocRef = alignSnapshot.docs[0].ref;
                await updateDoc(alignDocRef, { gsDescription: newDescription });
            }

            alertUser("Serviço definido com sucesso!");
        } catch (error) {
            console.error("Erro ao definir serviço:", error);
            alertUser("Erro ao salvar serviço no banco de dados.");
        }
    }

    hideDefineServiceModal();
});


// =========================================================================
// Funções do Modal "Editar Serviço" (Gerente)
// =========================================================================

window.showEditServiceModal = function(docId) {
    // ATUALIZAÇÃO: Permite que Vendedores também editem.
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== VENDEDOR_ROLE) return;

    const job = serviceJobs.find(j => j.id === docId);
    if (!job) {
        alertUser("Erro: Serviço não encontrado.");
        return;
    }

    currentJobToEditId = docId;            document.getElementById('edit-vendedorName').value = job.vendedorName;
    document.getElementById('edit-licensePlate').value = job.licensePlate;
    document.getElementById('edit-carModel').value = job.carModel;
    document.getElementById('edit-serviceDescription').value = job.serviceDescription;

    const mechanicSelect = document.getElementById('edit-assignedMechanic');
    mechanicSelect.innerHTML = MECHANICS.map(m => `<option value="${m}">${m}</option>`).join('');
    mechanicSelect.value = job.assignedMechanic;

    const willTireChange = job.statusTS === STATUS_PENDING || job.statusTS === STATUS_TS_FINISHED;
    document.querySelector(`input[name="edit-willTireChange"][value="${willTireChange ? 'Sim' : 'Nao'}"]`).checked = true;

    // NOVO: Preenche a opção de alinhamento
    document.querySelector(`input[name="edit-willAlign"][value="${job.requiresAlignment ? 'Sim' : 'Nao'}"]`).checked = true;

    document.getElementById('edit-service-modal').classList.remove('hidden');
}

window.hideEditServiceModal = function() {
    document.getElementById('edit-service-modal').classList.add('hidden');
    document.getElementById('edit-service-form').reset();
    currentJobToEditId = null;
}

document.getElementById('edit-service-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const docId = currentJobToEditId;
    if (!docId) return alertUser("Erro: ID do serviço não encontrado.");

    const newVendedorName = document.getElementById('edit-vendedorName').value.trim(); // REMOVIDO: Cliente
    const newLicensePlate = document.getElementById('edit-licensePlate').value.trim().toUpperCase();
    const newCarModel = document.getElementById('edit-carModel').value.trim();
    const newServiceDescription = document.getElementById('edit-serviceDescription').value.trim();
    const newAssignedMechanic = document.getElementById('edit-assignedMechanic').value;
    const newWillTireChange = document.querySelector('input[name="edit-willTireChange"]:checked').value === 'Sim';
    const newRequiresAlignment = document.querySelector('input[name="edit-willAlign"]:checked').value === 'Sim';

    const originalJob = serviceJobs.find(j => j.id === docId);
    let newStatusTS = originalJob.statusTS;

    if (newWillTireChange && originalJob.statusTS === null) {
        newStatusTS = STATUS_PENDING;
    } else if (!newWillTireChange && (originalJob.statusTS === STATUS_PENDING || originalJob.statusTS === null)) {
        newStatusTS = null;
    }

    const dataToUpdate = {
        customerName: 'N/A',
        vendedorName: newVendedorName,
        licensePlate: newLicensePlate,
        carModel: newCarModel,
        serviceDescription: newServiceDescription,
        isServiceDefined: newServiceDescription !== "Avaliação" && newServiceDescription !== "",
        assignedMechanic: newAssignedMechanic,
        assignedTireShop: newWillTireChange ? TIRE_SHOP_MECHANIC : null,
        statusTS: newStatusTS,
        requiresAlignment: newRequiresAlignment // NOVO
    };

    const alignmentDataToUpdate = {
        customerName: 'N/A',
        vendedorName: newVendedorName,
        licensePlate: newLicensePlate,
        carModel: newCarModel,
        gsDescription: newServiceDescription,
        gsMechanic: newAssignedMechanic
    };


    if (isDemoMode) {
        const jobIndex = serviceJobs.findIndex(j => j.id === docId);
        if (jobIndex !== -1) {
            serviceJobs[jobIndex] = { ...serviceJobs[jobIndex], ...dataToUpdate };
        }

        const alignmentIndex = alignmentQueue.findIndex(a => a.serviceJobId === docId);
        if (alignmentIndex !== -1) {
            alignmentQueue[alignmentIndex] = { ...alignmentQueue[alignmentIndex], ...alignmentDataToUpdate };
        }

        renderServiceQueues(serviceJobs);
        renderAlignmentMirror(alignmentQueue);
        renderAlignmentQueue(alignmentQueue);
    } else {
        try {
            const docRef = doc(db, SERVICE_COLLECTION_PATH, docId);
            await updateDoc(docRef, dataToUpdate);

            const alignQuery = query(collection(db, ALIGNMENT_COLLECTION_PATH), where('serviceJobId', '==', docId));
            const alignSnapshot = await getDocs(alignQuery);

            if (!alignSnapshot.empty) {
                const alignDocRef = alignSnapshot.docs[0].ref;
                // Se o alinhamento foi desmarcado, marca o job de alinhamento como perdido
                if (!newRequiresAlignment) {
                    await updateDoc(alignDocRef, { status: STATUS_LOST });
                } else {
                    await updateDoc(alignDocRef, alignmentDataToUpdate);
                }
            } else if (newRequiresAlignment) {
                // Se o alinhamento foi marcado (e não existia antes), cria um novo
                const newAlignmentCar = {
                    customerName: 'N/A',
                    vendedorName: newVendedorName,
                    licensePlate: newLicensePlate,
                    carModel: newCarModel,
                    status: STATUS_WAITING_GS,
                    gsDescription: newServiceDescription,
                    gsMechanic: newAssignedMechanic,
                    timestamp: serverTimestamp(),
                    addedBy: userId,
                    type: 'Alinhamento',
                    serviceJobId: docId,
                    finalizedAt: null
                };
                await addDoc(collection(db, ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
            }

            // Se o alinhamento foi desmarcado, verifica se o serviço principal pode ir para pagamento
            if (!newRequiresAlignment && dataToUpdate.statusGS === STATUS_GS_FINISHED && (dataToUpdate.statusTS === STATUS_TS_FINISHED || dataToUpdate.statusTS === null)) {
                dataToUpdate.status = STATUS_READY;
            }


            alertUser("Serviço atualizado com sucesso!");
        } catch (error) {
            console.error("Erro ao atualizar serviço:", error);
            alertUser("Erro ao salvar serviço no banco de dados.");
        }
    }

    hideEditServiceModal();
});

// NOVO: Função para iniciar atendimento do serviço geral (Req. 2)
async function startGeneralService(docId) {
    const dataToUpdate = {
        gsStartedAt: isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp()
    };

    if (isDemoMode) {
        const jobIndex = serviceJobs.findIndex(j => j.id === docId);
        if (jobIndex !== -1) {
            serviceJobs[jobIndex].gsStartedAt = dataToUpdate.gsStartedAt;
            renderServiceQueues(serviceJobs);
        }
        return;
    }

    try {
        const docRef = doc(db, SERVICE_COLLECTION_PATH, docId);
        await updateDoc(docRef, dataToUpdate);
    } catch (error) {
        console.error("Erro ao iniciar serviço geral:", error);
        alertUser("Erro ao salvar o início do atendimento.");
    }
}

// Disponibiliza a função globalmente para ser chamada pelo HTML
window.startGeneralService = startGeneralService;



// =========================================================================
// Funções de Ação (Concluir, Finalizar, etc.)
// =========================================================================

async function markServiceReady(docId, serviceType) {

    let dataToUpdate = {};
    // ATUALIZADO: Adiciona timestamp de conclusão da etapa
    if (serviceType === 'GS') {
        dataToUpdate.statusGS = STATUS_GS_FINISHED;
        dataToUpdate.gsFinishedAt = isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp();
    } else if (serviceType === 'TS') {
        dataToUpdate.statusTS = STATUS_TS_FINISHED;
        dataToUpdate.tsFinishedAt = isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp();
    }


    if (isDemoMode) {
        const jobIndex = serviceJobs.findIndex(j => j.id === docId);
        if (jobIndex === -1) {
            alertUser("Erro Demo: Serviço geral não encontrado.");
            return;
        }
        // Aplica a atualização de status
        serviceJobs[jobIndex] = { ...serviceJobs[jobIndex], ...dataToUpdate };
        const job = serviceJobs[jobIndex];

        const isGsReady = job.statusGS === STATUS_GS_FINISHED;
        const isTsReady = job.statusTS === STATUS_TS_FINISHED || job.statusTS === null;

        if (isGsReady && isTsReady) {
            if (job.requiresAlignment) {
                const alignmentCarIndex = alignmentQueue.findIndex(a => a.serviceJobId === docId);
                if (alignmentCarIndex !== -1 && alignmentQueue[alignmentCarIndex].status === STATUS_WAITING_GS) {
                    alignmentQueue[alignmentCarIndex].status = STATUS_WAITING;
                    job.status = STATUS_GS_FINISHED;
                } else {
                    job.status = STATUS_READY;
                }
            } else {
                job.status = STATUS_READY;
            }
        }

        renderServiceQueues(serviceJobs);
        renderAlignmentQueue(alignmentQueue);
        renderAlignmentMirror(alignmentQueue);
        renderReadyJobs(serviceJobs, alignmentQueue);
        return;
    }

    try {
        const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, docId);
        await updateDoc(serviceDocRef, dataToUpdate); // Salva o status (GS ou TS) e o timestamp

        const serviceDoc = await getDoc(serviceDocRef);
        if (!serviceDoc.exists()) throw new Error("Documento de Serviço não encontrado.");

        const job = serviceDoc.data();
        const isGsReady = job.statusGS === STATUS_GS_FINISHED;
        const isTsReady = job.statusTS === STATUS_TS_FINISHED || job.statusTS === null;

        // CORREÇÃO: Lógica para retrabalho que precisa voltar ao alinhamento
        if (job.statusGS === STATUS_GS_FINISHED && job.requiresAlignmentAfterRework) {
            // Busca o job de alinhamento associado, que foi marcado como 'Perdido' anteriormente.
            const alignQuery = query(
                collection(db, ALIGNMENT_COLLECTION_PATH), where('serviceJobId', '==', docId)
            );
            const alignSnapshot = await getDocs(alignQuery);
            if (!alignSnapshot.empty) {
                const alignDocRef = alignSnapshot.docs[0].ref;
                // Reativa o job de alinhamento, colocando-o de volta na fila de espera, e reseta o serviço geral
                // para indicar que agora aguarda o alinhamento ser concluído.
                await Promise.all([
                    updateDoc(alignDocRef, { status: STATUS_WAITING, timestamp: serverTimestamp(), readyAt: null, finalizedAt: null }),
                    updateDoc(serviceDocRef, { status: STATUS_GS_FINISHED, requiresAlignmentAfterRework: false })
                ]);
                return; // Encerra a função aqui, pois o fluxo é diferente.
            }
        }


        if (isGsReady && isTsReady) {
            if (job.requiresAlignment) {
                const alignQuery = query(
                    collection(db, ALIGNMENT_COLLECTION_PATH),
                    where('serviceJobId', '==', docId),
                    where('status', '==', STATUS_WAITING_GS)
                );
                const alignSnapshot = await getDocs(alignQuery);

                if (!alignSnapshot.empty) {
                    const alignDocRef = alignSnapshot.docs[0].ref;
                    await updateDoc(alignDocRef, { status: STATUS_WAITING });
                    await updateDoc(serviceDocRef, { status: STATUS_GS_FINISHED });
                } else {
                    await updateDoc(serviceDocRef, { status: STATUS_READY });
                }
            } else {
                await updateDoc(serviceDocRef, { status: STATUS_READY });
            }
        }
    } catch (error) {
        console.error("Erro ao marcar serviço como pronto (Firestore):", error);
        alertUser(`Erro no Banco de Dados: ${error.message}`);
    }
}

async function finalizeJob(docId, collectionType) {
    if (currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado. Apenas Gerentes podem finalizar pagamentos.");
    
     const collectionPath = collectionType === 'service' ? SERVICE_COLLECTION_PATH : ALIGNMENT_COLLECTION_PATH;
     const isService = collectionType === 'service';
     const finalizedTimestamp = isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp();

    if (isDemoMode) {
        let jobToUpdate = null;
        if (isService) {
            jobToUpdate = serviceJobs.find(job => job.id === docId);
        } else {
            jobToUpdate = alignmentQueue.find(car => car.id === docId);
            if (jobToUpdate && jobToUpdate.serviceJobId) {
                 const associatedGS = serviceJobs.find(job => job.id === jobToUpdate.serviceJobId);
                 if(associatedGS) {
                    associatedGS.status = STATUS_FINALIZED;
                    associatedGS.finalizedAt = finalizedTimestamp;
                 }
            }
        }

        if (jobToUpdate) {
            jobToUpdate.status = STATUS_FINALIZED;
            jobToUpdate.finalizedAt = finalizedTimestamp;
        }

        renderReadyJobs(serviceJobs, alignmentQueue);
        renderAlignmentMirror(alignmentQueue);
        renderAlignmentQueue(alignmentQueue);
        calculateAndRenderDashboard(); // ATUALIZADO
        return;
    }

    try {
        const docRef = doc(db, collectionPath, docId);
        const dataToUpdate = { status: STATUS_FINALIZED, finalizedAt: finalizedTimestamp };
        await updateDoc(docRef, dataToUpdate);

        // CORREÇÃO: Garante que ao finalizar um alinhamento, o serviço geral associado também seja finalizado.
        // Isso é crucial para o fluxo de retrabalho, onde o serviço geral fica 'Aguardando Alinhamento'.
        if (!isService) {
            const carDoc = await getDoc(docRef);
            if (carDoc.exists() && carDoc.data().serviceJobId) {
                const serviceJobId = carDoc.data().serviceJobId;
                const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, serviceJobId);
                const serviceDoc = await getDoc(serviceDocRef);
                // Apenas finaliza o serviço geral se ele ainda não estiver finalizado.
                if (serviceDoc.exists() && serviceDoc.data().status !== STATUS_FINALIZED) {
                    await updateDoc(serviceDocRef, dataToUpdate);
                }
            }
        }
    } catch (error) {
        console.error("Erro ao finalizar (Firestore):", error);
        alertUser(`Erro no Banco deDados: ${error.message}`);
    }
}

async function markServiceAsLost(docId) {
    // ATUALIZAÇÃO: Permite que Vendedores também marquem como perdido.
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== VENDEDOR_ROLE) return alertUser("Acesso negado.");

    const lostTimestamp = isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp();
    const dataToUpdate = { status: STATUS_LOST, finalizedAt: lostTimestamp };

    if (isDemoMode) {
        const jobIndex = serviceJobs.findIndex(j => j.id === docId);
        if (jobIndex !== -1) {
            serviceJobs[jobIndex].status = STATUS_LOST;
            serviceJobs[jobIndex].finalizedAt = lostTimestamp;
        }

        const alignmentIndex = alignmentQueue.findIndex(a => a.serviceJobId === docId);
        if (alignmentIndex !== -1) {
            alignmentQueue[alignmentIndex].status = STATUS_LOST;
            alignmentQueue[alignmentIndex].finalizedAt = lostTimestamp;
        }

        renderServiceQueues(serviceJobs);
        renderAlignmentQueue(alignmentQueue);
        renderAlignmentMirror(alignmentQueue);
        calculateAndRenderDashboard(); // ATUALIZADO
        return;
    }

    try {
        const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, docId);
        await updateDoc(serviceDocRef, dataToUpdate);

        const alignQuery = query(collection(db, ALIGNMENT_COLLECTION_PATH), where('serviceJobId', '==', docId));
        const alignSnapshot = await getDocs(alignQuery);

        if (!alignSnapshot.empty) {
            const alignDocRef = alignSnapshot.docs[0].ref;
            await updateDoc(alignDocRef, dataToUpdate);
        }

        alertUser("Serviço marcado como 'Perdido' e removido das filas.");
    } catch (error) {
        console.error("Erro ao marcar como perdido:", error);
        alertUser("Erro ao atualizar status no banco de dados.");
    }
}

async function updateAlignmentStatus(docId, newStatus) {
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== ALIGNER_ROLE) return alertUser("Acesso negado. Faça login como Alinhador ou Gerente.");

    let finalStatus = newStatus;
    let dataToUpdate = {};
    const now = isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp();

    if (newStatus === 'Done') {
        finalStatus = STATUS_READY;
        dataToUpdate = {
            status: finalStatus,
            readyAt: now // Timestamp de quando Alinhador apertou "Pronto"
        };
    } else if (newStatus === STATUS_ATTENDING) {
        finalStatus = newStatus;
        dataToUpdate = {
            status: finalStatus,
            alignmentStartedAt: now // ATUALIZADO: Gravando quando o alinhamento começou
        };
    } else {
         finalStatus = newStatus; // WAITING
         dataToUpdate = { status: finalStatus };
    }

    if (isDemoMode) {
         const carIndex = alignmentQueue.findIndex(car => car.id === docId);
         if (carIndex !== -1) {
            alignmentQueue[carIndex] = { ...alignmentQueue[carIndex], ...dataToUpdate, status: finalStatus };

             renderAlignmentQueue(alignmentQueue);
             renderAlignmentMirror(alignmentQueue);
             renderReadyJobs(serviceJobs, alignmentQueue);
             return;
         } else {
            alertUser("Erro Demo: Carro de alinhamento não encontrado.");
         }
         return;
    }

    try {
        const alignDocRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
        await updateDoc(alignDocRef, dataToUpdate);
    } catch (error) {
         console.error("Erro ao atualizar status do alinhamento (Firestore):", error);
         alertUser(`Erro no Banco de Dados: ${error.message}`);
    }
}

// NOVO: Marca um job de alinhamento como perdido
async function discardAlignmentJob(docId) {
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== ALIGNER_ROLE) return alertUser("Acesso negado.");

    const dataToUpdate = {
        status: STATUS_LOST,
        finalizedAt: isDemoMode ? Timestamp.fromMillis(Date.now()) : serverTimestamp()
    };

    if (isDemoMode) {
        const carIndex = alignmentQueue.findIndex(c => c.id === docId);
        if (carIndex !== -1) {
            alignmentQueue[carIndex].status = STATUS_LOST;
        }
    } else {
        try {
            const docRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
            await updateDoc(docRef, dataToUpdate);
            alertUser("Serviço de alinhamento marcado como 'Perdido'.");
        } catch (error) {
            console.error("Erro ao descartar alinhamento:", error);
            alertUser("Erro ao atualizar o status no banco de dados.");
        }
    }
}

// NOVO: Lógica para retornar um serviço ao mecânico
async function returnToMechanic(alignmentDocId, targetMechanic, shouldReturnToAlignment) {
    const alignmentJob = alignmentQueue.find(c => c.id === alignmentDocId);
    if (!alignmentJob || !alignmentJob.serviceJobId) return;

    const serviceJobId = alignmentJob.serviceJobId;

    // 1. Atualiza o serviço principal (Geral)
    const serviceUpdate = {
        status: STATUS_PENDING, // Volta para a fila ativa
        statusGS: STATUS_REWORK, // Status especial de retrabalho
        assignedMechanic: targetMechanic, // Novo mecânico
        requiresAlignmentAfterRework: shouldReturnToAlignment, // Guarda a decisão
        reworkRequestedBy: currentUserName,
        reworkRequestedAt: serverTimestamp()
    };

    // 2. Marca o job de alinhamento como "perdido" para removê-lo da fila
    const alignmentUpdate = { status: STATUS_LOST };

    if (isDemoMode) {
        const serviceJobIndex = serviceJobs.findIndex(j => j.id === serviceJobId);
        if (serviceJobIndex !== -1) {
            serviceJobs[serviceJobIndex] = { ...serviceJobs[serviceJobIndex], ...serviceUpdate };
        }
        const alignmentJobIndex = alignmentQueue.findIndex(c => c.id === alignmentDocId);
        if (alignmentJobIndex !== -1) {
            alignmentQueue[alignmentJobIndex].status = STATUS_LOST;
        }
        alertUser(`MODO DEMO: Serviço retornado para ${targetMechanic}.`);
    } else {
        try {
            // Atualiza os dois documentos
            const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, serviceJobId);
            await updateDoc(serviceDocRef, serviceUpdate);

            const alignmentDocRef = doc(db, ALIGNMENT_COLLECTION_PATH, alignmentDocId);
            await updateDoc(alignmentDocRef, alignmentUpdate);

            alertUser(`Serviço do carro ${alignmentJob.licensePlate} retornado para ${targetMechanic}.`);
        } catch (error) {
            console.error("Erro ao retornar serviço para o mecânico:", error);
            alertUser("Erro ao salvar as alterações no banco de dados.");
        }
    }
}

function alertUser(message) {
    const serviceError = document.getElementById('service-error');
    const alignmentError = document.getElementById('alignment-error');

    if (serviceError) serviceError.textContent = message;
    if (alignmentError) alignmentError.textContent = message;

    setTimeout(() => {
        if (serviceError) serviceError.textContent = isDemoMode ? "As ações não serão salvas." : '';
        if (alignmentError) alignmentError.textContent = '';
    }, 3000);
}

// ------------------------------------
// 4. Renderização (Filas Ativas)
// ------------------------------------

function getTimestampSeconds(timestamp) {
    if (!timestamp) return 0;
    if (typeof timestamp.seconds === 'number') return timestamp.seconds;
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis() / 1000;
    return 0;
}

// =========================================================================
// CORREÇÃO: Função toggleDescription unificada e limpa
function toggleDescription(jobId) {
    const shortDescEl = document.getElementById(`desc-short-${jobId}`);
    const button = document.getElementById(`desc-btn-${jobId}`);

    if (!shortDescEl || !button) {
        console.error(`Elementos para o job ID '${jobId}' não encontrados.`);
        return;
    }

    const isExpanded = button.getAttribute('data-expanded') === 'true';
    const fullText = shortDescEl.getAttribute('data-full-text');
    const shortText = shortDescEl.getAttribute('data-short-text');

    // Alterna o conteúdo do parágrafo e o texto do botão
    shortDescEl.innerHTML = isExpanded ? shortText : fullText;
    button.textContent = isExpanded ? 'Ver mais' : 'Ver menos';
    button.setAttribute('data-expanded', !isExpanded);
}

// Disponibiliza a função no escopo global para que o `onclick` do HTML possa encontrá-la.
window.toggleDescription = toggleDescription;
// =========================================================================


function renderServiceQueues(jobs) {
    const mechanicsContainer = document.getElementById('mechanics-queue-display');
    const tireShopList = document.getElementById('tire-shop-list');
    const tireShopCount = document.getElementById('tire-shop-count');
    const mechanicViewContainer = document.getElementById('mechanic-view');

    if (!mechanicsContainer || !tireShopList || !tireShopCount || !mechanicViewContainer) {
        console.error("Erro: Elementos da UI de serviço não encontrados.");
        return;
    }

    mechanicsContainer.innerHTML = '';
    tireShopList.innerHTML = '';

    const pendingJobs = jobs.filter(job => job.status === STATUS_PENDING);
    const isManager = currentUserRole === MANAGER_ROLE;
    // ATUALIZAÇÃO: Vendedores agora também podem editar e excluir.
    const canEditAndDelete = currentUserRole === MANAGER_ROLE || currentUserRole === VENDEDOR_ROLE;

    const groupedJobs = {};
    MECHANICS.forEach(m => groupedJobs[m] = []);
    const tireShopJobs = [];

    pendingJobs.sort((a, b) => getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp));

    pendingJobs.forEach(job => {
        if ((job.statusGS === STATUS_PENDING || job.statusGS === STATUS_REWORK) && MECHANICS.includes(job.assignedMechanic)) {
            groupedJobs[job.assignedMechanic].push(job);
        }
        if (job.statusTS === STATUS_PENDING && job.assignedTireShop === TIRE_SHOP_MECHANIC) {
            tireShopJobs.push(job);
        }
    });

    const editIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>`;
    const lostIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;


    tireShopCount.textContent = `${tireShopJobs.length} Carros`;
    if (tireShopJobs.length > 0) {
         tireShopList.innerHTML = tireShopJobs.map(job => {
            const isGsPending = job.statusGS === STATUS_PENDING;
            const statusText = isGsPending ? `(Aguardando GS: ${job.assignedMechanic})` : '';
            const statusColor = isGsPending ? 'text-red-500' : 'text-gray-500';

            const managerActions = canEditAndDelete ? `
                <div class="flex space-x-1 mt-2 justify-end">
                    <button onclick="showEditServiceModal('${job.id}')" title="Editar Serviço"
                            class="p-1 text-xs text-blue-600 bg-blue-100 rounded-full hover:bg-blue-200 transition">
                        ${editIcon}
                    </button>
                    <button onclick="showMarkAsLostConfirmation('${job.id}')" title="Marcar como Perdido"
                            class="p-1 text-xs text-red-600 bg-red-100 rounded-full hover:bg-red-200 transition">
                        ${lostIcon}
                    </button>
                </div>
            ` : '';

            // CORREÇÃO: Lógica unificada para "Ver mais/Ver menos"
            // AGORA: Usa um modal para exibir o texto completo.
            let descriptionHTML = '';
            const descriptionText = job.serviceDescription || 'N/A';
            if (descriptionText.length > 15) {
                const shortText = `${descriptionText.substring(0, 15)}...`;
                descriptionHTML = `
                    <p class="text-sm ${statusColor} break-words">${shortText}</p>
                    <button onclick="showFullDescriptionModal(\`${escape(descriptionText)}\`)" class="text-xs text-blue-500 hover:underline mt-1">Ver mais</button>
                `;
            } else {
                descriptionHTML = `<p class="text-sm ${statusColor} break-words">${descriptionText}</p>`;
            }

            return `
                <li class="relative p-3 bg-white border-l-4 border-yellow-500 rounded-md shadow-sm min-h-[80px]">
                    <div class="pr-20">
                        <div>
                            <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel})</p>
                            ${descriptionHTML}
                            <p class="text-xs font-semibold ${statusColor} mt-1">${statusText}</p>
                        </div>
                    </div>
                    <div class="absolute top-3 right-3 flex flex-col items-end space-y-2">
                        <button onclick="showServiceReadyConfirmation('${job.id}', 'TS')"
                                class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition h-7">
                            Pronto
                        </button>
                        ${managerActions}
                    </div>
                </li>
            `;
         }).join('');
    } else {
        tireShopList.innerHTML = '<p class="text-sm text-gray-500 italic p-3 border rounded-md">Nenhum carro na fila. </p>';
    }
    if (MECHANICS.length === 0) {
         mechanicsContainer.innerHTML = '<p class="text-sm text-red-600 italic p-3 border rounded-md">Nenhum mecânico geral cadastrado. Por favor, adicione mecânicos na Aba de Serviços.</p>';
    }
    MECHANICS.forEach(mechanic => {
        const jobListHTML = groupedJobs[mechanic].map(job => {
            const isTsPending = job.statusTS === STATUS_PENDING;
            const isRework = job.statusGS === STATUS_REWORK; // NOVO: Verifica se é retrabalho

            const statusText = isRework ? '(RETRABALHO)' : isTsPending ? `(Aguardando Pneus)` : '';
            const statusColor = isRework ? 'text-orange-500' : isTsPending ? 'text-red-500' : 'text-gray-500';
            const borderColor = isRework ? 'border-orange-500' : 'border-blue-500'; // NOVO: Cor da borda para retrabalho
            const isDefined = job.isServiceDefined;

            const hasStarted = !!job.gsStartedAt;
            const isReadyButtonDisabled = !isDefined || isTsPending || !hasStarted;
            const readyButtonTitle = isTsPending ? "Aguardando conclusão do serviço de pneus." : !isDefined ? "Aguardando definição do serviço." : "Marcar como pronto";

            let descriptionHTML = '';
            let clickHandler = '';
            let cursorClass = '';

            if (!isDefined) {
                descriptionHTML = '<span class="font-bold text-red-600">(Aguardando Definição de Serviço)</span>';
                if (isManager) {
                    clickHandler = `onclick="showDefineServiceModal('${job.id}')"`;
                    cursorClass = 'cursor-pointer hover:bg-yellow-100/50 transition duration-150';
                    descriptionHTML += '<span class="text-xs text-blue-600 block mt-1">(Clique p/ definir)</span>';
                }
            } else {
                // AGORA: Usa um modal para exibir o texto completo.
                const descriptionText = job.serviceDescription || 'N/A';
                if (descriptionText.length > 15) {
                    const shortText = `${descriptionText.substring(0, 15)}...`;
                    descriptionHTML = `
                        <p class="text-sm ${statusColor} break-words">${shortText}</p>
                        <button onclick="showFullDescriptionModal(\`${escape(descriptionText)}\`)" class="text-xs text-blue-500 hover:underline mt-1">Ver mais</button>
                    `;
                } else {
                    descriptionHTML = `<p class="text-sm ${statusColor} break-words">${descriptionText}</p>`;
                }
            }

            const managerActions = canEditAndDelete ? `
                <div class="flex space-x-1 mt-2 pt-2 border-t border-gray-100">
                    <button onclick="showEditServiceModal('${job.id}')" title="Editar Serviço"
                            class="p-1 text-xs text-blue-600 bg-blue-100 rounded-full hover:bg-blue-200 transition">
                        ${editIcon}
                    </button>
                    <button onclick="showMarkAsLostConfirmation('${job.id}')" title="Marcar como Perdido"
                            class="p-1 text-xs text-red-600 bg-red-100 rounded-full hover:bg-red-200 transition">
                        ${lostIcon}
                    </button>
                </div>
            ` : '';

            return `
                <li class="relative p-3 bg-white border-l-4 ${borderColor} rounded-md shadow-sm min-h-[80px]">
                    <div class="pr-20 ${cursorClass}" ${clickHandler}>
                        <div>
                            <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel})</p>
                            ${descriptionHTML}
                            <p class="text-xs font-semibold ${statusColor} mt-1">${statusText}</p>
                        </div>
                    </div>
                    <div class="absolute top-3 right-3 flex flex-col items-end space-y-2">
                        <button onclick="showServiceReadyConfirmation('${job.id}', 'GS')"
                                class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed h-7"
                                ${!isDefined ? 'disabled' : ''} title="${!isDefined ? 'Aguardando definição do serviço' : 'Marcar como Pronto'}">
                            Pronto
                        </button>
                        ${managerActions}
                    </div>
                </li>
            `;
        }).join('');

        mechanicsContainer.innerHTML += `
            <div class="mechanic-card bg-gray-50 p-4 rounded-lg shadow-md border border-gray-100">
                <h3 class="text-xl font-bold mb-3 text-gray-800 flex justify-between items-center">
                    ${mechanic}
                    <span class="text-sm font-semibold py-1 px-3 rounded-full ${groupedJobs[mechanic].length > 1 ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800'}">
                        ${groupedJobs[mechanic].length} Carros
                    </span>
                </h3>
                <ul class="space-y-2">
                    ${jobListHTML.length > 0 ? jobListHTML : '<p class="text-sm text-gray-500 italic p-3 border rounded-md">Nenhum carro na fila. </p>'}
                </ul>
            </div>
        `;
    });

    // NOVO: Renderiza a visão exclusiva do mecânico (Req 1.4)
    if (currentUserRole === MECANICO_ROLE) {
        const myJobs = groupedJobs[currentUserName] || [];
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
                    // AGORA: Usa um modal para exibir o texto completo.
                    const descriptionText = job.serviceDescription || 'N/A';
                    if (descriptionText.length > 15) {
                        const shortText = `${descriptionText.substring(0, 15)}...`;
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
                    <p class="text-2xl mb-2"></p>
                    <p class="text-lg font-medium text-gray-700">Nenhum carro na sua fila no momento.</p>
                    <p class="text-gray-500">Aproveite para organizar a oficina!</p>
                </div>
            `;
        }
        mechanicViewContainer.innerHTML = mechanicViewHTML;
    }
}

function getSortedAlignmentQueue() {
     const activeCars = alignmentQueue.filter(car =>
        car.status === STATUS_WAITING ||
        car.status === STATUS_ATTENDING ||
        car.status === STATUS_WAITING_GS
    );

    activeCars.sort((a, b) => {
        const getPriority = (status) => {
            if (status === STATUS_ATTENDING) return 1;
            if (status === STATUS_WAITING) return 2;
            if (status === STATUS_WAITING_GS) return 3;
            return 4;
        };
        const priorityA = getPriority(a.status);
        const priorityB = getPriority(b.status);

        if (priorityA !== priorityB) return priorityA - priorityB;

        return getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp);
    });
    return activeCars;
}

function renderAlignmentMirror(cars) {
    const mirrorContainer = document.getElementById('alignment-mirror');
    if (!mirrorContainer) return;

    const activeCars = getSortedAlignmentQueue();

    let mirrorHTML = '';

    if (activeCars.length === 0) {
         mirrorHTML = '<p class="text-sm text-gray-500 italic p-3 text-center">Fila de Alinhamento vazia. </p>';
    } else {
        mirrorHTML = `
            <ul class="space-y-2">
                ${activeCars.map((car, index) => {
                    const isWaitingGS = car.status === STATUS_WAITING_GS;
                    const isAttending = car.status === STATUS_ATTENDING;

                    const statusClass = isAttending ? 'bg-yellow-100 text-yellow-800' :
                                        isWaitingGS ? 'bg-red-100 text-red-800' :
                                        'bg-blue-100 text-blue-800';

                    const statusText = isAttending ? 'Em Atendimento' :
                                       isWaitingGS ? `Aguardando GS` :
                                       'Disponível';

                    return `
                        <li class="p-3 bg-white rounded-md border border-gray-200 shadow-sm text-sm">
                            <div class="flex justify-between items-start">
                                <span class="font-semibold">${index + 1}. ${car.carModel} (${car.licensePlate})</span>
                                <span class="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass} flex-shrink-0 ml-2">
                                    ${statusText}
                                </span>
                            </div>
                            ${isWaitingGS ? `<div class="text-xs text-gray-500 pt-1 description-truncate" title="${car.gsDescription}">${car.gsDescription}</div>` : ''}
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
    }

    mirrorContainer.innerHTML = mirrorHTML;
}


function renderAlignmentQueue(cars) {
    const tableContainer = document.getElementById('alignment-table-container');
    const emptyMessage = document.getElementById('alignment-empty-message');

    if (!tableContainer || !emptyMessage) {
         console.error("Erro: Elementos da UI de alinhamento não encontrados.");
         return;
    }

    const activeCars = getSortedAlignmentQueue();

    if (activeCars.length === 0) {
        tableContainer.innerHTML = '';
        tableContainer.appendChild(emptyMessage);
        emptyMessage.style.display = 'block';
        return;
    } else {
        emptyMessage.style.display = 'none';
    }

    let tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modelo / Placa</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mover</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
    `;

    const nextCarIndex = activeCars.findIndex(c => c.status === STATUS_WAITING);

    activeCars.forEach((car, index) => {
        const isNextWaiting = (index === nextCarIndex);
        const isWaiting = car.status === STATUS_WAITING;
        const isAttending = car.status === STATUS_ATTENDING;
        const isWaitingGS = car.status === STATUS_WAITING_GS;

        // Ícones para as novas ações (sem alterações aqui, apenas para contexto)
        const discardIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
        const returnIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>`;
        const finalizeIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>`;

        const statusColor = isAttending ? 'bg-yellow-100 text-yellow-800' :
                            isWaitingGS ? 'bg-red-100 text-red-800' :
                            'bg-blue-100 text-blue-800';

        const statusText = isAttending ? 'Em Atendimento' : isWaitingGS ? `Aguardando GS` : 'Disponível para Alinhar';

        const rowClass = isWaitingGS ? 'bg-red-50/50' : (isNextWaiting ? 'bg-yellow-50/50' : '');

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
                        ${!canMove || isFirstWaiting ? 'disabled' : ''} title="Mover para cima">
                    &#9650;
                </button>
                <button onclick="moveAlignmentDown('${car.id}')"
                        class="text-sm p-1 rounded-full text-blue-600 hover:bg-gray-200 disabled:text-gray-300 transition"
                        ${!canMove || isLastWaiting ? 'disabled' : ''} title="Mover para baixo">
                    &#9660;
                </button>
            </div>
        `;


        let actions;

        // Ações disponíveis para Alinhador ou Gerente
        const canTakeAction = currentUserRole === ALIGNER_ROLE || currentUserRole === MANAGER_ROLE;
        const isManager = currentUserRole === MANAGER_ROLE;

        if (isAttending) {
             actions = `
                 <div class="flex items-center space-x-2 justify-end">
                    ${isManager ? `
                        <button onclick="showReturnToMechanicModal('${car.id}')" title="Retornar ao Mecânico" class="p-2 text-blue-600 hover:bg-blue-100 rounded-full transition">${returnIcon}</button>
                        <button onclick="showDiscardAlignmentConfirmation('${car.id}')" title="Descartar / Perdido" class="p-1 text-red-600 hover:bg-red-100 rounded-full transition">${discardIcon}</button>
                    ` : ''}
                     <button onclick="showAlignmentReadyConfirmation('${car.id}')"
                         class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-md hover:bg-green-600 transition"
                         ${!canTakeAction ? 'disabled' : ''}>
                         Pronto
                     </button>
                 </div>
             `;
        } else if (isNextWaiting) {
            actions = `
                <div class="flex items-center space-x-2 justify-end">
                    ${isManager ? `
                        <button onclick="showReturnToMechanicModal('${car.id}')" title="Retornar ao Mecânico" class="p-2 text-blue-600 hover:bg-blue-100 rounded-full transition" ${!car.serviceJobId ? 'disabled title="Ação não permitida para adição manual"' : ''}>${returnIcon}</button>
                        <button onclick="showDiscardAlignmentConfirmation('${car.id}')" title="Descartar / Perdido" class="p-1 text-red-600 hover:bg-red-100 rounded-full transition">${discardIcon}</button>
                    ` : ''}
                    <button onclick="updateAlignmentStatus('${car.id}', '${STATUS_ATTENDING}')"
                        class="text-xs font-medium bg-yellow-500 text-white py-1 px-3 rounded-md hover:bg-yellow-600 transition"
                        ${!canTakeAction ? 'disabled' : ''}>
                        Iniciar
                    </button>
                </div>
            `;
        } else {
            // Para os outros carros na fila, também permite descartar ou retornar, se tiverem permissão.
            actions = `
                <div class="flex items-center space-x-2 justify-end">
                    ${isManager ? `
                        <button onclick="showReturnToMechanicModal('${car.id}')" title="Retornar ao Mecânico" class="p-2 text-blue-600 hover:bg-blue-100 rounded-full transition" ${!car.serviceJobId ? 'disabled title="Ação não permitida para adição manual"' : ''}>${returnIcon}</button>
                        <button onclick="showDiscardAlignmentConfirmation('${car.id}')" title="Descartar / Perdido" class="p-1 text-red-600 hover:bg-red-100 rounded-full transition">${discardIcon}</button>
                    ` : ''}
                    <span class="text-xs text-gray-400 pr-2">Na fila...</span>
                </div>
            `;
        }


        tableHTML += `
            <tr class="${rowClass}">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${index + 1}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    <span class="font-semibold">${car.carModel}</span>
                    <span class="text-xs text-gray-500 block">${car.licensePlate}</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${car.customerName} (Vendedor: ${car.vendedorName || 'N/A'})</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex flex-col">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor} self-start">
                            ${statusText}
                        </span>
                        ${isWaitingGS ? `<div class="text-xs text-gray-500 pt-1 description-truncate" title="${car.gsDescription}">${car.gsDescription}</div>` : ''}
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowTRap text-center text-sm font-medium">
                    ${moverButtons}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    ${actions}
                </td>
            </tr>
        `;
    });

    tableHTML += `</tbody></table>`;
    tableContainer.innerHTML = tableHTML;
    tableContainer.prepend(emptyMessage);
    emptyMessage.style.display = 'none';
}

function renderReadyJobs(serviceJobs, alignmentQueue) {
    const container = document.getElementById('ready-jobs-container');
    const emptyMessage = document.getElementById('ready-empty-message');

    if (!container || !emptyMessage) {
         console.error("Erro: Elementos da UI de pagamentos não encontrados.");
         return;
    }

    const readyServiceJobs = serviceJobs
        .filter(job => job.status === STATUS_READY)
        .map(job => ({ ...job, source: 'service', sortTimestamp: getTimestampSeconds(job.timestamp) }));

    const readyAlignmentJobs = alignmentQueue
        .filter(car => car.status === STATUS_READY)
        .map(car => ({ ...car, source: 'alignment', sortTimestamp: getTimestampSeconds(car.readyAt) }));

    const readyJobs = [...readyServiceJobs, ...readyAlignmentJobs];
    readyJobs.sort((a, b) => a.sortTimestamp - b.sortTimestamp);

    if (readyJobs.length === 0) {
        container.innerHTML = '';
        container.appendChild(emptyMessage);
        emptyMessage.style.display = 'block';
        return;
    } else {
         emptyMessage.style.display = 'none';
    }

    let tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-100">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origem</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modelo / Placa</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente (Vendedor)</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serviço/Mecânico</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status (Pronto)</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações (Gerente)</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
            `;

            readyJobs.forEach(job => {
                const isService = job.source === 'service';
                const serviceInfo = isService ? job.assignedMechanic : ALIGNMENT_MECHANIC;
                const serviceDetail = isService ? job.serviceDescription : 'Revisão de Geometria/Balanceamento';
                const readyTimestamp = job.readyAt || job.timestamp;
                const readyTime = new Date(getTimestampSeconds(readyTimestamp) * 1000).toLocaleTimeString('pt-BR');


                tableHTML += `
                    <tr class="ready-row">
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium ${isService ? 'text-blue-700' : 'text-yellow-700'}">${isService ? 'Mecânica' : 'Alinhamento'}</td>
                        <td class="px-6 py-4 whitespace-nowlrap text-sm font-medium text-gray-900">
                             <span class="font-semibold">${job.carModel || 'N/A'}</span>
                             <span class="text-xs text-gray-500 block">${job.licensePlate}</span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${job.customerName} (${job.vendedorName || 'N/A'})</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            <div class="description-truncate" title="${serviceDetail}">${serviceInfo} (${serviceDetail})</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-200 text-green-800">
                                PRONTO (${readyTime})
                            </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button onclick="showFinalizeConfirmation('${job.id}', '${job.source}')"
                                class="text-sm font-medium bg-red-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-red-700 transition duration-150 ease-in-out"
                                ${currentUserRole !== MANAGER_ROLE ? 'disabled' : ''}>
                                Finalizar e Receber
                            </button>
                        </td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table>`;
            container.innerHTML = tableHTML;
            container.prepend(emptyMessage);
            emptyMessage.style.display = 'none';
        }

        // =========================================================================
        // NOVO: Funções de Dashboard (Substitui calculateAndRenderDailyStats)
        // =========================================================================

        // --- Helpers do Dashboard ---
        // NOVO: Função genérica para obter o início de um dia
        function getStartOfDayTimestamp(date = new Date()) {
            const start = new Date(date);
            start.setHours(0, 0, 0, 0);
            return Timestamp.fromDate(start);
        }

        // NOVO: Função genérica para verificar se um timestamp pertence a um dia específico
        function isTimestampFromDay(timestamp, targetDate) {
            if (!timestamp) return false;
            const startOfDay = getStartOfDayTimestamp(targetDate);
            const endOfDay = new Date(startOfDay.toDate());
            endOfDay.setHours(23, 59, 59, 999);

            const jobTime = new Timestamp(getTimestampSeconds(timestamp), timestamp.nanoseconds || 0);

            return jobTime >= startOfDay && jobTime <= Timestamp.fromDate(endOfDay);
        }

        // NOVO: Helper para verificar se o timestamp é desta semana
        function isTimestampFromThisWeek(timestamp) {
            if (!timestamp) return false;
            const now = new Date();
            const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
            startOfWeek.setHours(0, 0, 0, 0);
            return new Timestamp(getTimestampSeconds(timestamp), 0) >= Timestamp.fromDate(startOfWeek);
        }

        // NOVO: Helper para verificar se o timestamp é dos últimos 31 dias
        function isTimestampFromLast31Days(timestamp) {
            if (!timestamp) return false;
            const thirtyOneDaysAgo = new Date();
            thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
            return new Timestamp(getTimestampSeconds(timestamp), 0) >= Timestamp.fromDate(thirtyOneDaysAgo);
        }

        // NOVO: Helper para verificar se o timestamp é deste mês
        function isTimestampFromThisMonth(timestamp) {
            if (!timestamp) return false;
            return new Date(getTimestampSeconds(timestamp) * 1000).getMonth() === new Date().getMonth();
        }

        // NOVO: Helper para verificar se o timestamp é de um ano específico
        function isTimestampFromYear(timestamp, year) {
            if (!timestamp) return false;
            return new Date(getTimestampSeconds(timestamp) * 1000).getFullYear() === year;
        }

        // NOVO: Helper para verificar se o timestamp é de um mês/ano específico
        function isTimestampFromMonthAndYear(timestamp, month, year) {
            if (!timestamp) return false;ntendeu
            const date = new Date(getTimestampSeconds(timestamp) * 1000);
            return date.getFullYear() === year && date.getMonth() === month;
        }

        function calculateDuration(startTimestamp, endTimestamp) {
            if (!startTimestamp || !endTimestamp) return 0;
            const startMs = getTimestampSeconds(startTimestamp) * 1000;
            const endMs = getTimestampSeconds(endTimestamp) * 1000;
            return endMs - startMs; // Duração em milissegundos
        }

        function formatDuration(ms) {
            if (ms <= 0 || !ms) return '--';
            const totalMinutes = Math.floor(ms / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            if (hours > 0) return `${hours}h ${minutes}min`;
            return `${minutes} min`;
        }

        function formatTime(timestamp) {
            if (!timestamp) return '--';
            const date = new Date(getTimestampSeconds(timestamp) * 1000);
            return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        function calculateAvg(arr) {
            if (!arr || arr.length === 0) return 0;
            const sum = arr.reduce((a, b) => a + b, 0);
            return sum / arr.length;
        }
        // --- Fim dos Helpers ---

        // NOVO: Renderiza os contadores de pendências
        function renderPendingCounts() {
            const container = document.getElementById('pending-counts-container');
            if (!container) return;

            // CORREÇÃO: A contagem de pendências deve incluir serviços em retrabalho (REWORK)
            // e também garantir que o status geral do job seja 'Pendente'.
            const pendingGsJobs = serviceJobs.filter(j => j.status === STATUS_PENDING && (j.statusGS === STATUS_PENDING || j.statusGS === STATUS_REWORK));
            // CORREÇÃO: A contagem de pneus não deve incluir serviços que estão em retrabalho (REWORK) na mecânica geral.
            const pendingTsJobs = serviceJobs.filter(j => j.status === STATUS_PENDING && j.statusTS === STATUS_PENDING && j.statusGS !== STATUS_REWORK);
            // A contagem de alinhamento já estava correta.
            const pendingAliJobs = alignmentQueue.filter(j => j.status === STATUS_WAITING || j.status === STATUS_ATTENDING);

            const counts = {};
            [...MECHANICS, TIRE_SHOP_MECHANIC, ALIGNMENT_MECHANIC].forEach(m => counts[m] = 0);

            pendingGsJobs.forEach(job => {
                if (counts[job.assignedMechanic] !== undefined) {
                    counts[job.assignedMechanic]++;
                }
            });
            counts[TIRE_SHOP_MECHANIC] = pendingTsJobs.length;
            counts[ALIGNMENT_MECHANIC] = pendingAliJobs.length;

            let html = '';
            Object.keys(counts).forEach(name => {
                const count = counts[name];
                const color = count > 2 ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800';
                html += `
                    <div class="text-center p-3 rounded-lg border bg-white">
                        <p class="text-sm font-medium text-gray-600">${name}</p>
                        <p class="text-2xl font-bold ${color.split(' ')[1]}">${count}</p>
                    </div>
                `;
            });
            container.innerHTML = html;
        }

        // NOVO: Renderiza os contadores de resumo do dia
        function renderDailySummary() {
            const container = document.getElementById('daily-summary-container');
            if (!container) return;

            // ATUALIZADO: Usa a função de filtro de período correta
            let periodFilterFn;
            // NOVO: Se for diário, verifica se uma data específica foi selecionada
            if (historyPeriod === 'daily') {
                const targetDate = historyDate ? new Date(historyDate + 'T00:00:00') : new Date();
                periodFilterFn = (ts) => isTimestampFromDay(ts, targetDate);
            }
            else if (historyPeriod === 'weekly') { periodFilterFn = isTimestampFromThisWeek; }
            else if (historyPeriod === 'monthly') {
                periodFilterFn = (ts) => isTimestampFromMonthAndYear(ts, historyMonth, historyYear);
            } else if (historyPeriod === 'yearly') {
                periodFilterFn = (ts) => isTimestampFromYear(ts, historyYear);
            }

            const periodLabel = { daily: 'Hoje', weekly: 'na Semana', monthly: 'no Mês' }[historyPeriod];


            const finalizedServicesToday = serviceJobs.filter(j => j.status === STATUS_FINALIZED && periodFilterFn(j.finalizedAt)).length;
            // CORREÇÃO: A contagem de perdidos deve incluir tanto os serviços gerais quanto os de alinhamento.
            const lostServicesToday = serviceJobs.filter(j => j.status === STATUS_LOST && periodFilterFn(j.finalizedAt)).length;
            const lostAlignmentsToday = alignmentQueue.filter(a => a.status === STATUS_LOST && periodFilterFn(a.finalizedAt)).length;
            const totalLostToday = lostServicesToday + lostAlignmentsToday;

            container.innerHTML = `
                <div class="flex justify-between items-center p-3 bg-green-100 rounded-lg">
                    <span class="font-semibold text-green-800">Serviços Concluídos</span>
                    <span class="text-xl font-bold text-green-900">${finalizedServicesToday}</span>
                </div>
                <div class="flex justify-between items-center p-3 bg-red-100 rounded-lg">
                    <span class="font-semibold text-red-800">Serviços Perdidos (${periodLabel})</span>
                    <span class="text-xl font-bold text-red-900">${totalLostToday}</span>
                </div>
            `;
        }




        /**
         * NOVO: Calcula e renderiza todo o Dashboard de Desempenho (Req 2.x e 3.x)
         */
        function calculateAndRenderDashboard() {

            // =================================================================
            // ETAPA 1: Coletar e Processar Dados do Dia
            // =================================================================

            // ATUALIZADO: Seleciona a função de filtro com base no estado `historyPeriod`
            let periodFilterFn;
            // CORREÇÃO: Removida a chamada para a função antiga 'isTimestampFromToday' e unificada a lógica.
            if (historyPeriod === 'daily') {
                const targetDate = historyDate ? new Date(historyDate + 'T00:00:00') : new Date();
                periodFilterFn = (ts) => isTimestampFromDay(ts, targetDate);
            } else if (historyPeriod === 'weekly') {
                periodFilterFn = isTimestampFromThisWeek;
            } else if (historyPeriod === 'monthly') {
                periodFilterFn = (ts) => isTimestampFromMonthAndYear(ts, historyMonth, historyYear);
            } else if (historyPeriod === 'yearly') {
                periodFilterFn = (ts) => isTimestampFromYear(ts, historyYear);
            }


            // ATUALIZAÇÃO: Chama as novas funções de renderização operacional
            renderPendingCounts();
            renderDailySummary();

            const finalizedServicesToday = serviceJobs.filter(j => j.status === STATUS_FINALIZED && periodFilterFn(j.finalizedAt));
            const finalizedAlignmentsToday = alignmentQueue.filter(a => a.status === STATUS_FINALIZED && periodFilterFn(a.finalizedAt));

            // Limpa os arrays de métricas globais antes de recalcular
            allWaitTimes = [];
            allGsDurations = [];
            allTsDurations = [];
            allAliDurations = [];
 
            // Limpa as listas de histórico antes de recalcular.
            detailedHistoryList = []; // Limpa a lista de histórico detalhado
            performanceList = []; // Limpa a lista de desempenho

            lostHistoryList = []; // Limpa a lista de histórico de perdas
            
            // Inicializa stats para todos os mecânicos, incluindo os fixos e os do DB
            mechanicStats = {}; // Limpa o objeto global antes de recalcular
            [...MECHANICS, TIRE_SHOP_MECHANIC, ALIGNMENT_MECHANIC].forEach(m => {
                mechanicStats[m] = {
                    count: 0,
                    totalDurationMs: 0
                };
            });

            // Junta todos os serviços do dia (finalizados e perdidos) para processamento
            const allServicesToday = serviceJobs.filter(j => (j.status === STATUS_FINALIZED || j.status === STATUS_LOST) && periodFilterFn(j.finalizedAt));

            // Processa Serviços Gerais (que podem incluir borracharia e alinhamento) - FINALIZADOS
            allServicesToday.filter(j => j.status === STATUS_FINALIZED).forEach(job => {
                const totalDurationMs = calculateDuration(job.timestamp, job.finalizedAt);
                const mechanic = job.assignedMechanic;

                const etapas = ['Serviço Geral'];
                const mecsEnvolvidos = [mechanic];

                // --- Cálculo de Duração por Etapa (Req 5.3) ---
                const waitTimeMs = calculateDuration(job.timestamp, job.gsStartedAt);
                const gsDurationMs = calculateDuration(job.gsStartedAt, job.gsFinishedAt);
                const tsDurationMs = calculateDuration(job.tsStartedAt, job.tsFinishedAt);
                if (waitTimeMs > 0) allWaitTimes.push(waitTimeMs);
                // CORREÇÃO: Garante que a etapa seja contada mesmo se a duração for 0.
                // Apenas durações positivas são usadas para calcular a média.
                if (job.gsFinishedAt) {
                    allGsDurations.push(gsDurationMs > 0 ? gsDurationMs : 0);
                }

                // Adiciona stats do Mecânico Geral
                if (mechanicStats[mechanic]) {
                    mechanicStats[mechanic].count++; // Contagem por profissional
                    // A performance do mecânico é medida pelo tempo de trabalho real
                    mechanicStats[mechanic].totalDurationMs += gsDurationMs > 0 ? gsDurationMs : totalDurationMs;
                }

                // Adiciona stats de Borracharia (se houver)
                if (job.statusTS === STATUS_TS_FINISHED) {
                    etapas.push('Borracharia');
                    mecsEnvolvidos.push(TIRE_SHOP_MECHANIC);
                    // A participação do borracheiro é contada, mas a duração é difícil de isolar,
                    // então contamos apenas a ocorrência e a duração se disponível.
                    if (mechanicStats[TIRE_SHOP_MECHANIC]) {
                        mechanicStats[TIRE_SHOP_MECHANIC].count++;
                    }
                }

                // Adiciona stats de Alinhamento (se houver)
                let aliDurationMs = 0;
                if (job.requiresAlignment) {
                    const aliJob = finalizedAlignmentsToday.find(a => a.serviceJobId === job.id);
                    if (aliJob) {
                        etapas.push('Alinhamento');
                        mecsEnvolvidos.push(ALIGNMENT_MECHANIC);

                        aliDurationMs = calculateDuration(aliJob.alignmentStartedAt, aliJob.readyAt);
                        // CORREÇÃO: Garante que a etapa seja contada mesmo se a duração for 0.
                        // Apenas durações positivas são usadas para calcular a média.
                        if (aliJob.readyAt) {
                            allAliDurations.push(aliDurationMs > 0 ? aliDurationMs : 0);
                        }

                        if (mechanicStats[ALIGNMENT_MECHANIC]) {
                            mechanicStats[ALIGNMENT_MECHANIC].count++;
                            mechanicStats[ALIGNMENT_MECHANIC].totalDurationMs += aliDurationMs;
                        }
                    }
                }

                // Identifica o gargalo para este carro (Req 5.5)
                const stageDurations = {
                    'Espera Inicial': waitTimeMs,
                    'Serviço Geral': gsDurationMs,
                    'Alinhamento': aliDurationMs
                };
                const bottleneckStage = Object.keys(stageDurations).reduce((a, b) => stageDurations[a] > stageDurations[b] ? a : b);

                detailedHistoryList.push({
                    id: job.id, // CORREÇÃO: Adicionando o ID para o modal de detalhes
                    car: `${job.licensePlate} (${job.carModel})`,
                    car: `${job.licensePlate} (${job.carModel || 'N/A'})`,
                    vendedor: job.vendedorName,
                    mechanics: Array.from(new Set(mecsEnvolvidos)).join(', '), // Garante mecânicos únicos
                    etapas: etapas.join(', '),
                    startTime: formatTime(job.timestamp),
                    endTime: formatTime(job.finalizedAt),
                    durationMs: totalDurationMs,
                    durationStr: formatDuration(totalDurationMs),
                    bottleneck: (Math.max(waitTimeMs, gsDurationMs, aliDurationMs) > 0) ? bottleneckStage : null
                });
            });

            // NOVO: Processa serviços perdidos para o histórico de perdas
            allServicesToday.filter(j => j.status === STATUS_LOST).forEach(job => {
                let etapaPerda = 'Entrada'; // Padrão
                if (job.statusGS === STATUS_PENDING && !job.gsStartedAt) {
                    etapaPerda = 'Fila de Serviço Geral';
                } else if (job.statusGS === STATUS_PENDING && job.gsStartedAt) {
                    etapaPerda = 'Em Serviço Geral';
                } else if (job.statusTS === STATUS_PENDING) {
                    etapaPerda = 'Fila da Borracharia';
                }
                lostHistoryList.push({
                    car: `${job.licensePlate} (${job.carModel})`,
                    car: `${job.licensePlate} (${job.carModel || 'N/A'})`,
                    vendedor: job.vendedorName,
                    etapa: etapaPerda
                });
            });

            // CORREÇÃO: Adiciona os serviços de alinhamento perdidos ao histórico de perdas.
            // A contagem no resumo já estava correta, mas a lista do histórico não os incluía.
            const lostAlignmentsToday = alignmentQueue.filter(a => a.status === STATUS_LOST && periodFilterFn(a.finalizedAt));
            lostAlignmentsToday.forEach(job => {
                lostHistoryList.push({
                    car: `${job.licensePlate} (${job.carModel || 'N/A'})`,
                    vendedor: job.vendedorName,
                    etapa: 'Fila de Alinhamento' // Define a etapa da perda para alinhamentos.
                });
            });


            // Processa Alinhamentos Manuais (que não têm serviceJobId)
            finalizedAlignmentsToday.filter(c => c.status === STATUS_FINALIZED).forEach(car => {
                if (car.serviceJobId) return; // Já foi processado acima

                const totalDurationMs = calculateDuration(car.timestamp, car.finalizedAt);
                const aliDurationMs = calculateDuration(car.alignmentStartedAt, car.readyAt);
                // CORREÇÃO: Garante que a etapa seja contada mesmo se a duração for 0.
                // Apenas durações positivas são usadas para calcular a média.
                if (car.readyAt) {
                    allAliDurations.push(aliDurationMs > 0 ? aliDurationMs : 0);
                }

                if (mechanicStats[ALIGNMENT_MECHANIC]) {
                    mechanicStats[ALIGNMENT_MECHANIC].count++;
                    mechanicStats[ALIGNMENT_MECHANIC].totalDurationMs += aliDurationMs > 0 ? aliDurationMs : totalDurationMs;
                }

                detailedHistoryList.push({
                    id: car.id, // CORREÇÃO: Adicionando o ID para o modal de detalhes
                    car: `${car.licensePlate} (${car.carModel})`,
                    car: `${car.licensePlate} (${car.carModel || 'N/A'})`,
                    vendedor: car.vendedorName,
                    mechanics: Array.from(new Set([ALIGNMENT_MECHANIC])).join(', '),
                    etapas: 'Alinhamento',
                    startTime: formatTime(car.timestamp),
                    endTime: formatTime(car.finalizedAt),
                    durationMs: totalDurationMs,
                    durationStr: formatDuration(totalDurationMs),
                    bottleneck: 'Alinhamento'
                });
            });

            // Ordena o histórico por horário de término, do mais recente para o mais antigo.
            detailedHistoryList.sort((a, b) => b.endTime.localeCompare(a.endTime));

            // =================================================================
            // ETAPA 2: Calcular Métricas Agregadas (Req 5.4, 5.5)
            // =================================================================

            // --- Desempenho por Mecânico (Req 5.4) ---
            performanceList = []; // ATUALIZADO: Limpa a lista global em vez de criar uma nova local.
            Object.keys(mechanicStats).forEach(name => {
                const stats = mechanicStats[name];
                if (stats.count > 0) { // Só mostra quem trabalhou
                    performanceList.push({
                        name: name,
                        count: stats.count,
                        // Média calculada apenas em jobs que o mecânico foi o principal
                        avgMs: (stats.totalDurationMs > 0) ? (stats.totalDurationMs / stats.count) : 0
                    });
                }
            });

            // Filtra mecânicos com tempo médio > 0 para ranking de eficiência
            const eligibleForRanking = performanceList.filter(m => m.avgMs > 0);

            // --- Destaques (Req 5.5) ---
            let bestPerformer = { name: '--', avgStr: '--' };
            let worstPerformer = { name: '--', avgStr: '--' };
            let bestPerformerJob = null; // NOVO: Para armazenar o job específico
            let worstPerformerJob = null; // NOVO: Para armazenar o job específico

            if (eligibleForRanking.length > 0) {
                // Lógica de Score: 60% peso para tempo baixo, 40% para quantidade alta.
                const maxCount = Math.max(...eligibleForRanking.map(m => m.count), 0);
                const maxAvgMs = Math.max(...eligibleForRanking.map(m => m.avgMs), 0);
    
                eligibleForRanking.forEach(m => {
                    const normalizedCount = maxCount > 0 ? (m.count / maxCount) : 0;
                    const normalizedTime = maxAvgMs > 0 ? (m.avgMs / maxAvgMs) : 0;
                    // Score: 40% para contagem, 60% para tempo (invertido, pois tempo menor é melhor)
                    m.score = (0.4 * normalizedCount) + (0.6 * (1 - normalizedTime));
                });
    
                const sortedByScore = [...eligibleForRanking].sort((a, b) => b.score - a.score);
                const best = sortedByScore[0];
                const worst = sortedByScore[sortedByScore.length - 1];
    
                bestPerformer = { name: best.name, avgStr: formatDuration(best.avgMs) };
                worstPerformer = { name: worst.name, avgStr: formatDuration(worst.avgMs) };
    
                // NOVO: Encontra o melhor serviço do melhor mecânico e o pior do pior.
                const bestPerformerServices = detailedHistoryList.filter(item => item.mechanics && item.mechanics.includes(best.name));
                if (bestPerformerServices.length > 0) {
                    bestPerformerJob = bestPerformerServices.sort((a, b) => a.durationMs - b.durationMs)[0];
                }
                const worstPerformerServices = detailedHistoryList.filter(item => item.mechanics && item.mechanics.includes(worst.name));
                if (worstPerformerServices.length > 0) {
                    worstPerformerJob = worstPerformerServices.sort((a, b) => b.durationMs - a.durationMs)[0];
                }
            }

            let slowestCar = { car: '--', avgStr: '--' };
            let fastestCar = { car: '--', avgStr: '--' };
            if (detailedHistoryList.length > 0) {
                const sortedByDuration = [...detailedHistoryList].sort((a, b) => a.durationMs - b.durationMs);

                slowestCar = sortedByDuration[sortedByDuration.length - 1];
                const bottleneckInfo = slowestCar.bottleneck ? `Gargalo: ${slowestCar.bottleneck}` : '';
                slowestCar.avgStr = `${slowestCar.durationStr}`;
                if (bottleneckInfo) slowestCar.avgStr += ` (${bottleneckInfo})`;

                fastestCar = sortedByDuration[0];
                const etapasInfo = fastestCar.etapas ? `Etapas: ${fastestCar.etapas}` : '';
                fastestCar.avgStr = `${fastestCar.durationStr}`;
                if (etapasInfo) fastestCar.avgStr += ` (${etapasInfo})`;
            }

            // --- Métricas por Etapa (Req 5.4) ---
            const avgWaitTimeMs = calculateAvg(allWaitTimes);
            const avgGsTimeMs = calculateAvg(allGsDurations);
            const avgTsTimeMs = calculateAvg(allTsDurations); // CORREÇÃO: Variável declarada aqui.
            const avgAliTimeMs = calculateAvg(allAliDurations);
            const minWaitTimeMs = allWaitTimes.length > 0 ? Math.min(...allWaitTimes) : 0;
            const maxWaitTimeMs = allWaitTimes.length > 0 ? Math.max(...allWaitTimes) : 0;
            const minGsTimeMs = allGsDurations.length > 0 ? Math.min(...allGsDurations) : 0;
            const maxGsTimeMs = allGsDurations.length > 0 ? Math.max(...allGsDurations) : 0;
            const minAliTimeMs = allAliDurations.length > 0 ? Math.min(...allAliDurations) : 0;
            const maxAliTimeMs = allAliDurations.length > 0 ? Math.max(...allAliDurations) : 0;


            // =================================================================
            // ETAPA 3: Renderizar o Dashboard (Req 5.4, 5.5)
            // =================================================================

            // Renderiza Destaques (Req 5.5)
            document.getElementById('dash-best-performer').textContent = bestPerformer.name;
            document.getElementById('dash-best-performer-avg').textContent = bestPerformer.avgStr;
            // ATUALIZADO: Armazena o job específico para o clique, em vez do nome do mecânico.
            dashboardHighlightData.bestPerformer = bestPerformerJob ? { id: bestPerformerJob.id, type: bestPerformerJob.etapas } : null;
            dashboardHighlightData.worstPerformer = worstPerformerJob ? { id: worstPerformerJob.id, type: worstPerformerJob.etapas } : null;
            dashboardHighlightData.slowestCar = slowestCar.id ? { id: slowestCar.id, type: slowestCar.etapas } : null;
            dashboardHighlightData.fastestCar = fastestCar.id ? { id: fastestCar.id, type: fastestCar.etapas } : null;
            document.getElementById('dash-worst-performer').textContent = worstPerformer.name;
            document.getElementById('dash-worst-performer-avg').textContent = worstPerformer.avgStr;
            document.getElementById('dash-slowest-car').textContent = slowestCar.car;
            document.getElementById('dash-slowest-car-avg').textContent = slowestCar.avgStr;
            document.getElementById('dash-fastest-car').textContent = fastestCar.car; // Corrigido
            document.getElementById('dash-fastest-car-avg').textContent = fastestCar.avgStr;

            // Renderiza Métricas por Etapa (NOVO)
            const stageMetricsContainer = document.getElementById('dashboard-stage-metrics');
            let stageMetricsHTML = '';
            const stageData = [
                { title: 'Espera na Fila', avg: avgWaitTimeMs, min: minWaitTimeMs, max: maxWaitTimeMs, color: 'border-yellow-400' },
                { title: 'Serviço Geral', avg: avgGsTimeMs, min: minGsTimeMs, max: maxGsTimeMs, color: 'border-blue-400', count: allGsDurations.length },
                { title: 'Borracharia', avg: avgTsTimeMs, min: 0, max: 0, color: 'border-gray-400', count: mechanicStats[TIRE_SHOP_MECHANIC]?.count || 0 }, // Duração da borracharia não é medida ainda
                { title: 'Alinhamento', avg: avgAliTimeMs, min: minAliTimeMs, max: maxAliTimeMs, color: 'border-indigo-400', count: allAliDurations.length }
            ];

            stageData.forEach(stage => {
                if (stage.count > 0) { // Mostra se a etapa ocorreu
                    const avgText = stage.avg > 0 ? `<strong>${formatDuration(stage.avg)}</strong> (média)` : `(${stage.count}x)`;
                    stageMetricsHTML += `
                        <div class="p-3 rounded-lg border-l-4 ${stage.color} bg-gray-50">
                            <p class="font-semibold text-gray-800">${stage.title} <span class="text-xs font-normal text-gray-500">(${stage.count} serviço${stage.count > 1 ? 's' : ''})</span></p>
                            <div class="flex justify-between items-baseline mt-1">
                                <span class="text-xs text-gray-500">${stage.min > 0 ? `Mín: <strong class="text-green-600">${formatDuration(stage.min)}</strong>` : ''}</span>
                                <span class="text-lg font-bold text-gray-900">${avgText}</span>
                                <span class="text-xs text-gray-500">${stage.max > 0 ? `Máx: <strong class="text-red-600">${formatDuration(stage.max)}</strong>` : ''}</span>
                            </div>
                        </div>
                    `;
                }
            });

            if (stageMetricsHTML === '') {
                stageMetricsHTML = '<p class="text-sm text-gray-500 italic text-center">Aguardando dados de etapas finalizadas...</p>';
            }
            stageMetricsContainer.innerHTML = stageMetricsHTML;

            // Renderiza Métricas por Equipe (NOVO)
            const teamMetricsContainer = document.getElementById('dashboard-team-metrics');
            let teamMetricsHTML = '';
            if (performanceList.length > 0) {
                performanceList.sort((a,b) => (b.score || 0) - (a.score || 0));

                const roleMap = {
                    [TIRE_SHOP_MECHANIC]: 'Borracheiro',
                    [ALIGNMENT_MECHANIC]: 'Alinhador'
                };
                systemUsers.forEach(u => { roleMap[u.username] = u.role });

                teamMetricsHTML = performanceList.map(mec => {
                    const role = roleMap[mec.name] || 'N/A';
                    const avgText = mec.avgMs > 0 ? `${formatDuration(mec.avgMs)}` : 'N/A';
                    return `
                        <div class="flex justify-between items-center text-sm p-2 rounded-md even:bg-gray-50 hover:bg-blue-50 cursor-pointer" onclick="showMechanicPerformanceModal('${mec.name}')">
                            <span class="font-semibold text-gray-800">${mec.name}</span>
                            <span class="text-gray-600">${avgText} (média em ${mec.count} carro${mec.count > 1 ? 's' : ''})</span>
                        </div>
                    `;
                }).join('');
            } else {
                teamMetricsHTML = '<p class="text-sm text-gray-500 italic text-center">Aguardando dados de equipes...</p>';
            }
            teamMetricsContainer.innerHTML = teamMetricsHTML;

            // Renderiza Histórico Detalhado (Req 5.5)
            const historyTbody = document.getElementById('dashboard-history-tbody');
            if (historyTbody) {
                if (detailedHistoryList.length > 0) {
                     historyTbody.innerHTML = detailedHistoryList.map(item => {
                        const durationClass = item.durationMs > (3600000 * 2) ? 'text-red-600' : item.durationMs < 1800000 ? 'text-green-600' : 'text-gray-900';
                        return `
                    <tr class="even:bg-gray-50/50 hover:bg-blue-50 cursor-pointer" onclick="showHistoryDetailModal('${item.id}', '${item.etapas.includes('Alinhamento') && !item.etapas.includes('Serviço Geral') ? 'alignment' : 'service'}')">
                        <td class="px-4 py-3 text-sm font-medium text-gray-900">${item.car}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.vendedor || 'N/A'}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.mechanics || 'N/A'}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.etapas || 'N/A'}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.startTime || '--'}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.endTime || '--'}</td>
                        <td class="px-4 py-3 text-sm font-semibold ${durationClass} text-right">${item.durationStr}</td>
                    </tr>
                `}).join('');
                } else {
                    historyTbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500 italic">Nenhum carro finalizado hoje.</td></tr>`;
                }
            }

            // NOVO: Renderiza Histórico de Perdas
            const lostHistoryTbody = document.getElementById('lost-history-tbody');
            if (lostHistoryTbody) {
                if (lostHistoryList.length > 0) {
                    lostHistoryTbody.innerHTML = lostHistoryList.map(item => `<tr class="bg-red-50/30"><td class="px-4 py-3 text-sm font-medium text-gray-900">${item.car}</td><td class="px-4 py-3 text-sm text-gray-600">${item.vendedor || 'N/A'}</td><td class="px-4 py-3 text-sm font-semibold text-red-700">${item.etapa}</td></tr>`).join('');
                } else {
                    const periodLabel = { daily: 'hoje', weekly: 'nesta semana', monthly: 'neste mês' }[historyPeriod];
                    lostHistoryTbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-500 italic">Nenhum serviço perdido ${periodLabel}.</td></tr>`;
                }
            }
        }


        // =========================================================================
        // NOVO: Função para Exportar Histórico para PDF
        // =========================================================================
        async function exportHistoryToPDF() {
            try {
                // 1. Carrega dinamicamente as bibliotecas para garantir que estejam prontas.
                // Isso resolve problemas de escopo e tempo de carregamento com módulos.
                await import('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
                
                await import('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js');

                // 2. Acessa a classe jsPDF do módulo carregado.
                const { jsPDF } = window.jspdf;

                // 3. Instancia o documento. Agora, `doc.autoTable` deve existir.
                const doc = new jsPDF();

                // 4. Define o conteúdo do cabeçalho do documento.
                const periodLabel = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' }[historyPeriod] || 'Período';
                const title = `Relatório de Atendimentos - ${periodLabel}`;
                const date = new Date().toLocaleDateString('pt-BR');

                doc.setFontSize(18);
                doc.text(title, 14, 22);
                doc.setFontSize(11);
                doc.setTextColor(100);
                doc.text(`Gerado em: ${date}`, 14, 30);

                // 5. Prepara os dados para a tabela a partir da variável global `detailedHistoryList`.
                const tableData = detailedHistoryList.map(item => [
                    item.car,
                    item.vendedor || 'N/A',
                    item.mechanics || 'N/A',
                    item.startTime || '--',
                    item.endTime || '--',
                    item.durationStr || '--',
                ]);

                // 6. Gera a tabela no documento usando o método autoTable.
                doc.autoTable({
                    startY: 35,
                    head: [['Carro', 'Vendedor', 'Responsáveis', 'Início', 'Término', 'Duração']],
                    body: tableData,
                    theme: 'striped',
                    headStyles: { fillColor: [22, 160, 133] }, // Cor verde
                });

                // 7. Salva o arquivo PDF.
                const fileName = `historico_atendimentos_${historyPeriod}_${new Date().toISOString().split('T')[0]}.pdf`;
                doc.save(fileName);

            } catch (error) {
                console.error("Falha ao gerar PDF:", error);
                alert("Ocorreu um erro ao tentar exportar o PDF. Verifique o console para mais detalhes.");
            }
        }

        // NOVO: Função para exportar o Dashboard de Métricas para PDF
        async function exportDashboardToPDF() {
            try {
                // 1. Garante que as bibliotecas jsPDF estão carregadas.
                await import('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
                await import('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js');

                if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
                    throw new Error("A biblioteca jsPDF não foi carregada corretamente.");
                }

                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                let lastY = 0; // Controla a posição vertical no documento
                const pageHeight = doc.internal.pageSize.height;

                // --- Cabeçalho ---
                const periodLabel = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' }[historyPeriod] || 'Período';
                const title = `Relatório de Desempenho - ${periodLabel}`;
                const date = new Date().toLocaleDateString('pt-BR');

                doc.setFontSize(18);
                doc.text(title, 14, 22);
                doc.setFontSize(11);
                doc.setTextColor(100);
                doc.text(`Período de Análise: ${date}`, 14, 30);
                lastY = 32;

                // --- Seção 1: Destaques do Período ---
                doc.autoTable({
                    startY: lastY + 5,
                    head: [['Destaques do Período']],
                    body: [
                        [`Melhor Desempenho: ${document.getElementById('dash-best-performer').textContent} (${document.getElementById('dash-best-performer-avg').textContent})`],
                        [`Pior Desempenho: ${document.getElementById('dash-worst-performer').textContent} (${document.getElementById('dash-worst-performer-avg').textContent})`],
                        [`Atendimento Mais Lento: ${document.getElementById('dash-slowest-car').textContent} (${document.getElementById('dash-slowest-car-avg').textContent})`],
                        [`Atendimento Mais Rápido: ${document.getElementById('dash-fastest-car').textContent} (${document.getElementById('dash-fastest-car-avg').textContent})`]
                    ],
                    theme: 'grid',
                    headStyles: { fillColor: [70, 70, 70], halign: 'center' }, // Cinza escuro para o cabeçalho
                    bodyStyles: { halign: 'center' },
                    didDrawPage: (data) => { lastY = data.cursor.y; }
                });

                // --- Seção 2: Desempenho por Profissional ---
                const teamPerformanceData = performanceList.map(mec => [
                    mec.name,
                    mec.count.toString(),
                    mec.avgMs > 0 ? formatDuration(mec.avgMs) : 'N/A'
                ]);

                if (teamPerformanceData.length > 0) {
                    doc.autoTable({
                        startY: lastY + 5,
                        head: [['Profissional', 'Nº de Atendimentos', 'Tempo Médio']],
                        body: teamPerformanceData,
                        theme: 'striped',
                        headStyles: { fillColor: [41, 128, 185] }, // Cor azul
                        didDrawPage: (data) => { lastY = data.cursor.y; }
                    });
                } else {
                    doc.text("Nenhum dado de desempenho por profissional para exibir.", 14, lastY + 5);
                    lastY += 15;
                }

                // --- Seção 3: Desempenho por Etapa do Processo ---
                const avgWaitTimeMs = calculateAvg(allWaitTimes);
                const avgGsTimeMs = calculateAvg(allGsDurations);
                const avgTsTimeMs = calculateAvg(allTsDurations);
                const avgAliTimeMs = calculateAvg(allAliDurations);

                const stagePerformanceData = [
                    [
                        'Espera na Fila',
                        allWaitTimes.length.toString(),
                        formatDuration(avgWaitTimeMs),
                        formatDuration(allWaitTimes.length > 0 ? Math.min(...allWaitTimes) : 0),
                        formatDuration(allWaitTimes.length > 0 ? Math.max(...allWaitTimes) : 0)
                    ],
                    [
                        'Serviço Geral',
                        allGsDurations.length.toString(),
                        formatDuration(avgGsTimeMs),
                        formatDuration(allGsDurations.length > 0 ? Math.min(...allGsDurations) : 0),
                        formatDuration(allGsDurations.length > 0 ? Math.max(...allGsDurations) : 0)
                    ],
                    [
                        'Borracharia',
                        (mechanicStats[TIRE_SHOP_MECHANIC]?.count || 0).toString(),
                        'N/A', // Duração não medida
                        'N/A',
                        'N/A'
                    ],
                    [
                        'Alinhamento',
                        allAliDurations.length.toString(),
                        formatDuration(avgAliTimeMs),
                        formatDuration(allAliDurations.length > 0 ? Math.min(...allAliDurations) : 0),
                        formatDuration(allAliDurations.length > 0 ? Math.max(...allAliDurations) : 0)
                    ]
                ];

                doc.autoTable({
                    startY: lastY + 5,
                    head: [['Etapa', 'Nº de Ocorrências', 'Tempo Médio', 'Tempo Mínimo', 'Tempo Máximo']],
                    body: stagePerformanceData,
                    theme: 'striped',
                    headStyles: { fillColor: [39, 174, 96] }, // Cor verde
                    didDrawPage: (data) => { lastY = data.cursor.y; }
                });

                // --- Seção 4: Tabela de Serviços Perdidos ---
                const lostServicesData = lostHistoryList.map(item => [
                    item.car,
                    item.vendedor,
                    item.etapa
                ]);
                if (lostServicesData.length > 0) {
                    doc.autoTable({
                        startY: lastY + 5, // Adiciona um espaço
                        head: [['Carro Perdido', 'Vendedor', 'Etapa da Perda']],
                        body: lostServicesData,
                        theme: 'striped',
                        headStyles: { fillColor: [231, 76, 60] }, // Cor vermelha
                        didDrawPage: (data) => { lastY = data.cursor.y; }
                    });
                }

                // --- Rodapé ---
                const pageCount = doc.internal.getNumberOfPages();
                for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.setFontSize(8);
                    doc.setTextColor(150);
                    doc.text('N/A: Não se Aplica (a métrica não é relevante para o item).', 14, pageHeight - 15);
                    doc.text(`Página ${i} de ${pageCount}`, doc.internal.pageSize.width - 35, pageHeight - 15);
                }

                // --- Salva o arquivo ---
                const fileName = `metricas_desempenho_${historyPeriod}_${new Date().toISOString().split('T')[0]}.pdf`;
                doc.save(fileName);

            } catch (error) {
                console.error("Falha ao gerar PDF de Métricas:", error);
                alert("Ocorreu um erro ao tentar exportar o PDF de Métricas. Verifique o console para mais detalhes.");
            }
        }

        // NOVO: Listener para o botão de exportar Métricas
        document.getElementById('export-dashboard-btn').addEventListener('click', exportDashboardToPDF);

        // CORREÇÃO: Adiciona o listener para o botão de exportar o histórico, que estava faltando.
        document.getElementById('export-history-btn').addEventListener('click', exportHistoryToPDF);

        /**
         * NOVO: Controla a visibilidade dos filtros de data, mês e ano com base no período selecionado.
         */
        function updateHistoryFilterVisibility() {
            const dateFilter = document.getElementById('history-date-filter');
            const monthFilter = document.getElementById('history-month-filter');
            const yearFilter = document.getElementById('history-year-filter');

            // Esconde todos os filtros específicos primeiro
            dateFilter.classList.add('hidden');
            monthFilter.classList.add('hidden');
            yearFilter.classList.add('hidden');

            // Mostra os filtros relevantes
            if (historyPeriod === 'daily') {
                dateFilter.classList.remove('hidden');
                historyDate = dateFilter.value || null;
            } else if (historyPeriod === 'monthly') {
                monthFilter.classList.remove('hidden');
                yearFilter.classList.remove('hidden');
            } else if (historyPeriod === 'yearly') {
                yearFilter.classList.remove('hidden');
            } else { // weekly
                historyDate = null;
                dateFilter.value = '';
            }
        }

        // NOVO: Listener para o filtro de período
        document.getElementById('history-period-filter').addEventListener('change', (e) => {
            historyPeriod = e.target.value;
            updateHistoryFilterVisibility();

            calculateAndRenderDashboard(); // Recalcula e renderiza tudo com o novo período
        });

        // NOVO: Listeners para os novos filtros
        document.getElementById('history-date-filter').addEventListener('change', (e) => {
            historyDate = e.target.value;
            calculateAndRenderDashboard(); // Recalcula com a nova data
        });

        document.getElementById('history-month-filter').addEventListener('change', (e) => {
            historyMonth = parseInt(e.target.value, 10);
            calculateAndRenderDashboard();
        });

        document.getElementById('history-year-filter').addEventListener('change', (e) => {
            const year = parseInt(e.target.value, 10);
            // Validação simples para o ano
            if (String(year).length === 4) {
                historyYear = year;
                calculateAndRenderDashboard();
            }
        });

        // NOVO: Inicializa os valores dos filtros de mês/ano
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('history-month-filter').value = historyMonth;
            document.getElementById('history-year-filter').value = historyYear;
            // CORREÇÃO: Garante que o filtro correto (diário) apareça na carga inicial.
            updateHistoryFilterVisibility();
        });


        // =========================================================================
        // Funções de Listener
        // =========================================================================

        function setupRealtimeListeners() {
            if (!isAuthReady || isDemoMode) {
                console.warn("Listeners não configurados: Auth não pronta ou Modo Demo.");
                return;
            }

            console.log("Configurando Listeners do Firestore...");

            const serviceQuery = query(
                collection(db, SERVICE_COLLECTION_PATH),
                where('status', 'in', [STATUS_PENDING, STATUS_READY, STATUS_FINALIZED, STATUS_LOST, STATUS_GS_FINISHED])
            );

            onSnapshot(serviceQuery, (snapshot) => {
                console.log("Recebidos dados de Serviços Gerais:", snapshot.docs.length);
                const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // ATUALIZADO: O filtro de data foi movido para dentro do dashboard.
                // Agora, mantemos um histórico maior (31 dias) para permitir a filtragem.
                serviceJobs = jobs.filter(j =>
                    j.status === STATUS_PENDING ||
                    j.status === STATUS_READY ||
                    j.status === STATUS_GS_FINISHED ||
                    ((j.status === STATUS_FINALIZED || j.status === STATUS_LOST) && isTimestampFromLast31Days(j.finalizedAt))
                );

                renderServiceQueues(serviceJobs);
                renderReadyJobs(serviceJobs, alignmentQueue);
                renderAlignmentQueue(alignmentQueue);
                renderPendingCounts(); // Atualiza contagem de pendentes
                renderAlignmentMirror(alignmentQueue);
                calculateAndRenderDashboard(); // ATUALIZADO
            }, (error) => {
                console.error("Erro no listener de Serviços:", error);
                alertUser("Erro de conexão (Serviços): " + error.message);
            });


            const alignmentQuery = query(
                collection(db, ALIGNMENT_COLLECTION_PATH),
                where('status', 'in', [STATUS_WAITING, STATUS_ATTENDING, STATUS_WAITING_GS, STATUS_READY, STATUS_FINALIZED, STATUS_LOST])
            );

            onSnapshot(alignmentQuery, (snapshot) => {
                console.log("Recebidos dados de Alinhamento:", snapshot.docs.length);
                const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // ATUALIZADO: O filtro de data foi movido para dentro do dashboard.
                alignmentQueue = cars.filter(c =>
                    c.status === STATUS_WAITING ||
                    c.status === STATUS_ATTENDING ||
                    c.status === STATUS_WAITING_GS ||
                    c.status === STATUS_READY ||
                    ((c.status === STATUS_FINALIZED || c.status === STATUS_LOST) && isTimestampFromLast31Days(c.finalizedAt))
                );

                renderAlignmentQueue(alignmentQueue);
                renderAlignmentMirror(alignmentQueue);
                renderPendingCounts(); // Atualiza contagem de pendentes
                renderReadyJobs(serviceJobs, alignmentQueue);
                calculateAndRenderDashboard(); // ATUALIZADO
            }, (error) => {
                console.error("Erro no listener de Alinhamento:", error);
                alertUser("Erro de conexão (Alinhamento): " + error.message);
            });
        }

        function setupUserListener() {
            if (!isAuthReady || isDemoMode) return;

            const usersQuery = query(collection(db, USERS_COLLECTION_PATH));
            onSnapshot(usersQuery, (snapshot) => {
                console.log("Recebidos dados de Usuários:", snapshot.docs.length);
                systemUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // Filtra usuários por cargo para popular dropdowns (Req 2.5)
                vendedores = systemUsers.filter(u => u.role === VENDEDOR_ROLE);
                mecanicosGeral = systemUsers.filter(u => u.role === MECANICO_ROLE);

                // Renderiza a lista de usuários na aba Admin (Req 2.2)
                renderUserList(systemUsers);

                // Atualiza a lista de mecânicos e os dropdowns
                renderMechanicsManagement();

                // Se o usuário logado for vendedor, re-aplica a seleção
                if (currentUserRole === VENDEDOR_ROLE) {
                    const vendedorSelect = document.getElementById('vendedorName');
                    vendedorSelect.value = currentUserName;
                    vendedorSelect.disabled = true;
                    const aliVendedorSelect = document.getElementById('aliVendedorName');
                    aliVendedorSelect.value = currentUserName;
                    aliVendedorSelect.disabled = true;
                }

            }, (error) => console.error("Erro no listener de Usuários:", error));
        }

        // ------------------------------------
        // 5. Funções Globais e Inicialização
        // ------------------------------------

        window.markServiceReady = markServiceReady;
        window.updateAlignmentStatus = updateAlignmentStatus;
        window.moveAlignmentUp = moveAlignmentUp;
        window.moveAlignmentDown = moveAlignmentDown;
        window.finalizeJob = finalizeJob;
        window.showServiceReadyConfirmation = showServiceReadyConfirmation;
        window.hideConfirmationModal = hideConfirmationModal;
        window.confirmServiceReady = confirmServiceReady;
        window.showAlignmentReadyConfirmation = showAlignmentReadyConfirmation;
        window.confirmAlignmentReady = confirmAlignmentReady;
        window.showFinalizeConfirmation = showFinalizeConfirmation;
        window.confirmFinalizeJob = confirmFinalizeJob;
        window.showSendToManagerConfirmation = showSendToManagerConfirmation; // NOVO
        window.confirmMarkAsLost = confirmMarkAsLost;
        window.showDefineServiceModal = showDefineServiceModal;
        window.hideDefineServiceModal = hideDefineServiceModal;
        window.showEditServiceModal = showEditServiceModal;
        window.hideEditServiceModal = hideEditServiceModal;
        window.showMarkAsLostConfirmation = showMarkAsLostConfirmation;

        window.showDeleteUserConfirmation = showDeleteUserConfirmation; // NOVO
        window.showDiscardAlignmentConfirmation = showDiscardAlignmentConfirmation; // NOVO
        window.confirmDiscardAlignment = confirmDiscardAlignment; // NOVO
        window.showReturnToMechanicModal = showReturnToMechanicModal; // NOVO
        window.hideReturnToMechanicModal = hideReturnToMechanicModal; // NOVO
        window.confirmFinalizeAlignmentFromRework = confirmFinalizeAlignmentFromRework; // NOVO

        window.showEditUserModal = showEditUserModal; // NOVO
        window.hideEditUserModal = hideEditUserModal; // NOVO

        // NOVO: Funções de modal de texto e detalhes
        window.showFullDescriptionModal = showFullDescriptionModal; // CORREÇÃO: Expondo a função globalmente
        window.hideTextDisplayModal = hideTextDisplayModal; // CORREÇÃO: Expondo a função globalmente
        window.showHistoryDetailModal = showHistoryDetailModal;
        window.hideHistoryDetailModal = hideHistoryDetailModal;
        // NOVO: Funções do modal de desempenho do mecânico
        window.showMechanicPerformanceModal = showMechanicPerformanceModal;
        window.hideMechanicPerformanceModal = hideMechanicPerformanceModal;

        window.confirmDeleteUser = confirmDeleteUser; // NOVO
        document.getElementById('create-user-form').addEventListener('submit', handleCreateUser);
        initializeFirebase();
        // ------------------------------------
        // 6. Controle de Navegação por Abas
        // ------------------------------------

        // CORREÇÃO: Seletor mais específico para afetar apenas os botões da navegação principal.
        document.querySelectorAll('#main-nav > .tab-button').forEach(button => {
            button.addEventListener('click', () => {
                // Bloqueia navegação para papéis com visão restrita
                if (currentUserRole === ALIGNER_ROLE || currentUserRole === MECANICO_ROLE) {
                    return;
                }

                const tabId = button.dataset.tab;

                // CORREÇÃO: Seletores mais específicos para não afetar as sub-abas.
                document.querySelectorAll('#main-nav > .tab-button').forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('main > .tab-content').forEach(content => content.classList.remove('active'));

                button.classList.add('active');
                document.getElementById(tabId).classList.add('active');
            });
        });

        // NOVO: Lógica para as abas internas do Dashboard
        document.querySelectorAll('.sub-tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.id.replace('-btn', ''); // ex: sub-tab-btn-operacional -> sub-tab-operacional

                // Esconde todos os conteúdos das sub-abas
                document.querySelectorAll('#monitor .tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                // Remove a classe ativa de todos os botões de sub-aba
                document.querySelectorAll('.sub-tab-button').forEach(btn => btn.classList.remove('active'));

                // Mostra o conteúdo e ativa o botão clicado
                document.getElementById(tabId).classList.add('active');
                button.classList.add('active');
            });
        });

        // NOVO: Listeners para os destaques do dashboard
        document.getElementById('highlight-best-performer').addEventListener('click', () => {
            // ATUALIZADO: Agora abre o modal de detalhes do histórico.
            const data = dashboardHighlightData.bestPerformer;
            if (data && data.id) showHistoryDetailModal(data.id, data.type);
        });
        document.getElementById('highlight-worst-performer').addEventListener('click', () => {
            // ATUALIZADO: Agora abre o modal de detalhes do histórico.
            const data = dashboardHighlightData.worstPerformer;
            if (data && data.id) showHistoryDetailModal(data.id, data.type);
        });
        document.getElementById('highlight-slowest-car').addEventListener('click', () => {
            const data = dashboardHighlightData.slowestCar;
            if (data && data.id) showHistoryDetailModal(data.id, data.type);
        });
        document.getElementById('highlight-fastest-car').addEventListener('click', () => {
            const data = dashboardHighlightData.fastestCar;
            if (data && data.id) showHistoryDetailModal(data.id, data.type);
        });
        // =========================================================================
        // NOVO: Funções de Modais Adicionais
        // =========================================================================

        /**
         * Exibe um modal com um texto completo. Usado para "Ver mais".
         * @param {string} encodedText - O texto a ser exibido, codificado com escape().
         */
        function showFullDescriptionModal(encodedText) {
            const text = unescape(encodedText);
            document.getElementById('text-display-content').textContent = text;
            document.getElementById('text-display-modal').classList.remove('hidden');
        }

        function hideTextDisplayModal() {
            document.getElementById('text-display-modal').classList.add('hidden');
        }

        /**
         * Exibe um modal com os detalhes de um serviço do histórico.
         * @param {string} jobId - O ID do serviço a ser detalhado.
         */
        function showHistoryDetailModal(jobId, type) {
            // ATUALIZADO: Determina a coleção correta para buscar o job.
            // O 'type' que vem dos destaques pode ser 'Serviço Geral', 'Alinhamento', etc.
            // Precisamos mapeá-lo para 'service' ou 'alignment'.
            const collectionType = (type === 'Alinhamento' && !detailedHistoryList.find(item => item.id === jobId)?.etapas.includes('Serviço Geral')) ? 'alignment' : 'service';

            let job;
            if (collectionType === 'service') {
                job = serviceJobs.find(j => j.id === jobId);
            } else {
                job = alignmentQueue.find(j => j.id === jobId);
            }

            if (!job) {
                alertUser("Detalhes não encontrados para este serviço.");
                return;
            }

            const contentEl = document.getElementById('history-detail-content');
            const isService = collectionType === 'service';

            // CORREÇÃO: Melhora a exibição dos detalhes, mostrando mais informações de tempo.
            contentEl.innerHTML = `
                <div class="space-y-3">
                    <div class="p-3 bg-gray-50 rounded-lg">
                        <p><strong>Carro:</strong> ${job.carModel} (${job.licensePlate})</p>
                        <p><strong>Vendedor:</strong> ${job.vendedorName || 'N/A'}</p>
                    </div>
                    <hr>
                    <div class="text-sm space-y-2">
                        ${isService ? `
                            <p><strong>Serviço Geral (${job.assignedMechanic || 'N/A'}):</strong> ${formatTime(job.gsStartedAt)} - ${formatTime(job.gsFinishedAt)}</p>
                            ${job.statusTS ? `<p><strong>Borracharia:</strong> ${formatTime(job.tsStartedAt)} - ${formatTime(job.tsFinishedAt)}</p>` : ''}
                        ` : ''}
                        
                        ${(isService && job.requiresAlignment) || !isService ? `
                            <p><strong>Alinhamento:</strong> ${formatTime(job.alignmentStartedAt)} - ${formatTime(job.readyAt)}</p>
                        ` : ''}
                    </div>
                    <hr>
                    <div class="p-3 bg-gray-50 rounded-lg">
                        <p><strong>Descrição do Serviço:</strong></p>
                        <p class="text-gray-600 break-words">${job.serviceDescription || (isService ? 'Avaliação' : 'Alinhamento Manual')}</p>
                    </div>
                    <hr>
                    <div class="text-center font-bold">
                        <p>Duração Total: <span class="text-lg">${formatDuration(calculateDuration(job.timestamp, job.finalizedAt))}</span></p>
                    </div>
                </div>
            `;
            document.getElementById('history-detail-modal').classList.remove('hidden');
        }

        function hideHistoryDetailModal() {
            document.getElementById('history-detail-modal').classList.add('hidden');
        }

        /**
         * NOVO: Exibe um modal com os detalhes de desempenho de um mecânico.
         * @param {string} mechanicName - O nome do mecânico.
         */
        function showMechanicPerformanceModal(mechanicName) {
            const modal = document.getElementById('mechanic-performance-modal');
            const titleEl = document.getElementById('mechanic-performance-title');
            const contentEl = document.getElementById('mechanic-performance-content');

            const periodLabel = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal' }[historyPeriod];
            titleEl.textContent = `Desempenho de ${mechanicName} (${periodLabel})`;

            // Filtra a lista de histórico detalhado para encontrar os serviços do mecânico
            const mechanicServices = detailedHistoryList.filter(item =>
                item.mechanics && item.mechanics.includes(mechanicName)
            );

            if (mechanicServices.length === 0) {
                contentEl.innerHTML = '<p class="text-center italic">Nenhum serviço finalizado por este mecânico no período.</p>';
            } else {
                contentEl.innerHTML = `
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Carro</th>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vendedor</th>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Etapas</th>
                                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Duração Total</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${mechanicServices.map(item => `
                                <tr>
                                    <td class="px-4 py-2 text-sm font-medium text-gray-900">${item.car}</td>
                                    <td class="px-4 py-2 text-sm text-gray-600">${item.vendedor}</td>
                                    <td class="px-4 py-2 text-sm text-gray-600">${item.etapas}</td>
                                    <td class="px-4 py-2 text-sm font-semibold text-gray-800 text-right">${item.durationStr}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>`;
            }
            modal.classList.remove('hidden');
        }

        function hideMechanicPerformanceModal() {
            document.getElementById('mechanic-performance-modal').classList.add('hidden');
        }
