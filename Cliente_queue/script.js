import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, query, where, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- Configuração do Firebase ---
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
const PROMOTIONS_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/promotions`;

// Status do Sistema Operacional - CORRIGIDO
const STATUS_PENDING = 'Pendente';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_GS_FINISHED = 'Serviço Geral Concluído';
const STATUS_IN_PROGRESS = 'Em Andamento';

// Status do Alinhamento - CORRIGIDO
const STATUS_WAITING_GS = 'Aguardando Serviço Geral';
const STATUS_WAITING = 'Aguardando';
const STATUS_ATTENDING = 'Em Atendimento';
const STATUS_ALIGNMENT_FINISHED = 'Finalizado';

// --- Estado Global ---
let serviceJobs = [];
let alignmentQueue = [];
let ads = [];
const SCROLL_WAIT_AT_TOP = 10 * 1000;

// --- Estado do Ciclo de Anúncios ---
const API_BASE_URL = 'https://marketing-api.lucasscosilva.workers.dev';
let adCycleTimeout = null;
let globalImageDuration = 10;
let queueDisplayInterval = 2 * 60 * 1000;
let currentAdIndex = 0;

// --- Gerenciamento de Exibição ---
const queueContainer = document.getElementById('queue-container');
const adContainer = document.getElementById('ad-container');

/**
 * Aguarda a confirmação da sessão anônima do Firebase
 */
function waitForFirebaseAuth() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log("✅ Usuário anônimo autenticado com sucesso no Firebase.");
            initializeSystem();
        } else {
            console.log("⏳ Nenhum usuário. Tentando login anônimo...");
            signInAnonymously(auth).catch(error => console.error("❌ Falha no login anônimo:", error));
        }
    });
}

/**
 * Inicia os listeners do Firestore e outras funcionalidades
 */
function initializeSystem() {
    setupClock();
    setupRealtimeListeners();
    fetchAds();
    fetchGlobalConfig();
    fetchIntervalConfig();
    startAdCycle();
}

/**
 * Configura o relógio em tempo real
 */
function setupClock() {
    const clockElement = document.getElementById('datetime-display');
    if (!clockElement) return;

    function updateClock() {
        const now = new Date();
        const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
        const dateString = now.toLocaleDateString('pt-BR', options);
        const timeString = now.toLocaleTimeString('pt-BR');
        clockElement.textContent = `${dateString.replace(/\.$/, '')} | ${timeString}`;
    }

    updateClock();
    setInterval(updateClock, 1000);
}

/**
 * CORRIGIDO: Configura os listeners do Firestore
 */
function setupRealtimeListeners() {
    // CORRIGIDO: Incluindo mais status relevantes e sem usar 'in' com mais de 10 itens
    const serviceQuery = query(
        collection(db, SERVICE_COLLECTION_PATH)
    );

    onSnapshot(serviceQuery, (snapshot) => {
        // Filtra os status relevantes no cliente
        serviceJobs = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(job => {
                const status = job.status;
                return status === STATUS_PENDING || 
                       status === STATUS_READY || 
                       status === STATUS_GS_FINISHED || 
                       status === STATUS_IN_PROGRESS ||
                       status === 'Serviço Geral Concluído';
            });
        
        console.log("📋 Serviços carregados:", serviceJobs.length);
        serviceJobs.forEach(job => {
            console.log(`  - ${job.licensePlate}: ${job.status} | GS: ${job.statusGS} | TS: ${job.statusTS}`);
        });
        renderDisplay();
    }, (error) => {
        console.error("❌ Erro ao ouvir serviços:", error);
        document.getElementById('ongoing-services-cards').innerHTML = 
            `<p style="color: red; padding: 2rem; text-align: center;">Erro ao carregar dados.</p>`;
    });

    // CORRIGIDO: Incluindo status 'Finalizado'
    const alignmentQuery = query(
        collection(db, ALIGNMENT_COLLECTION_PATH)
    );

    onSnapshot(alignmentQuery, (snapshot) => {
        // Filtra os status relevantes no cliente
        alignmentQueue = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(car => {
                const status = car.status;
                return status === STATUS_WAITING || 
                       status === STATUS_ATTENDING || 
                       status === STATUS_WAITING_GS || 
                       status === STATUS_READY ||
                       status === STATUS_ALIGNMENT_FINISHED ||
                       status === 'Finalizado';
            });
        
        console.log("🔧 Fila de alinhamento carregada:", alignmentQueue.length);
        alignmentQueue.forEach(car => {
            console.log(`  - ${car.licensePlate}: ${car.status}`);
        });
        renderDisplay();
    }, (error) => {
        console.error("❌ Erro ao ouvir fila de alinhamento:", error);
    });

    // Listener para promoções
    const promotionsQuery = query(
        collection(db, PROMOTIONS_COLLECTION_PATH),
        orderBy("order")
    );

    onSnapshot(promotionsQuery, (snapshot) => {
        const promotions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPromotions(promotions);
    }, (error) => {
        console.error("❌ Erro ao ouvir promoções:", error);
        document.getElementById('promotions-list').innerHTML = 
            `<p class="error-message">Erro ao carregar promoções.</p>`;
    });
}

/**
 * CORRIGIDO: Orquestra a renderização da tela
 */
function renderDisplay() {
    console.log("🎨 === INICIANDO RENDERIZAÇÃO ===");
    const vehicleData = new Map();
    const readyItems = [];

    const getVehicle = (plate) => {
        if (!vehicleData.has(plate)) {
            vehicleData.set(plate, { plate, model: 'Veículo', services: {}, priority: 99 });
        }
        return vehicleData.get(plate);
    };

    // 1. CORRIGIDO: Processa SERVIÇOS GERAIS
    console.log("📦 Processando serviços gerais...");
    serviceJobs.forEach(job => {
        console.log(`  🔍 Analisando ${job.licensePlate} (${job.status})`);
        
        if (job.status === STATUS_READY) {
            console.log(`    ✅ Adicionado aos prontos`);
            readyItems.push({ plate: job.licensePlate, model: job.carModel || 'Veículo' });
            return;
        }

        // CORRIGIDO: Processar serviços que não estejam finalizados/pagos
        if (job.status !== 'Finalizado' && job.status !== 'Pago') {
            const vehicle = getVehicle(job.licensePlate);
            vehicle.model = job.carModel || vehicle.model;
            
            if (5 < vehicle.priority) vehicle.priority = 5;

            // CORRIGIDO: Usar 'type' ao invés de 'serviceType'
            const jobType = job.type || job.serviceType || '';
            
            // Verifica se tem Serviço Geral (Mecânico)
            if (jobType.includes('Serviço Geral') || job.statusGS) {
                const isCompleted = job.statusGS === 'Concluído' || 
                                   job.statusGS === 'Serviço Geral Concluído' ||
                                   job.status === 'Serviço Geral Concluído';
                vehicle.services.general = { 
                    name: 'Mecânico', 
                    completed: isCompleted
                };
                console.log(`    🔧 Mecânico: ${isCompleted ? '✅ Concluído' : '⏳ Em andamento'}`);
            }

            // Verifica se tem Serviço de Pneus (Borracheiro)
            if (jobType.includes('Pneus') || job.statusTS) {
                const isCompleted = job.statusTS === 'Concluído' || 
                                   job.statusTS === 'Serviço Pneus Concluído';
                vehicle.services.tires = { 
                    name: 'Borracheiro', 
                    completed: isCompleted
                };
                console.log(`    🛞 Borracheiro: ${isCompleted ? '✅ Concluído' : '⏳ Em andamento'}`);
            }
        }
    });

    // 2. CORRIGIDO: Processa ALINHAMENTO
    console.log("🎯 Processando alinhamento...");
    alignmentQueue.forEach(car => {
        console.log(`  🔍 Analisando ${car.licensePlate} (${car.status})`);
        
        const vehicle = getVehicle(car.licensePlate);
        vehicle.model = car.carModel || vehicle.model;

        // CORRIGIDO: Considerar 'Finalizado' como concluído
        const isAlignmentCompleted = car.status === STATUS_READY || 
                                    car.status === STATUS_ALIGNMENT_FINISHED ||
                                    car.status === 'Finalizado';

        vehicle.services.alignment = { 
            name: 'Alinhamento', 
            completed: isAlignmentCompleted 
        };
        
        console.log(`    📐 Alinhamento: ${isAlignmentCompleted ? '✅ Concluído' : '⏳ Em andamento'}`);

        // CORRIGIDO: Adiciona à lista de prontos APENAS se o status for exatamente 'Pronto para Pagamento'.
        if (car.status === STATUS_READY) {
            if (!readyItems.some(item => item.plate === car.licensePlate)) {
                readyItems.push({ plate: car.licensePlate, model: car.carModel || 'Veículo' });
            }
        }
        
        let priority = car.status === STATUS_ATTENDING ? 1 : (car.status === STATUS_WAITING ? 2 : 3);
        if (priority < vehicle.priority) vehicle.priority = priority;
        vehicle.inAlignmentQueue = true;
    });

    // Filtra veículos com serviços não concluídos
    const displayItems = Array.from(vehicleData.values()).filter(vehicle => {
        const serviceStatuses = Object.values(vehicle.services);
        const hasIncomplete = serviceStatuses.length > 0 && serviceStatuses.some(service => !service.completed);
        
        if (hasIncomplete) {
            console.log(`✅ Exibindo ${vehicle.plate}: ${Object.keys(vehicle.services).length} serviços`);
        }
        
        return hasIncomplete;
    });

    // Ordena
    displayItems.sort((a, b) => a.priority - b.priority);

    console.log(`📊 Resultado: ${displayItems.length} em andamento, ${readyItems.length} prontos`);
    console.log("🎨 === FIM DA RENDERIZAÇÃO ===\n");

    // Renderiza
    renderServiceList(displayItems);
    renderReadyList(readyItems);
}

/**
 * Renderiza a lista de serviços em andamento
 */
function renderServiceList(items) {
    const cardsContainer = document.getElementById('ongoing-services-cards');
    if (items.length === 0) {
        cardsContainer.innerHTML = `<p style="text-align: center; padding: 2rem; width: 100%;">Nenhum veículo em atendimento.</p>`;
        return;
    }
    cardsContainer.innerHTML = items.map((item) => {
        const progressHtml = Object.entries(item.services).map(([key, service]) => {
            const statusClass = service.completed ? `completed ${key}` : '';
            return `
                <div class="progress-item">
                    <span class="service-name">${service.name}</span>
                    <div class="status-circle ${statusClass}"></div>
                </div>
            `;
        }).join('');

        return `
            <div class="service-card">
                <div class="car-info">
                    <div class="car-model">${item.model || 'Veículo'}</div>
                    <div class="car-plate">${item.plate}</div>
                </div>
                <div class="service-progress">
                    ${progressHtml}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Renderiza a lista de serviços concluídos
 */
function renderReadyList(items) {
    const cardsContainer = document.getElementById('completed-services-cards');
    cardsContainer.innerHTML = items.map(item => `
        <div class="completed-card">
            <div class="car-model">${item.model || 'Veículo'}</div>
            <div class="car-plate">${item.plate}</div>
        </div>
    `).join('');
}

/**
 * Renderiza a lista de promoções
 */
function renderPromotions(promotions) {
    const listContainer = document.getElementById('promotions-list');
    if (!listContainer) return;

    if (promotions.length === 0) {
        listContainer.innerHTML = `<div class="promo-card-empty"><p>Nenhuma promoção ativa no momento.</p></div>`;
        return;
    }

    listContainer.innerHTML = promotions.map(promo => {
        let formattedDate = 'Sem validade';
        if (promo.validity) {
            try {
                const [year, month, day] = promo.validity.split('-');
                formattedDate = `Válido até ${day}/${month}/${year}`;
            } catch (e) {
                console.warn(`Data de validade em formato inválido: ${promo.validity}`);
                formattedDate = 'Validade indeterminada';
            }
        }

        const iconClass = promo.icon || 'fa-solid fa-tags';

        return `
            <div class="promotion-item">
                <h4>
                    <i class="${iconClass}"></i>
                    ${promo.title || 'Promoção'}
                </h4>
                <p>${promo.description || ''}</p>
                <p class="expiry-date">${formattedDate}</p>
            </div>`;
    }).join('');

    ScrollManager.reinit(listContainer);
}

/**
 * Gerencia a rolagem automática
 */
const ScrollManager = {
    instances: [],
    isPaused: false,

    init(element) {
        const instance = {
            id: element.id || `scroll-instance-${this.instances.length}`,
            element: element,
            timeoutId: null,
            isScrolling: false,
        };

        const startCycle = () => {
            if (instance.timeoutId) clearTimeout(instance.timeoutId);
            if (this.isPaused || element.scrollHeight <= element.clientHeight) {
                instance.isScrolling = false;
                return;
            }
            instance.isScrolling = true;
            instance.timeoutId = setTimeout(scrollDown, SCROLL_WAIT_AT_TOP);
        };

        const scrollDown = () => {
            if (this.isPaused) return;
            const targetY = element.scrollHeight - element.clientHeight;
            this.smoothScroll(element, targetY, 2000, scrollUp);
        };

        const scrollUp = () => {
            if (this.isPaused) return;
            setTimeout(() => {
                this.smoothScroll(element, 0, 2000, startCycle);
            }, 500);
        };

        instance.start = startCycle;
        this.instances.push(instance);
        instance.start();
    },
    
    reinit(element) {
        const instanceIndex = this.instances.findIndex(inst => inst.element === element);
        if (instanceIndex > -1) {
            const instance = this.instances[instanceIndex];
            if (instance.timeoutId) clearTimeout(instance.timeoutId);
            instance.start();
        }
    },

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

    pauseAll() {
        this.isPaused = true;
        this.instances.forEach(inst => clearTimeout(inst.timeoutId));
    },

    resumeAll() {
        this.isPaused = false;
        this.instances.forEach(inst => {
            if (inst.isScrolling) inst.start();
        });
    }
};

/**
 * Busca configuração de duração global
 */
async function fetchGlobalConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/duration`);
        if (response.ok) {
            const config = await response.json();
            if (config && config.value) {
                globalImageDuration = parseInt(config.value, 10);
                console.log(`⏱️ Duração global: ${globalImageDuration}s`);
            }
        }
    } catch (error) {
        console.error("❌ Erro ao buscar duração global:", error);
    }
}

/**
 * Busca configuração de intervalo
 */
async function fetchIntervalConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/interval`);
        if (response.ok) {
            const config = await response.json();
            if (config && config.value && !isNaN(parseInt(config.value, 10))) {
                queueDisplayInterval = parseInt(config.value, 10);
                console.log(`⏱️ Intervalo da fila: ${queueDisplayInterval / 60000} min`);
            }
        }
    } catch (error) {
        console.error("❌ Erro ao buscar intervalo:", error);
    }
}

/**
 * Busca anúncios da API
 */
async function fetchAds() {
    try {
        const response = await fetch(`${API_BASE_URL}/media`);
        if (!response.ok) {
            throw new Error('Falha ao buscar mídias da API.');
        }
        const mediaItems = await response.json();
        ads = mediaItems
            .filter(item => item.status === 'ativo')
            .map(item => ({ ...item, type: item.type === 'Imagem' ? 'image' : 'video' }))
            .sort((a, b) => (a.order || 99) - (b.order || 99));

        console.log(`📺 Anúncios carregados: ${ads.length}`);
    } catch (error) {
        console.error("❌ Erro ao buscar anúncios:", error);
        ads = [];
    }
}

/**
 * Inicia o ciclo de anúncios
 */
function startAdCycle() {
    if (adCycleTimeout) {
        clearTimeout(adCycleTimeout);
    }
    adCycleTimeout = setTimeout(showNextAd, queueDisplayInterval);
    console.log(`📅 Próximo anúncio em ${queueDisplayInterval / 60000} min`);
}

/**
 * Exibe o próximo anúncio
 */
function showNextAd() {
    if (ads.length === 0) {
        console.warn("⚠️ Nenhum anúncio disponível");
        adCycleTimeout = setTimeout(startAdCycle, 30000);
        return;
    }

    const ad = ads[currentAdIndex];
    currentAdIndex = (currentAdIndex + 1) % ads.length;

    ScrollManager.pauseAll();
    queueContainer.classList.add('fade-hidden');

    setTimeout(() => {
        queueContainer.classList.add('hidden');
        adContainer.innerHTML = '';
        adContainer.classList.remove('hidden', 'fade-hidden');

        let adElement;
        if (ad.type === 'video') {
            const video = document.createElement('video');
            video.src = ad.url;
            video.autoplay = true;
            video.muted = false;
            video.playsInline = true;
            adElement = video;

            video.onended = hideAdAndResume;
            adContainer.appendChild(adElement);
            video.play().catch(error => console.error("❌ Falha ao reproduzir vídeo:", error));

        } else {
            const img = document.createElement('img');
            img.src = ad.url;
            adElement = img;

            const displayTime = (ad.duration || globalImageDuration) * 1000;
            console.log(`🖼️ Exibindo imagem por ${displayTime / 1000}s`);
            adCycleTimeout = setTimeout(hideAdAndResume, displayTime);
            adContainer.appendChild(adElement);
        }

    }, 400);
}

/**
 * Esconde anúncio e volta à fila
 */
function hideAdAndResume() {
    adContainer.classList.add('fade-hidden');
    setTimeout(() => {
        adContainer.classList.add('hidden');
        queueContainer.classList.remove('hidden', 'fade-hidden');
        ScrollManager.resumeAll();
        startAdCycle();
    }, 400);
}

// --- Inicialização ---
let isFirstRender = true;

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Iniciando aplicação...");
    waitForFirebaseAuth();

    const originalRender = renderDisplay;
    renderDisplay = (...args) => {
        originalRender.apply(this, args);
        if (isFirstRender) {
            document.querySelectorAll('.cards-container, #promotions-list').forEach(el => ScrollManager.init(el));
            isFirstRender = false;
        }
    };
});