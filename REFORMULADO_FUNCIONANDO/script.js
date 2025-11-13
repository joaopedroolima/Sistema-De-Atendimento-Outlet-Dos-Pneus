import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp, setLogLevel, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// =========================================================================
// CONFIGURAÇÃO FIREBASE
// =========================================================================
const isCanvasEnvironment = typeof __app_id !== 'undefined';
const LOCAL_APP_ID = 'local-autocenter-app';

const appId = isCanvasEnvironment ? (typeof __app_id !== 'undefined' ? __app_id : LOCAL_APP_ID) : LOCAL_APP_ID;

const LOCAL_FIREBASE_CONFIG = {
    apiKey: "AIzaSyASPbbCpk4A2ZM_imbgoWixsFyMXYrCvQU",
    authDomain: "atendimentosoutlet.firebaseapp.com",
    projectId: "atendimentosoutlet",
    storageBucket: "atendimentosoutlet.firebasestorage.app",
    messagingSenderId: "815053643953",
    appId: "1:815053643953:web:dbf29a57abaa869d1cc290",
    measurementId: "G-JZ7B6ZBGYJ"
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

const initialAuthToken = (isCanvasEnvironment && typeof __initial_auth_token !== 'undefined') ? __initial_auth_token : null;

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
let currentUserToEditId = null; // NOVO: Para edição de usuário
let lastAssignedMechanicIndex = -1; // NOVO: Para o rodízio de mecânicos (Req 3.1)

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
    
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');

    // Salva sessão no localStorage (Req 1.3)
    localStorage.setItem('currentUser', JSON.stringify(user));
    document.getElementById('user-info').textContent = `Usuário: ${username} | Cargo: ${role.toUpperCase()}`;
    
    const mechanicTitle = MECHANICS.join(', ');
    document.getElementById('mechanic-list-title').textContent = mechanicTitle;

    const tabServicos = document.getElementById('tab-servicos');
    const tabAlinhamento = document.getElementById('tab-alinhamento');
    const tabMonitor = document.getElementById('tab-monitor');
    const tabAdmin = document.getElementById('tab-admin');
    
    const contentServicos = document.getElementById('servicos');
    const contentAlinhamento = document.getElementById('alinhamento');
    const contentMonitor = document.getElementById('monitor');
    const contentAdmin = document.getElementById('admin');
    const mechanicView = document.getElementById('mechanic-view');
    const mainNav = document.getElementById('main-nav');

    const alignmentForm = document.getElementById('alignment-form');
    const alignmentFormTitle = document.getElementById('alignment-form-title');

    // Reset de todas as views
    [tabServicos, tabAlinhamento, tabMonitor, tabAdmin, alignmentForm, alignmentFormTitle, mechanicView].forEach(el => el.classList.add('hidden'));
    [contentServicos, contentAlinhamento, contentMonitor, contentAdmin, mechanicView].forEach(el => el.classList.remove('active'));
    mainNav.classList.remove('hidden');
    
    if (role === ALIGNER_ROLE) {
        // ATUALIZADO: Alinhador agora pode adicionar carros, como o vendedor.
        // Esconde as outras abas principais.
        [tabServicos, tabMonitor, tabAdmin].forEach(el => el.classList.add('hidden'));
        
        // Mostra a aba de alinhamento e o formulário de adição.
        [tabAlinhamento, alignmentForm, alignmentFormTitle].forEach(el => el.classList.remove('hidden'));
        
        // Define a aba de alinhamento como a ativa.
        tabAlinhamento.classList.remove('hidden');
        contentServicos.classList.remove('active');
        contentMonitor.classList.remove('active');
        tabAlinhamento.classList.add('active');
        contentAlinhamento.classList.add('active');

    } else if (role === MANAGER_ROLE) {
        [tabServicos, tabAlinhamento, tabMonitor, tabAdmin, alignmentForm].forEach(el => el.classList.remove('hidden', 'aligner-hidden'));
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
        const mechanicTitle = MECHANICS.join(', ');
        document.getElementById('mechanic-list-title').textContent = mechanicTitle;


    } else if (role === MECANICO_ROLE) {
        // Req 1.4: Visão do Mecânico
        mainNav.classList.add('hidden'); // Esconde a navegação principal
        contentServicos.classList.remove('active'); // Garante que a aba de serviços não fique ativa
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
    calculateAndRenderDashboard(); // ATUALIZADO: Chamando o novo dashboard
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorElement = document.getElementById('login-error');
    errorElement.textContent = '';

    let user = null;

    // 1. Tenta login pelo Firestore (Req 1.1)
    if (!isDemoMode) {
        try { // A consulta ao Firestore é a primeira tentativa.
            const q = query(collection(db, USERS_COLLECTION_PATH), where("username", "==", username));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const userData = querySnapshot.docs[0].data();
                if (userData.password === password) {
                    user = { username: userData.username, role: userData.role }; // Usuário encontrado no DB
                }
            }
        } catch (err) {
            console.error("Erro ao buscar usuário no Firestore:", err);
            // CORREÇÃO: Não exibe erro e nem para a execução.
            // Apenas loga o erro e permite que a lógica de fallback continue.
            // O fallback é essencial se a coleção ainda não existe ou há problemas de permissão.
        }
    }

    // 2. Se não encontrou um usuário no Firestore (ou se a busca falhou), tenta o fallback local (Req 1.4)
    if (!user) {
        const fallbackUser = USER_CREDENTIALS[username];
        if (fallbackUser && fallbackUser.password === password) {
            user = { username, role: fallbackUser.role };
        }
    }

    // 3. Se encontrou um usuário, faz o setup
    if (user) {
        postLoginSetup(user);
    } else {
        errorElement.textContent = 'Credenciais inválidas.';
    }
}

window.handleLogout = function() {
    isLoggedIn = false;
    currentUserRole = null;
    currentUserName = null;
    localStorage.removeItem('currentUser'); // Limpa a sessão (Req 1.3)
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('login-form').reset();
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-container').classList.remove('hidden');
    window.location.reload(); // Recarrega para garantir estado limpo
}

document.getElementById('login-form').addEventListener('submit', handleLogin);

function initializeFirebase() {
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');

    if (isDemoMode) {
        document.getElementById('user-info').textContent = `MODO DEMO ATIVO (Dados não persistentes).`;
        isAuthReady = true; 
        document.getElementById('login-container').classList.remove('hidden');
        
        renderServiceQueues(serviceJobs);
        renderAlignmentQueue(alignmentQueue);
        renderAlignmentMirror(alignmentQueue); 
        renderReadyJobs(serviceJobs, alignmentQueue); 
        calculateAndRenderDashboard(); // ATUALIZADO
        return;
    }

    // NOVO: Verifica se há sessão salva no localStorage (Req 1.3)
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        isAuthReady = true; // Assume que a autenticação ocorrerá sem problemas
        // O onAuthStateChanged vai lidar com o resto
    }

    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        analytics = getAnalytics(app); 
        setLogLevel('Debug'); 

        onAuthStateChanged(auth, async (user) => {
            
            if (isCanvasEnvironment) {
                if (initialAuthToken) {
                    try {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } catch (e) {
                        console.warn("Falha no Custom Token, usando Anônimo.", e);
                        await signInAnonymously(auth);
                    }
                } else if (!user) {
                    await signInAnonymously(auth);
                }
                
                userId = auth.currentUser?.uid || crypto.randomUUID();
                if (savedUser) {
                    postLoginSetup(JSON.parse(savedUser));
                } else {
                    // Comportamento padrão para ambiente de plataforma sem login salvo
                    postLoginSetup({ username: "DB_User (Gerente)", role: MANAGER_ROLE });
                }

                isAuthReady = true;

            } else {
                userId = auth.currentUser?.uid || crypto.randomUUID(); 
                
                if (!user) {
                    try {
                        await signInAnonymously(auth);
                        userId = auth.currentUser.uid;
                    } catch (e) {
                        console.error("Falha no login anônimo (Necessário para Firestore):", e);
                    }
                }

                if (savedUser) {
                    postLoginSetup(JSON.parse(savedUser));
                } else {
                    document.getElementById('login-container').classList.remove('hidden');
                    document.getElementById('main-content').classList.add('hidden');
                }
                isAuthReady = true;
            }
        });
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
    
    const mechanicTitle = MECHANICS.join(', ');
    document.getElementById('mechanic-list-title').textContent = mechanicTitle;
    
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

    // Incrementa o índice para pegar o próximo mecânico
    lastAssignedMechanicIndex++;

    // Se o índice passar do tamanho do array, volta para o início (rodízio)
    if (lastAssignedMechanicIndex >= sortedMechanics.length) {
        lastAssignedMechanicIndex = 0;
    }

    const nextMechanic = sortedMechanics[lastAssignedMechanicIndex];
    console.log(`Atribuição Round-Robin: Próximo mecânico é ${nextMechanic} (índice ${lastAssignedMechanicIndex})`);
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
    }
});

document.getElementById('alignment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isLoggedIn) return alertUser("Você precisa estar logado para cadastrar serviços.");

    // CORREÇÃO: Pega o nome do usuário logado diretamente do estado da sessão.
    const vendedorName = currentUserName;
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
    
    if (confirmAction === 'finalize') confirmButton.textContent = 'Sim, Finalizar e Receber';
    else if (confirmAction === 'markAsLost') confirmButton.textContent = 'Sim, Marcar como Perdido';
    else if (confirmAction === 'deleteUser') confirmButton.textContent = 'Sim, Excluir Usuário';
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

window.showFinalizeConfirmation = function(docId, collectionType) {
    if (currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado. Apenas Gerentes podem finalizar pagamentos.");
    
    const title = collectionType === 'service' ? 'Finalizar Pagamento (Mecânica)' : 'Finalizar Pagamento (Alinhamento)';
    const message = `Confirma a finalização e recebimento do pagamento para o serviço de **${collectionType === 'service' ? 'Mecânica' : 'Alinhamento'}**? Esta ação marcará o carro como 'Finalizado'.`;
    
     showFinalizeModal(docId, collectionType, title, message, 'finalize');
}

window.showMarkAsLostConfirmation = function(docId) {
    // ATUALIZAÇÃO: Permite que Vendedores também marquem como perdido.
    if (currentUserRole !== MANAGER_ROLE && currentUserRole !== VENDEDOR_ROLE) return alertUser("Acesso negado.");

    const title = 'Confirmar Serviço Perdido';
    const message = `Tem certeza que deseja marcar este serviço como **PERDIDO**? Ele será removido das filas ativas e contado nas estatísticas de perdas. Esta ação não pode ser desfeita.`;
    
     showFinalizeModal(docId, 'service', title, message, 'markAsLost');
}

// NOVO: Modal de confirmação para deletar usuário (Req 2.3)
window.showDeleteUserConfirmation = function(userId) {
    if (currentUserRole !== MANAGER_ROLE) return;
    const user = systemUsers.find(u => u.id === userId);
    if (!user) return;

    const title = `Excluir Usuário`;
    const message = `Tem certeza que deseja excluir o usuário <strong>${user.username}</strong> (${user.role})? Esta ação é irreversível.`;
    showFinalizeModal(userId, 'user', title, message, 'deleteUser');
}

// NOVO: Wrapper para o modal de confirmação de exclusão de usuário (Req 4)
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

// NOVO: Ação de deletar usuário (Req 2.3)
window.confirmDeleteUser = function() {
    if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'deleteUser') {
        deleteUser(currentJobToConfirm.id);
    }
    hideConfirmationModal();
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

                await updateDoc(alignDocRef, alignmentDataToUpdate);
            
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
        
        if (!isService) {
            const carDoc = await getDoc(docRef);
            if (carDoc.exists() && carDoc.data().serviceJobId) {
                const serviceJobId = carDoc.data().serviceJobId;
                const serviceDocRef = doc(db, SERVICE_COLLECTION_PATH, serviceJobId);
                const serviceDoc = await getDoc(serviceDocRef);
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
function toggleDescription(jobId) {
    const shortDesc = document.getElementById(`desc-short-${jobId}`);
    const fullDesc = document.getElementById(`desc-full-${jobId}`);
    const button = document.getElementById(`desc-btn-${jobId}`);

    if (!shortDesc || !fullDesc || !button) {
        console.error(`Elementos para o job ID '${jobId}' não encontrados.`);
        return;
    }

    shortDesc.classList.toggle('hidden');
    fullDesc.classList.toggle('hidden');

    button.textContent = fullDesc.classList.contains('hidden') ? 'Ver mais' : 'Ver menos';
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
        if (job.statusGS === STATUS_PENDING && MECHANICS.includes(job.assignedMechanic)) {
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

            // NOVO: Lógica para "Ver mais/Ver menos"
            let descriptionHTML = '';
            const descriptionText = job.serviceDescription || 'N/A';
            if (descriptionText.length > 15) { // ATUALIZADO: Limite de 15 caracteres
                descriptionHTML = `
                    <div class="overflow-hidden">
                        <p id="desc-short-${job.id}" class="text-sm ${statusColor}">${descriptionText.substring(0, 15)}...</p>
                        <p id="desc-full-${job.id}" class="text-sm ${statusColor} hidden break-words">${descriptionText} ${statusText}</p>
                        <button id="desc-btn-${job.id}" data-job-id="${job.id}" class="text-xs text-blue-500 hover:underline mt-1">Ver mais</button>
                    </div>
                `;
            } else {
                descriptionHTML = `<p class="text-sm ${statusColor} break-words">${descriptionText} ${statusText}</p>`;
            }

            return `
                <li class="relative p-3 bg-white border-l-4 border-yellow-500 rounded-md shadow-sm min-h-[80px]">
                    <div class="pr-20"> 
                        <div>
                            <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel})</p>
                            ${descriptionHTML}
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
            const statusText = isTsPending ? `(Aguardando Pneus)` : '';
            const statusColor = isTsPending ? 'text-red-500' : 'text-gray-500';
            const isDefined = job.isServiceDefined;

            // NOVO: Trava de segurança do botão "Pronto" (Req 3.3)
            const hasStarted = !!job.gsStartedAt;
            const isReadyButtonDisabled = !isDefined || isTsPending || !hasStarted;
            const readyButtonTitle = isTsPending ? "Aguardando conclusão do serviço de pneus." : !isDefined ? "Aguardando definição do serviço." : "Marcar como pronto";
            
            let descriptionHTML = '';
            let clickHandler = '';
            let cursorClass = '';
            let actionButtonHTML = '';
            
            if (!isDefined) {
                descriptionHTML = '<span class="font-bold text-red-600">(Aguardando Definição de Serviço)</span>';
                if (isManager) {
                    clickHandler = `onclick="showDefineServiceModal('${job.id}')"`;
                    cursorClass = 'cursor-pointer hover:bg-yellow-100/50 transition duration-150';
                    descriptionHTML += '<span class="text-xs text-blue-600 block mt-1">(Clique p/ definir)</span>';
                }
            } else {
                // NOVO: Lógica para "Ver mais/Ver menos"
                const descriptionText = job.serviceDescription || 'N/A';
                if (descriptionText.length > 15) { // ATUALIZADO: Limite de 15 caracteres
                    descriptionHTML = `
                        <div class="overflow-hidden">
                            <p id="desc-short-${job.id}" class="text-sm ${statusColor}">${descriptionText.substring(0, 15)}... ${statusText}</p>
                            <p id="desc-full-${job.id}" class="text-sm ${statusColor} hidden break-words">${descriptionText}</p>
                        </div>
                    `;
                } else {
                    descriptionHTML = `<p class="text-sm ${statusColor} break-words">${descriptionText} ${statusText}</p>`;
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
                <li class="relative p-3 bg-white border-l-4 border-blue-500 rounded-md shadow-sm min-h-[80px]">
                    <div class="pr-20 ${cursorClass}" ${clickHandler}>
                        <div>
                            <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel})</p>
                            ${descriptionHTML}
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
                    // NOVO: Lógica para "Ver mais/Ver menos" na visão do mecânico
                    const descriptionText = job.serviceDescription || 'N/A';
                    if (descriptionText.length > 15) { // ATUALIZADO: Limite de 15 caracteres
                        descriptionHTML = `
                            <div class="overflow-hidden">
                                <p id="desc-short-${job.id}" class="text-sm ${statusColor}">${descriptionText.substring(0, 15)}... ${statusText}</p>
                                <p id="desc-full-${job.id}" class="text-sm ${statusColor} hidden break-words">${descriptionText}</p>
                                <button id="desc-btn-${job.id}" onclick="window.toggleDescription('${job.id}')" class="text-xs text-blue-500 hover:underline mt-1">Ver mais</button>
                            </div>
                        `;
                    } else {
                        descriptionHTML = `<p class="text-sm ${statusColor} break-words">${descriptionText} ${statusText}</p>`;
                    }
                }

                return `
                    <li class="relative p-4 bg-white border-l-4 border-blue-500 rounded-lg shadow-md min-h-[100px]">
                        <div class="pr-24">
                            <div>
                                <p class="text-lg font-bold text-gray-800">${job.licensePlate}</p>
                                <p class="text-md text-gray-600 mb-2">${job.carModel}</p>
                                ${descriptionHTML}
                                <p class="text-xs text-gray-400 mt-1">Vendedor: ${job.vendedorName}</p>
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

                    const gsDescriptionShort = (car.gsDescription && car.gsDescription !== "Avaliação") 
                        ? car.gsDescription.substring(0, 20) + '...' 
                        : 'Avaliação...';
                        
                    const statusText = isAttending ? 'Em Atendimento' : 
                                       isWaitingGS ? `Aguardando GS (${gsDescriptionShort})` : 
                                       'Disponível';
                    
                    return `
                        <li class="p-3 bg-white rounded-md border border-gray-200 shadow-sm flex justify-between items-center text-sm">
                            <span class="font-semibold">${index + 1}. ${car.carModel} (${car.licensePlate})</span>
                            <span class="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                                ${statusText}
                            </span>
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
        
        const statusColor = isAttending ? 'bg-yellow-100 text-yellow-800' : 
                            isWaitingGS ? 'bg-red-100 text-red-800' : 
                            'bg-blue-100 text-blue-800';

        const gsDescriptionShort = (car.gsDescription && car.gsDescription !== "Avaliação") 
            ? car.gsDescription.substring(0, 25) + '...' 
            : 'Avaliação...';
            
        const statusText = isAttending ? 'Em Atendimento' : 
                           isWaitingGS ? `Aguardando GS: ${gsDescriptionShort}` : 
                           'Disponível para Alinhar';

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

        if (isAttending) {
            actions = `
                <button onclick="showAlignmentReadyConfirmation('${car.id}')"
                    class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-lg hover:bg-green-600 transition min-w-[120px]"
                    ${!isLoggedIn ? 'disabled' : ''}>
                    Pronto
                </button>
            `;
        } else if (isNextWaiting) { 
            actions = `
                <button onclick="updateAlignmentStatus('${car.id}', '${STATUS_ATTENDING}')"
                    class="text-xs font-medium bg-yellow-500 text-gray-900 py-1 px-3 rounded-lg hover:bg-yellow-600 transition min-w-[120px]"
                    ${!isLoggedIn ? 'disabled' : ''}>
                    Iniciar Atendimento
                </button>
            `;
        } else {
            actions = `<span class="text-xs text-gray-400">Na fila...</span>`;
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
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}">
                        ${statusText}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowTRap text-center text-sm font-medium">
                    ${moverButtons}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div class="flex flex-col space-y-1 sm:space-y-0 sm:space-x-2 justify-end">
                        ${actions}
                    </div>
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
                const serviceDetail = isService ? job.serviceDescription.substring(0, 50) + '...' : 'Revisão de Geometria/Balanceamento';
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
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${serviceInfo} (${serviceDetail})</td>
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
        function getStartOfTodayTimestamp() {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            return Timestamp.fromDate(now);
        }

        function isTimestampFromToday(timestamp) {
            if (!timestamp) return false;
            const startOfToday = getStartOfTodayTimestamp();
            const jobTime = new Timestamp(getTimestampSeconds(timestamp), timestamp.nanoseconds || 0);
            return jobTime >= startOfToday;
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

            const pendingGsJobs = serviceJobs.filter(j => j.statusGS === STATUS_PENDING);
            const pendingTsJobs = serviceJobs.filter(j => j.statusTS === STATUS_PENDING);
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

            const finalizedToday = serviceJobs.filter(j => j.status === STATUS_FINALIZED && isTimestampFromToday(j.finalizedAt)).length;
            const lostToday = serviceJobs.filter(j => j.status === STATUS_LOST && isTimestampFromToday(j.finalizedAt)).length;

            container.innerHTML = `
                <div class="flex justify-between items-center p-3 bg-green-100 rounded-lg">
                    <span class="font-semibold text-green-800">Serviços Concluídos</span>
                    <span class="text-xl font-bold text-green-900">${finalizedToday}</span>
                </div>
                <div class="flex justify-between items-center p-3 bg-red-100 rounded-lg">
                    <span class="font-semibold text-red-800">Serviços Perdidos</span>
                    <span class="text-xl font-bold text-red-900">${lostToday}</span>
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
            
            // ATUALIZAÇÃO: Chama as novas funções de renderização operacional
            renderPendingCounts();
            renderDailySummary();

            const finalizedServicesToday = serviceJobs.filter(j => j.status === STATUS_FINALIZED && isTimestampFromToday(j.finalizedAt));
            const finalizedAlignmentsToday = alignmentQueue.filter(a => a.status === STATUS_FINALIZED && isTimestampFromToday(a.finalizedAt));

            // Arrays para armazenar durações de cada etapa para cálculo da média geral
            const allWaitTimes = [];
            const allGsDurations = [];
            const allTsDurations = []; // NOVO: Para métricas de borracharia
            const allAliDurations = [];

            const detailedHistoryList = [];
            const lostHistoryList = []; // NOVO: Para histórico de perdas
            
            // Inicializa stats para todos os mecânicos, incluindo os fixos e os do DB
            let mechanicStats = {};
            [...MECHANICS, TIRE_SHOP_MECHANIC, ALIGNMENT_MECHANIC].forEach(m => {
                mechanicStats[m] = {
                    count: 0,
                    totalDurationMs: 0
                };
            });

            // Junta todos os serviços do dia (finalizados e perdidos) para processamento
            const allServicesToday = serviceJobs.filter(j => (j.status === STATUS_FINALIZED || j.status === STATUS_LOST) && isTimestampFromToday(j.finalizedAt));

            // Processa Serviços Gerais (que podem incluir borracharia e alinhamento) - FINALIZADOS
            allServicesToday.filter(j => j.status === STATUS_FINALIZED).forEach(job => {
                const totalDurationMs = calculateDuration(job.timestamp, job.finalizedAt);
                const mechanic = job.assignedMechanic;
                
                const etapas = ['Serviço Geral'];
                const mecsEnvolvidos = [mechanic];

                // --- Cálculo de Duração por Etapa (Req 5.3) ---
                const waitTimeMs = calculateDuration(job.timestamp, job.gsStartedAt);
                const gsDurationMs = calculateDuration(job.gsStartedAt, job.gsFinishedAt);
                const tsDurationMs = calculateDuration(job.tsStartedAt, job.tsFinishedAt); // tsStartedAt precisa ser adicionado
                if (waitTimeMs > 0) allWaitTimes.push(waitTimeMs);
                if (gsDurationMs > 0) allGsDurations.push(gsDurationMs);
                
                // Adiciona stats do Mecânico Geral
                if (mechanicStats[mechanic]) {
                    mechanicStats[mechanic].count++;
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
                        if (aliDurationMs > 0) allAliDurations.push(aliDurationMs);

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
                    car: `${job.licensePlate} (${job.carModel})`,
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
                    vendedor: job.vendedorName,
                    etapa: etapaPerda
                });
            });

            // Processa Alinhamentos Manuais (que não têm serviceJobId)
            finalizedAlignmentsToday.filter(c => c.status === STATUS_FINALIZED).forEach(car => {
                if (car.serviceJobId) return; // Já foi processado acima

                const totalDurationMs = calculateDuration(car.timestamp, car.finalizedAt);
                const aliDurationMs = calculateDuration(car.alignmentStartedAt, car.readyAt);
                if (aliDurationMs > 0) allAliDurations.push(aliDurationMs);
                
                if (mechanicStats[ALIGNMENT_MECHANIC]) {
                    mechanicStats[ALIGNMENT_MECHANIC].count++;
                    mechanicStats[ALIGNMENT_MECHANIC].totalDurationMs += aliDurationMs > 0 ? aliDurationMs : totalDurationMs;
                }

                detailedHistoryList.push({
                    car: `${car.licensePlate} (${car.carModel})`,
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
            const performanceList = [];
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
                bestPerformer = { name: sortedByScore[0].name, avgStr: formatDuration(sortedByScore[0].avgMs) };
                
                const worst = sortedByScore[sortedByScore.length - 1];
                worstPerformer = { name: worst.name, avgStr: formatDuration(worst.avgMs) };
            }

            let slowestCar = { car: '--', avgStr: '--' };
            let fastestCar = { car: '--', avgStr: '--' };
            if (detailedHistoryList.length > 0) {
                const sortedByDuration = [...detailedHistoryList].sort((a, b) => a.durationMs - b.durationMs);
                
                const slowest = sortedByDuration[sortedByDuration.length - 1];
                const bottleneckInfo = slowest.bottleneck ? `Gargalo: ${slowest.bottleneck}` : '';
                slowestCar = { car: slowest.car, avgStr: `${slowest.durationStr}` };
                if (bottleneckInfo) slowestCar.avgStr += ` (${bottleneckInfo})`;

                const fastest = sortedByDuration[0];
                const etapasInfo = fastest.etapas ? `Etapas: ${fastest.etapas}` : '';
                fastestCar = { car: fastest.car, avgStr: `${fastest.durationStr}` };
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
                        <div class="flex justify-between items-center text-sm p-2 rounded-md even:bg-gray-50">
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
                    <tr class="even:bg-gray-50/50">
                        <td class="px-4 py-3 text-sm font-medium text-gray-900">${item.car}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.vendedor}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.mechanics}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.etapas}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.startTime}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">${item.endTime}</td>
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
                    lostHistoryTbody.innerHTML = lostHistoryList.map(item => `
                        <tr class="bg-red-50/30"><td class="px-4 py-3 text-sm font-medium text-gray-900">${item.car}</td><td class="px-4 py-3 text-sm text-gray-600">${item.vendedor}</td><td class="px-4 py-3 text-sm font-semibold text-red-700">${item.etapa}</td></tr>`).join('');
                } else {
                    lostHistoryTbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-500 italic">Nenhum serviço perdido hoje.</td></tr>`;
                }
            }
        }


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
                
                serviceJobs = jobs.filter(j => 
                    j.status === STATUS_PENDING || 
                    j.status === STATUS_READY ||
                    j.status === STATUS_GS_FINISHED ||
                    (j.status === STATUS_FINALIZED && isTimestampFromToday(j.finalizedAt)) ||
                    (j.status === STATUS_LOST && isTimestampFromToday(j.finalizedAt))
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
                
                alignmentQueue = cars.filter(c => 
                    c.status === STATUS_WAITING ||
                    c.status === STATUS_ATTENDING ||
                    c.status === STATUS_WAITING_GS ||
                    c.status === STATUS_READY ||
                    (c.status === STATUS_FINALIZED && isTimestampFromToday(c.finalizedAt)) ||
                    (c.status === STATUS_LOST && isTimestampFromToday(c.finalizedAt))
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
        window.confirmMarkAsLost = confirmMarkAsLost; 
        window.showDefineServiceModal = showDefineServiceModal;
        window.hideDefineServiceModal = hideDefineServiceModal;
        window.showEditServiceModal = showEditServiceModal;
        window.hideEditServiceModal = hideEditServiceModal;
        window.showMarkAsLostConfirmation = showMarkAsLostConfirmation;

        window.showDeleteUserConfirmation = showDeleteUserConfirmation; // NOVO
        window.showEditUserModal = showEditUserModal; // NOVO
        window.hideEditUserModal = hideEditUserModal; // NOVO

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
