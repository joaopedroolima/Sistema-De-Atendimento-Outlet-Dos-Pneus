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
let ads = []; // NOVO: Armazena a lista de anúncios
const SCROLL_WAIT_AT_TOP = 20 * 1000; // NOVO: Tempo de espera da rolagem no topo (20 segundos)

// --- Estado do Ciclo de Anúncios (RF005) ---
const API_BASE_URL = 'https://marketing-api.lucasscosilva.workers.dev'; // URL da API de Marketing
let adCycleTimeout = null; 
let globalImageDuration = 10; // Duração padrão em segundos para imagens, caso a API falhe.
let queueDisplayInterval = 2 * 60 * 1000; // Padrão: 2 minutos de exibição da fila entre anúncios. Será atualizado pela API.
let currentAdIndex = 0;
const readyAlert = document.getElementById('ready-alert');


// --- Gerenciamento de Exibição (Fila vs Anúncios) ---
const queueContainer = document.getElementById('queue-container');
const adContainer = document.getElementById('ad-container');

/**
 * NOVO: Importa a função de login anônimo do Firebase.
 */
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

/**
/**
 * NOVO: Aguarda a confirmação da sessão anônima do Firebase antes de iniciar os listeners.
 * Isso resolve o problema de permissão que ocorria antes.
 */
function waitForFirebaseAuth() {
    onAuthStateChanged(auth, (user) => {
        if (user) { // Usuário anônimo está logado
            console.log("Usuário anônimo autenticado com sucesso no Firebase.");
            initializeSystem();
        } else {
            // Se não houver usuário, tenta fazer o login anônimo.
            console.log("Nenhum usuário. Tentando login anônimo...");
            signInAnonymously(auth).catch(error => console.error("Falha no login anônimo:", error));
        }
    });
}

/**
 * Inicia os listeners do Firestore e outras funcionalidades do sistema.
 */
function initializeSystem() {
    setupClock();
    setupRealtimeListeners();
    fetchAds(); // Busca os anúncios da API
    fetchGlobalConfig(); // Busca a configuração de duração padrão
    fetchIntervalConfig(); // NOVO: Busca a configuração de intervalo
    startAdCycle(); // Inicia o ciclo de exibição de anúncios
}

/**
 * Configura um relógio em tempo real no cabeçalho.
 */
function setupClock() {
    const clockElement = document.getElementById('datetime-display');
    if (!clockElement) return;

    function updateClock() {
        const now = new Date();
        const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
        const dateString = now.toLocaleDateString('pt-BR', options);
        const timeString = now.toLocaleTimeString('pt-BR');
        clockElement.textContent = `${dateString.replace(/\.$/, '')} | ${timeString}`; // Remove o ponto final do "short" weekday
    }

    updateClock();
    setInterval(updateClock, 1000); // Atualiza a cada segundo
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
        document.getElementById('ongoing-services-table').innerHTML = `<tr><td colspan="4">Erro ao carregar dados.</td></tr>`;
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
        document.getElementById('ongoing-services-table').innerHTML += `<tr><td colspan="4">Erro ao carregar dados.</td></tr>`;
    });
}

/**
 * Orquestra a renderização da tela, unindo e ordenando os dados.
 */
function renderDisplay() {
    // 1. Unifica e processa os dados para exibição, tratando duplicidades
    const combinedItems = new Map();
    const readyItems = [];

    // Processa carros da fila de alinhamento
    alignmentQueue.forEach(car => {
        if (car.status === STATUS_READY) {
            readyItems.push({ plate: car.licensePlate, client: car.clientName || 'N/A', service: 'Alinhamento' });
            return;
        }

        let priority = 99;
        let statusText = "Na fila";
        if (car.status === STATUS_ATTENDING) { priority = 1; statusText = "Alinhando"; }
        else if (car.status === STATUS_WAITING) { priority = 2; statusText = "Aguardando Alinhamento"; }
        else if (car.status === STATUS_WAITING_GS) { priority = 3; statusText = "Aguardando Serviço Geral"; }

        combinedItems.set(car.licensePlate, {
            plate: car.licensePlate,
            client: car.clientName || 'N/A',
            service: 'Alinhamento',
            status: statusText,
            priority,
            statusClass: car.status === STATUS_ATTENDING ? 'in-progress' : 'waiting'
        });
    });

    // Processa carros da fila de serviços gerais
    serviceJobs.forEach(job => {
        if (job.status === STATUS_READY) {
            readyItems.push({ plate: job.licensePlate, client: job.clientName || 'N/A', service: 'Serviço Geral' });
            return;
        }

        // Se o carro já está na lista (veio do alinhamento), não o substitua,
        // pois o status de alinhamento tem prioridade de exibição.
        if (job.status === STATUS_PENDING && !combinedItems.has(job.licensePlate)) {
            const serviceText = (job.statusGS === 'Pendente' && job.statusTS === 'Pendente')
                ? "Serviço Geral e Pneus"
                : (job.statusGS === 'Pendente' ? "Serviço Geral" : "Serviço de Pneus");
            
            combinedItems.set(job.licensePlate, { plate: job.licensePlate, client: job.clientName || 'N/A', service: serviceText, status: 'Em Andamento', priority: 5, statusClass: 'in-progress' });
        }
    });

    // Converte o Map para um array
    const displayItems = Array.from(combinedItems.values());

    // 2. Ordena a fila principal (RF002)
    displayItems.sort((a, b) => a.priority - b.priority);

    // 3. Renderiza as listas
    renderServiceList(displayItems);
    renderReadyList(readyItems);
}

/**
 * Renderiza a lista de serviços em andamento.
 * @param {Array} items - A lista de itens para exibir.
 */
function renderServiceList(items) {
    const tableBody = document.getElementById('ongoing-services-table');
    if (items.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem;">Nenhum veículo em atendimento.</td></tr>`;
        return;
    }
    tableBody.innerHTML = items.map((item, index) => `
        <tr>
            <td><div class="queue-position">${index + 1}º</div></td>
            <td>${item.plate}</td>
            <td>${item.service}</td>
            <td><span class="status-badge ${item.statusClass}">${item.status}</span></td>
        </tr>
    `).join('');
}

/**
 * Renderiza a lista de serviços concluídos.
 * @param {Array} items - A lista de itens prontos.
 */
function renderReadyList(items) {
    const tableBody = document.getElementById('completed-services-table');
    tableBody.innerHTML = items.map(item => `
        <tr>
            <td>${item.plate}</td>
            <td>${item.service}</td>
            <td><span class="status-badge ready">Pronto</span></td>
        </tr>
    `).join('');
}

/**
 * NOVO: Gerencia a rolagem automática dos contêineres.
 */
const ScrollManager = {
    instances: [],
    isPaused: false,

    /**
     * Inicia o auto-scroll para um elemento.
     * @param {HTMLElement} element - O elemento do contêiner a ser rolado.
     */
    init(element) {
        const instance = {
            element: element,
            timeoutId: null,
            isScrolling: false,
        };

        const startCycle = () => {
            // Cancela qualquer ciclo anterior para evitar duplicação
            if (instance.timeoutId) clearTimeout(instance.timeoutId);

            // Só inicia se não estiver pausado e se houver conteúdo para rolar
            if (this.isPaused || element.scrollHeight <= element.clientHeight) {
                instance.isScrolling = false;
                return;
            }
            
            instance.isScrolling = true;
            instance.timeoutId = setTimeout(scrollDown, SCROLL_WAIT_AT_TOP); // Usa a nova constante de 20s
        };

        const scrollDown = () => {
            if (this.isPaused) return;
            const targetY = element.scrollHeight - element.clientHeight;
            this.smoothScroll(element, targetY, 2000, scrollUp); // Rola para baixo em 2s
        };

        const scrollUp = () => {
            if (this.isPaused) return;
            // Pequena pausa no final antes de subir
            setTimeout(() => {
                this.smoothScroll(element, 0, 2000, startCycle); // Rola para cima em 2s e reinicia o ciclo
            }, 500);
        };

        instance.start = startCycle;
        this.instances.push(instance);
        instance.start();
    },

    /**
     * Rola suavemente um elemento para uma posição.
     * @param {HTMLElement} el - O elemento.
     * @param {number} to - A posição de destino.
     * @param {number} duration - Duração da animação.
     * @param {Function} callback - Função a ser chamada no final.
     */
    smoothScroll(el, to, duration, callback) {
        const start = el.scrollTop;
        const change = to - start;
        const startTime = performance.now();

        const animateScroll = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            el.scrollTop = start + change * (progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress);

            if (elapsed < duration) {
                requestAnimationFrame(animateScroll);
            } else {
                callback && callback();
            }
        };
        requestAnimationFrame(animateScroll);
    },

    // Pausa todas as instâncias de rolagem
    pauseAll() {
        this.isPaused = true;
        this.instances.forEach(inst => clearTimeout(inst.timeoutId));
    },

    // Retoma todas as instâncias de rolagem
    resumeAll() {
        this.isPaused = false;
        this.instances.forEach(inst => {
            if (inst.isScrolling) inst.start();
        });
    }
};
 
/**
 * NOVO: Busca a configuração de duração global para imagens da API.
 */
async function fetchGlobalConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/duration`);
        if (response.ok) {
            const config = await response.json();
            if (config && config.value) {
                globalImageDuration = parseInt(config.value, 10);
                console.log(`Duração global para imagens definida para: ${globalImageDuration}s`);
            }
        }
    } catch (error) {
        console.error("Erro ao buscar configuração de duração global. Usando padrão:", error);
    }
}

/**
 * NOVO: Busca a configuração de intervalo de exibição da fila da API.
 */
async function fetchIntervalConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/interval`);
        if (response.ok) {
            const config = await response.json();
            // O valor da API vem em milissegundos
            if (config && config.value && !isNaN(parseInt(config.value, 10))) {
                queueDisplayInterval = parseInt(config.value, 10);
                console.log(`Intervalo de exibição da fila definido pela API: ${queueDisplayInterval / 60000} minuto(s)`);
            }
        }
    } catch (error) {
        console.error("Erro ao buscar configuração de intervalo. Usando padrão:", error);
    }
}


/**
 * Busca a lista de anúncios ativos da API de marketing.
 */
async function fetchAds() {
    try {
        const response = await fetch(`${API_BASE_URL}/media`);
        if (!response.ok) {
            throw new Error('Falha ao buscar mídias da API.');
        }
        const mediaItems = await response.json();
        // Filtra apenas os ativos e mapeia para o formato esperado
        ads = mediaItems
            .filter(item => item.status === 'ativo')
            .map(item => ({ ...item, type: item.type === 'Imagem' ? 'image' : 'video' }))
            .sort((a, b) => (a.order || 99) - (b.order || 99)); // Ordena pela ordem definida

        console.log(`Anúncios ativos carregados via API: ${ads.length}`);
    } catch (error) {
        console.error("Erro ao buscar anúncios da API:", error);
        ads = []; // Garante que a lista de anúncios fique vazia em caso de erro (RF010)
    }
}

/**
 * Inicia o ciclo que agenda a exibição de anúncios.
 */
function startAdCycle() {
    // Limpa qualquer agendamento anterior para evitar duplicatas
    if (adCycleTimeout) {
        clearTimeout(adCycleTimeout);
    }
    // ATUALIZADO: Agenda a exibição do próximo anúncio para depois do intervalo definido.
    adCycleTimeout = setTimeout(showNextAd, queueDisplayInterval);
    console.log(`Fila de clientes em exibição. Próximo anúncio em ${queueDisplayInterval / 60000} minuto(s).`);
}

/**
 * Exibe o próximo anúncio da lista.
 */
function showNextAd() {
    // RF010: Se não houver anúncios, simplesmente reagenda e continua exibindo a fila.
    if (ads.length === 0) {
        console.warn("Nenhum anúncio para exibir. Reagendando ciclo.");
        // Tenta novamente após um intervalo, caso os anúncios sejam cadastrados depois.
        adCycleTimeout = setTimeout(startAdCycle, 30000);
        return;
    }

    // Seleciona o próximo anúncio em formato de rodízio
    const ad = ads[currentAdIndex];
    currentAdIndex = (currentAdIndex + 1) % ads.length;

    // Para a rolagem da fila e esconde o container
    ScrollManager.pauseAll(); // Pausa a rolagem automática
    queueContainer.classList.add('fade-hidden'); // Inicia o fade-out da fila

    setTimeout(() => { // Aguarda a transição para trocar os conteúdos
        queueContainer.classList.add('hidden');
        adContainer.innerHTML = ''; // Limpa anúncios anteriores
        adContainer.classList.remove('hidden', 'fade-hidden');

        let adElement;
        if (ad.type === 'video') {
            const video = document.createElement('video'); // RF005
            video.src = ad.url;
            video.autoplay = true;
            // O som foi ativado conforme solicitado.
            // Nota: A reprodução automática com som pode ser bloqueada por políticas do navegador.
            video.muted = false;
            video.playsInline = true;
            // O vídeo não deve ser em loop para que o evento 'onended' funcione corretamente.
            adElement = video;
            
            // Quando o vídeo terminar, chama a função para esconder o anúncio.
            video.onended = hideAdAndResume;

            // Adiciona o elemento ao DOM antes de tentar reproduzir
            adContainer.appendChild(adElement);

            // VERSÃO FINAL: Tenta reproduzir o vídeo com som.
            // Para que isso funcione, o navegador DEVE ter permissão para reproduzir som
            // automaticamente para este site. Caso contrário, o vídeo não tocará.
            video.play().catch(error => console.error("Falha ao reproduzir vídeo. Verifique as permissões de som do navegador.", error));

        } else { // 'image'
            const img = document.createElement('img'); // RF005
            img.src = ad.url;
            adElement = img;

            // ATUALIZADO: Usa a duração específica da imagem ou a global.
            const displayTime = (ad.duration || globalImageDuration) * 1000;
            console.log(`Exibindo imagem por ${displayTime / 1000}s`);
            adCycleTimeout = setTimeout(hideAdAndResume, displayTime);
            adContainer.appendChild(adElement);
        }

    }, 400); // Tempo da transição em ms
}

/**
 * Esconde o anúncio, volta a exibir a fila e reinicia o ciclo.
 */
function hideAdAndResume() {
    adContainer.classList.add('fade-hidden'); // Inicia o fade-out do anúncio
    setTimeout(() => {
        adContainer.classList.add('hidden'); // Esconde o container do anúncio
        queueContainer.classList.remove('hidden', 'fade-hidden');
        ScrollManager.resumeAll(); // Retoma a rolagem da fila
        startAdCycle(); // Reagenda o próximo anúncio
    }, 400); // Tempo da transição em ms
}

// --- Inicialização ---
let isFirstRender = true;

document.addEventListener('DOMContentLoaded', () => {
    waitForFirebaseAuth(); // Inicia diretamente a verificação do Firebase.

    // A inicialização da rolagem será feita após a primeira renderização dos dados
    const originalRender = renderDisplay;
    renderDisplay = (...args) => {
        originalRender.apply(this, args);
        if (isFirstRender) {
            document.querySelectorAll('.table-container, .promotions-list').forEach(el => ScrollManager.init(el));
            isFirstRender = false;
        }
    };
});