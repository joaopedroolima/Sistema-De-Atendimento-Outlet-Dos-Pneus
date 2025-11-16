import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

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

const app = initializeApp(LOCAL_FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

// --- Constantes ---
const APP_ID = 'local-autocenter-app';
const CLIENT_ROLE = 'cliente';
const SERVICE_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/serviceJobs`;
const ALIGNMENT_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/alignmentQueue`;

// Status do Sistema Operacional
const STATUS_PENDING = 'Pendente';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_GS_FINISHED = 'Serviço Geral Concluído';

// Status do Alinhamento
const STATUS_WAITING_GS = 'Aguardando Serviço Geral';
const STATUS_WAITING = 'Aguardando';
const STATUS_ATTENDING = 'Em Atendimento';

// --- Estado Global ---
let serviceJobs = [];
let alignmentQueue = [];

// --- Estado do Auto-Scroll ---
let scrollInterval = null;
let scrollDirection = 'down';
const SCROLL_SPEED = 25; // Intervalo de atualização (mais rápido para suavidade)
const SCROLL_STEP = 1; // Pixels por passo (menor para ser mais suave)

// --- Gerenciamento de Exibição (Fila vs Anúncios) ---
const queueContainer = document.getElementById('queue-container');
const adContainer = document.getElementById('ad-container');

/**
 * Verifica se o usuário logado tem permissão para ver esta página.
 * Redireciona para o login caso não tenha. (RNF002)
 */
function checkAuth() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user || user.role !== CLIENT_ROLE) {
        console.warn('Acesso negado. Redirecionando para o login.');
        window.location.href = '../auth/index.html';
    } else {
        console.log(`Usuário '${user.username}' autenticado com sucesso como '${user.role}'.`);
        // NOVO: A inicialização agora depende da autenticação do Firebase.
        waitForFirebaseAuth();
    }
}

/**
 * NOVO: Aguarda a confirmação da sessão anônima do Firebase antes de iniciar os listeners.
 * Isso resolve o problema de permissão que ocorria antes.
 */
function waitForFirebaseAuth() {
    onAuthStateChanged(auth, (user) => {
        if (user) { // Usuário anônimo está logado
            initializeSystem();
        }
    });
}

/**
 * Inicia os listeners do Firestore e outras funcionalidades do sistema.
 */
function initializeSystem() {
    setupClock();
    setupRealtimeListeners();
    // Futuramente, aqui chamaremos a função que gerencia anúncios.
}

/**
 * Configura um relógio em tempo real no cabeçalho.
 */
function setupClock() {
    const clockElement = document.getElementById('clock');
    if (!clockElement) return;

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        clockElement.textContent = `${hours}:${minutes}`;
    }

    updateClock();
    setInterval(updateClock, 10000); // Atualiza a cada 10 segundos
}

/**
 * Configura os listeners para ouvir as coleções do Firestore em tempo real. (RF001)
 */
function setupRealtimeListeners() {
    const serviceQuery = query(
        collection(db, SERVICE_COLLECTION_PATH),
        where('status', 'in', [STATUS_PENDING, STATUS_READY, STATUS_GS_FINISHED])
    );

    onSnapshot(serviceQuery, (snapshot) => {
        serviceJobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDisplay();
    }, (error) => {
        console.error("Erro ao ouvir serviços:", error);
        document.getElementById('service-list').innerHTML = `<p class="text-red-400">Erro ao carregar dados dos serviços.</p>`;
    });

    const alignmentQuery = query(
        collection(db, ALIGNMENT_COLLECTION_PATH),
        where('status', 'in', [STATUS_WAITING, STATUS_ATTENDING, STATUS_WAITING_GS, STATUS_READY])
    );

    onSnapshot(alignmentQuery, (snapshot) => {
        alignmentQueue = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDisplay();
    }, (error) => {
        console.error("Erro ao ouvir fila de alinhamento:", error);
        document.getElementById('service-list').innerHTML += `<p class="text-red-400">Erro ao carregar dados do alinhamento.</p>`;
    });
}

/**
 * Orquestra a renderização da tela, unindo e ordenando os dados.
 */
function renderDisplay() {
    // 1. Unifica e processa os dados para exibição
    const displayItems = [];
    const readyItems = [];

    // Processa carros da fila de alinhamento
    alignmentQueue.forEach(car => {
        if (car.status === STATUS_READY) {
            readyItems.push({ plate: car.licensePlate, model: car.carModel });
        } else {
            let priority = 99;
            let statusText = "Na fila";
            if (car.status === STATUS_ATTENDING) { priority = 1; statusText = "Alinhando"; }
            else if (car.status === STATUS_WAITING) { priority = 2; statusText = "Aguardando Alinhamento"; }
            else if (car.status === STATUS_WAITING_GS) { priority = 3; statusText = "Aguardando Serviço Geral"; }
            
            displayItems.push({ plate: car.licensePlate, model: car.carModel, status: statusText, priority });
        }
    });

    // Processa carros da fila de serviços gerais
    serviceJobs.forEach(job => {
        if (job.status === STATUS_READY) {
            readyItems.push({ plate: job.licensePlate, model: job.carModel });
        } else if (job.status === STATUS_PENDING) {
            let statusText = "Em serviço";
            let priority = 5;
            if (job.statusGS === 'Pendente' && job.statusTS === 'Pendente') {
                statusText = "Serviço Geral e Pneus";
            } else if (job.statusGS === 'Pendente') {
                statusText = "Serviço Geral";
            } else if (job.statusTS === 'Pendente') {
                statusText = "Serviço de Pneus";
            }
            displayItems.push({ plate: job.licensePlate, model: job.model, status: statusText, priority });
        }
    });

    // 2. Ordena a fila principal (RF002)
    displayItems.sort((a, b) => a.priority - b.priority);

    // 3. Renderiza as listas
    renderServiceList(displayItems);
    renderReadyList(readyItems);
    handleAutoScroll(); // Inicia ou para o auto-scroll
}

/**
 * Renderiza a lista de serviços em andamento.
 * @param {Array} items - A lista de itens para exibir.
 */
function renderServiceList(items) {
    const container = document.getElementById('service-list');
    if (items.length === 0) {
        container.innerHTML = `<p class="col-span-2 text-center text-2xl text-gray-400 mt-10">Nenhum veículo em atendimento no momento.</p>`;
        return;
    }
    container.innerHTML = items.map((item, index) => `
        <div class="service-card bg-white p-3 rounded-lg shadow-sm border-l-8 border-blue-500 flex items-center">
            <span class="text-2xl font-bold text-gray-400 w-12 text-center">${index + 1}º</span>
            <div class="flex-grow border-l border-gray-200 pl-3">
                <p class="text-2xl font-bold text-gray-800">${item.plate}</p>
                <p class="text-lg text-gray-500">${item.model}</p>
            </div>
            <div class="text-right pr-3">
                <p class="text-lg font-bold text-yellow-500">${item.status}</p>
            </div>
        </div>
    `).join('');
}

/**
 * Renderiza a lista de serviços concluídos no rodapé. (RF004)
 * @param {Array} items - A lista de itens prontos.
 */
function renderReadyList(items) {
    const container = document.getElementById('ready-list');
    container.innerHTML = items.map(item => `
        <div class="bg-green-100 border border-green-300 p-3 rounded-lg text-center shadow-sm">
            <p class="font-bold text-xl text-green-800">${item.plate}</p>
        </div>
    `).join('');
}

/**
 * NOVO: Gerencia a rolagem automática da lista de serviços.
 */
function handleAutoScroll() {
    const container = document.getElementById('service-list');
    const isOverflowing = container.scrollHeight > container.clientHeight;

    if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
    }

    if (isOverflowing) {
        scrollInterval = setInterval(() => {
            // Adiciona uma pequena margem para garantir que chegue ao fim
            const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight;
            const atTop = container.scrollTop === 0;

            if (scrollDirection === 'down' && atBottom) {
                scrollDirection = 'up'; // Prepara para subir
                clearInterval(scrollInterval); // Pausa no final
                setTimeout(handleAutoScroll, 2500); // Espera 2.5s e recomeça
                return;
            }
            
            if (scrollDirection === 'up' && atTop) {
                scrollDirection = 'down'; // Prepara para descer
                clearInterval(scrollInterval); // Pausa no topo
                setTimeout(handleAutoScroll, 2500); // Espera 2.5s e recomeça
                return;
            }

            container.scrollBy({
                top: scrollDirection === 'down' ? SCROLL_STEP : -SCROLL_STEP,
                behavior: 'auto' // 'auto' é melhor para rolagem contínua com setInterval
            });
        }, SCROLL_SPEED);
    }
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});