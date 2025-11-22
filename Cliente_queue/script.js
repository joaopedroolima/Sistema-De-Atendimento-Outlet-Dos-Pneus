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
const SERVICE_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/serviceJobs`;
const ALIGNMENT_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/alignmentQueue`;
const PROMOTIONS_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/promotions`;
const HIDDEN_ITEMS_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/hiddenItems`;

const STATUS_PENDING = 'Pendente';
const STATUS_READY = 'Pronto para Pagamento';
const STATUS_GS_FINISHED = 'Serviço Geral Concluído';
const STATUS_IN_PROGRESS = 'Em Andamento';
const STATUS_WAITING_GS = 'Aguardando Serviço Geral';
const STATUS_WAITING = 'Aguardando';
const STATUS_ATTENDING = 'Em Atendimento';
const STATUS_ALIGNMENT_FINISHED = 'Finalizado';

// --- Estado Global ---
let serviceJobs = [];
let alignmentQueue = [];
let ads = [];
let hiddenItemIds = new Set();
const SCROLL_WAIT_AT_TOP = 15 * 1000; 

const API_BASE_URL = 'https://marketing-api.lucasscosilva.workers.dev';
let adCycleTimeout = null;
let globalImageDuration = 10;
let queueDisplayInterval = 120 * 1000; 
let currentAdIndex = 0;

const queueContainer = document.getElementById('queue-container');
const adContainer = document.getElementById('ad-container');

// --- Autenticação ---
function waitForFirebaseAuth() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            initializeSystem();
        } else {
            signInAnonymously(auth).catch(console.error);
        }
    });
}

async function initializeSystem() {
    setupClock();
    setupRealtimeListeners();
    fetchAds();
    await fetchGlobalConfig(); 
    await fetchIntervalConfig(); 
    startAdCycle();
}

function setupClock() {
    const clockElement = document.getElementById('datetime-display');
    if (!clockElement) return;
    function updateClock() {
        const now = new Date();
        const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
        clockElement.textContent = `${now.toLocaleDateString('pt-BR', options)} | ${now.toLocaleTimeString('pt-BR')}`;
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// --- Listeners ---
function setupRealtimeListeners() {
    const hiddenItemsQuery = query(collection(db, HIDDEN_ITEMS_COLLECTION_PATH));
    onSnapshot(hiddenItemsQuery, (snapshot) => {
        hiddenItemIds = new Set(snapshot.docs.map(doc => doc.id));
        renderDisplay();
    });

    const serviceQuery = query(collection(db, SERVICE_COLLECTION_PATH));
    onSnapshot(serviceQuery, (snapshot) => {
        serviceJobs = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(job => [STATUS_PENDING, STATUS_READY, STATUS_GS_FINISHED, STATUS_IN_PROGRESS, 'Serviço Geral Concluído'].includes(job.status));
        renderDisplay();
    }, console.error);

    const alignmentQuery = query(collection(db, ALIGNMENT_COLLECTION_PATH));
    onSnapshot(alignmentQuery, (snapshot) => {
        alignmentQueue = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(car => [STATUS_WAITING, STATUS_ATTENDING, STATUS_WAITING_GS, STATUS_READY, STATUS_ALIGNMENT_FINISHED, 'Finalizado'].includes(car.status));
        renderDisplay();
    }, console.error);

    const promotionsQuery = query(collection(db, PROMOTIONS_COLLECTION_PATH), orderBy("order"));
    onSnapshot(promotionsQuery, (snapshot) => {
        renderPromotions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, console.error);
}

// --- Renderização ---
function renderDisplay() {
    let vehicleData = new Map();
    const readyItems = [];

    const getVehicle = (plate) => {
        if (!vehicleData.has(plate)) {
            vehicleData.set(plate, { id: null, plate, model: 'Veículo', services: {}, priority: 99, status: null });
        }
        return vehicleData.get(plate);
    };

    serviceJobs.forEach(job => {
        if (job.status === STATUS_READY) {
            readyItems.push({ plate: job.licensePlate, model: job.carModel || 'Veículo', id: job.id });
            return;
        }
        if (job.status !== 'Finalizado' && job.status !== 'Pago') {
            const vehicle = getVehicle(job.licensePlate);
            vehicle.status = job.status;
            vehicle.id = job.id;
            vehicle.model = job.carModel || vehicle.model;
            if (5 < vehicle.priority) vehicle.priority = 5;
            
            const jobType = job.type || job.serviceType || '';
            if (jobType.includes('Serviço Geral') || job.statusGS) {
                const isCompleted = [STATUS_GS_FINISHED, 'Concluído', 'Serviço Geral Concluído'].includes(job.statusGS) || job.status === STATUS_GS_FINISHED;
                vehicle.services.general = { name: 'Mecânico', completed: isCompleted };
            }
            if (jobType.includes('Pneus') || job.statusTS) {
                const isCompleted = ['Concluído', 'Serviço Pneus Concluído'].includes(job.statusTS);
                vehicle.services.tires = { name: 'Borracheiro', completed: isCompleted };
            }
        }
    });

    alignmentQueue.forEach(car => {
        if (car.status === STATUS_READY) {
            if (!readyItems.some(item => item.plate === car.licensePlate)) {
                readyItems.push({ plate: car.licensePlate, model: car.carModel || 'Veículo', id: car.id });
            }
            return;
        }
        const vehicle = getVehicle(car.licensePlate);
        vehicle.model = car.carModel || vehicle.model;
        if (!vehicle.id) vehicle.id = car.id;
        
        const isAlignmentCompleted = [STATUS_READY, STATUS_ALIGNMENT_FINISHED, 'Pronto para Pagamento', 'Finalizado'].includes(car.status);
        vehicle.services.alignment = { name: 'Alinhamento', completed: isAlignmentCompleted, status: car.status };
        
        let priority = car.status === STATUS_ATTENDING ? 1 : (car.status === STATUS_WAITING ? 2 : 3);
        if (priority < vehicle.priority) vehicle.priority = priority;
        vehicle.inAlignmentQueue = true;
    });

    const waitingForAlignment = alignmentQueue.filter(car => car.status === STATUS_WAITING || car.status === STATUS_WAITING_GS);
    waitingForAlignment.sort((a, b) => {
        const getPriority = (s) => s === STATUS_ATTENDING ? 1 : (s === STATUS_WAITING ? 2 : 3);
        return getPriority(a.status) - getPriority(b.status);
    });
    waitingForAlignment.forEach((car, index) => {
        getVehicle(car.licensePlate).alignmentPosition = index + 1;
    });

    const displayItems = Array.from(vehicleData.values()).filter(vehicle => {
        const serviceStatuses = Object.values(vehicle.services);
        return serviceStatuses.length > 0 && serviceStatuses.some(service => !service.completed);
    });

    const displayItemsFiltered = displayItems.filter(item => !hiddenItemIds.has(item.id));
    displayItemsFiltered.sort((a, b) => a.priority - b.priority);
    
    const finalReadyItems = readyItems.filter(item => !hiddenItemIds.has(item.id));

    renderServiceList(displayItemsFiltered);
    renderReadyList(finalReadyItems);
}

function renderServiceList(items) {
    const cardsContainer = document.getElementById('ongoing-services-cards');
    
    if (items.length === 0) {
        cardsContainer.innerHTML = `<p style="text-align: center; padding: 2rem; width: 100%; color: var(--light-text);">Nenhum veículo em atendimento.</p>`;
        ScrollManager.pauseInstance(cardsContainer);
        return;
    }
    
    cardsContainer.innerHTML = items.map((item) => {
        const progressHtml = Object.entries(item.services).map(([key, service]) => {
            const statusClass = service.completed ? `completed ${key}` : '';
            const checkmark = service.completed ? '&#10003;' : '';
            let statusTextClass = statusClass;
            let statusText = '';

            if (key === 'alignment') {
                if (service.completed) {
                    statusText = 'Concluído';
                } else if (service.status === STATUS_ATTENDING) {
                    statusText = 'Atendendo'; // Texto encurtado para caber melhor
                    statusTextClass = 'in-progress';
                } else {
                    statusText = `${item.alignmentPosition}º Fila`;
                    statusTextClass = 'in-queue';
                }
            } else {
                statusText = service.completed ? 'Concluído' : 'Atendendo';
                if (!service.completed) statusTextClass = 'in-progress';
            }
            
            return `
                <div class="progress-item">
                    <div class="service-header">
                        <span class="service-name">${service.name}</span>
                        <div class="status-circle ${statusClass}">${checkmark}</div>
                    </div>
                    <div class="service-status-text ${statusTextClass}">${statusText}</div>
                </div>
            `;
        }).join('');

        return `
            <div class="service-card-wrapper">
                <div class="service-card">
                    <div class="car-info">
                        <div class="car-model">${item.model || 'Veículo'}</div>
                        <div class="car-plate">${item.plate}</div>
                    </div>
                    <div class="service-progress">${progressHtml}</div>
                </div>
            </div>
        `;
    }).join('');

    ScrollManager.reinit(cardsContainer);
}

function renderReadyList(items) {
    const cardsContainer = document.getElementById('completed-services-cards');    
    cardsContainer.innerHTML = items.map(item => `
        <div class="completed-card">
            <div class="car-model">${item.model || 'Veículo'}</div>
            <div class="car-plate">${item.plate}</div>
        </div>
    `).join('');
}

function renderPromotions(promotions) {
    const listContainer = document.getElementById('promotions-list');
    if (!listContainer) return;

    if (promotions.length === 0) {
        listContainer.innerHTML = `<div class="promo-card-empty" style="padding: 1rem; text-align: center; color: var(--light-text);"><p>Nenhuma promoção ativa.</p></div>`;
        return;
    }

    listContainer.innerHTML = promotions.map(promo => {
        let formattedDate = 'Sem validade';
        if (promo.validity) {
            try {
                const [year, month, day] = promo.validity.split('-');
                formattedDate = `Válido até ${day}/${month}/${year}`;
            } catch (e) { formattedDate = 'Validade indeterminada'; }
        }
        return `
            <div class="promotion-item">
                <h4><i class="${promo.icon || 'fa-solid fa-tags'}"></i> ${promo.title || 'Promoção'}</h4>
                <p>${promo.description || ''}</p>
                <p class="promo-offer">${promo.offer || ''}</p>
                <p class="expiry-date">${formattedDate}</p>
            </div>`;
    }).join('');
    ScrollManager.reinit(listContainer);
}

// --- Gerenciador de Scroll ---
const ScrollManager = {
    instances: [],
    isPaused: false,

    init(element) {
        const instance = {
            id: element.id,
            element: element,
            timeoutId: null,
            isScrolling: false,
        };
        const isHorizontal = element.classList.contains('horizontal-scroll');
        const startCycle = () => {
            if (instance.timeoutId) clearTimeout(instance.timeoutId);
            const scrollLength = isHorizontal ? 
                element.scrollWidth - element.clientWidth : 
                element.scrollHeight - element.clientHeight;
            if (this.isPaused || scrollLength <= 2) {
                instance.isScrolling = false;
                return;
            }
            instance.isScrolling = true;
            instance.timeoutId = setTimeout(scrollForward, SCROLL_WAIT_AT_TOP); 
        };
        const scrollForward = () => {
            if (this.isPaused) return;
            const duration = isHorizontal ? 8000 : (element.id === 'promotions-list' ? 4000 : 6000); 
            const target = isHorizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
            this.smoothScroll(element, target, duration, scrollBackward, isHorizontal);
        };
        const scrollBackward = () => {
            if (this.isPaused) return;
            setTimeout(() => {
                this.smoothScroll(element, 0, 2500, startCycle, isHorizontal);
            }, 5000);
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
            if (element.classList.contains('horizontal-scroll')) element.scrollLeft = 0;
            else element.scrollTop = 0;
            instance.start();
        }
    },
    pauseInstance(element) {
        const instance = this.instances.find(inst => inst.element === element);
        if (instance && instance.timeoutId) {
            clearTimeout(instance.timeoutId);
            instance.isScrolling = false;
        }
    },
    smoothScroll(el, to, duration, callback, isHorizontal = false) {
        const start = isHorizontal ? el.scrollLeft : el.scrollTop;
        const change = to - start;
        const startTime = performance.now();
        const animateScroll = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const newPosition = start + change * (progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress);
            if (isHorizontal) el.scrollLeft = newPosition;
            else el.scrollTop = newPosition;
            if (elapsed < duration) requestAnimationFrame(animateScroll);
            else callback && callback();
        };
        requestAnimationFrame(animateScroll);
    },
    pauseAll() {
        this.isPaused = true;
        this.instances.forEach(inst => clearTimeout(inst.timeoutId));
    },
    resumeAll() {
        this.isPaused = false;
        this.instances.forEach(inst => { if (inst.isScrolling) inst.start(); });
    }
};

// --- API e Anúncios ---
async function fetchGlobalConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/duration`);
        if (response.ok) {
            const config = await response.json();
            if (config?.value) globalImageDuration = parseInt(config.value, 10);
        }
    } catch (e) { console.error(e); }
}

async function fetchIntervalConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/interval`);
        if (response.ok) {
            const config = await response.json();
            if (config?.value) queueDisplayInterval = parseInt(config.value, 10);
        }
    } catch (e) { console.error(e); }
}

async function fetchAds() {
    try {
        const response = await fetch(`${API_BASE_URL}/media`);
        if (!response.ok) throw new Error('Erro API Media');
        const mediaItems = await response.json();
        ads = mediaItems
            .filter(item => item.status === 'ativo')
            .map(item => ({ ...item, type: item.type === 'Imagem' ? 'image' : 'video' }))
            .sort((a, b) => (a.order || 99) - (b.order || 99));
    } catch (e) { ads = []; }
}

function startAdCycle() {
    if (adCycleTimeout) clearTimeout(adCycleTimeout);
    adCycleTimeout = setTimeout(showNextAd, queueDisplayInterval);
}

function showNextAd() {
    if (ads.length === 0) {
        adCycleTimeout = setTimeout(startAdCycle, 30000);
        return;
    }
    const ad = ads[currentAdIndex];
    currentAdIndex = (currentAdIndex + 1) % ads.length;
    ScrollManager.pauseAll();
    queueContainer.classList.add('hidden');
    adContainer.innerHTML = '';
    adContainer.classList.remove('hidden');
    if (ad.type === 'video') {
        const video = document.createElement('video');
        video.src = ad.url;
        video.autoplay = true;
        video.muted = false;
        video.playsInline = true;
        video.onended = hideAdAndResume;
        adContainer.appendChild(video);
        video.play().catch(console.error);
    } else {
        const img = document.createElement('img');
        img.src = ad.url;
        adContainer.appendChild(img);
        const displayTime = (ad.duration || globalImageDuration) * 1000;
        adCycleTimeout = setTimeout(hideAdAndResume, displayTime);
    }
}

function hideAdAndResume() {
    adContainer.classList.add('hidden');
    queueContainer.classList.remove('hidden');
    ScrollManager.resumeAll();
    startAdCycle();
}

let isFirstRender = true;
document.addEventListener('DOMContentLoaded', () => {
    waitForFirebaseAuth();
    const originalRender = renderDisplay;
    renderDisplay = (...args) => {
        originalRender.apply(this, args);
        if (isFirstRender) {
            const ongoing = document.getElementById('ongoing-services-cards');
            if (ongoing) {
                // Adiciona a classe para que o ScrollManager saiba que este contêiner rola na horizontal.
                ongoing.classList.add('horizontal-scroll');
                ScrollManager.init(ongoing);
            }
            ScrollManager.init(document.getElementById('promotions-list'));
            const completed = document.getElementById('completed-services-cards');
            if (completed) ScrollManager.init(completed);
            isFirstRender = false;
        }
    };
});