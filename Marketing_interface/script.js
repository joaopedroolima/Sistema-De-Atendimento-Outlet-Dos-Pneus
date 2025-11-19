// --- Imports do Firebase (NOVO) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, writeBatch, query, orderBy, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- Configuração do Firebase (NOVO) ---
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

// --- Configuração da API (Cloudflare Worker) ---
// IMPORTANTE: Substitua pela URL do seu Worker!
const API_BASE_URL = 'https://marketing-api.lucasscosilva.workers.dev';

// --- Constantes (NOVO) ---
const APP_ID = 'local-autocenter-app';
const PROMOTIONS_COLLECTION_PATH = `/artifacts/${APP_ID}/public/data/promotions`;

// --- Elementos da UI (Mídia) ---
const form = document.getElementById('marketing-form');
const fileInput = document.getElementById('file-upload');
const titleInput = document.getElementById('media-title');
const uploadMessage = document.getElementById('upload-message');
const mediaList = document.getElementById('media-list');
const emptyMessage = document.getElementById('media-list-empty-message');
const dropArea = document.getElementById('drop-area'); // Pode ser nulo se o HTML mudar
const fileNameDisplay = document.getElementById('file-name-display');
const storageInfoDisplay = document.getElementById('storage-info-display');
const progressBarContainer = document.getElementById('progress-bar-container');
const configForm = document.getElementById('config-form');
const globalDurationInput = document.getElementById('global-duration');
const intervalDurationInput = document.getElementById('interval-duration');
const configMessage = document.getElementById('config-message');
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
let currentEditingMediaId = null; // Armazena o ID da mídia sendo editada

// --- Elementos da UI (Promoções - NOVO) ---
const promotionForm = document.getElementById('promotion-form');
const promotionFormTitle = document.getElementById('promotion-form-title');
const promoIdInput = document.getElementById('promotion-id');
const promoTitleInput = document.getElementById('promo-title');
const promoDescInput = document.getElementById('promo-description');
const promoOfferInput = document.getElementById('promo-offer');
const promoValidityInput = document.getElementById('promo-validity');
const promoIconValueInput = document.getElementById('promo-icon-value'); // NOVO: Input hidden para o valor
const promoIconSelectorBtn = document.getElementById('promo-icon-selector-btn'); // NOVO: Botão do seletor
const promoIconOptions = document.getElementById('promo-icon-options'); // NOVO: Lista de opções
const promoIconSelectedDisplay = document.getElementById('promo-icon-selected-display'); // NOVO: Display do item selecionado
const promoCancelBtn = document.getElementById('promo-cancel-edit-btn');
const promoFormMessage = document.getElementById('promo-form-message');
const promotionsList = document.getElementById('promotions-list');
const promoEmptyMessage = document.getElementById('promo-list-empty-message');

// --- Elementos da UI (Modal de Edição de Promoção - NOVO) ---
const promoEditModal = document.getElementById('promo-edit-modal');
const promoEditForm = document.getElementById('promo-edit-form');
const promoEditTitleInput = document.getElementById('promo-edit-title');
const promoEditDescInput = document.getElementById('promo-edit-description');
const promoEditOfferInput = document.getElementById('promo-edit-offer');
const promoEditValidityInput = document.getElementById('promo-edit-validity');
const promoEditIconInput = document.getElementById('promo-edit-icon');
let currentEditingPromoId = null;

// --- Elementos da UI (Abas - NOVO) ---
const tabs = { media: document.getElementById('tab-media'), promotions: document.getElementById('tab-promotions') };
const tabContents = { media: document.getElementById('tab-content-media'), promotions: document.getElementById('tab-content-promotions') };

/**
 * Exibe uma mensagem para o usuário e a limpa após um tempo.
 * @param {string} text - O texto da mensagem.
 * @param {boolean} isError - Se a mensagem é de erro.
 */
function showUserMessage(text, isError = false) {
    uploadMessage.textContent = text;
    uploadMessage.className = `mt-3 text-center text-sm font-medium ${isError ? 'text-red-600' : 'text-green-600'}`;
    setTimeout(() => {
        uploadMessage.textContent = '';
    }, 5000);
}

/**
 * NOVO: Exibe uma mensagem no card de configuração.
 * @param {string} text - O texto da mensagem.
 * @param {boolean} isError - Se a mensagem é de erro.
 */
function showConfigMessage(text, isError = false) {
    configMessage.textContent = text;
    configMessage.className = `mt-2 text-center text-sm font-medium ${isError ? 'text-red-600' : 'text-green-600'}`;
    setTimeout(() => {
        configMessage.textContent = '';
    }, 4000);
}

/**
 * NOVO: Exibe uma mensagem no formulário de promoções.
 * @param {string} text - O texto da mensagem.
 * @param {boolean} isError - Se a mensagem é de erro.
 */
function showPromoMessage(text, isError = false) {
    promoFormMessage.textContent = text;
    promoFormMessage.className = `mt-3 text-center text-sm font-medium ${isError ? 'text-red-600' : 'text-green-600'}`;
    
    setTimeout(() => {
        promoFormMessage.textContent = '';
    }, 4000);
}

/**
 * Atualiza a UI para mostrar o nome do arquivo selecionado.
 * @param {File} file - O arquivo selecionado.
 */
function updateFileDisplay(file) {
    if (!fileNameDisplay || !file) {
        fileNameDisplay.textContent = '';
    } else if (file.length === 1) {
        fileNameDisplay.textContent = `Arquivo selecionado: ${file[0].name}`;
    } else {
        fileNameDisplay.textContent = `${file.length} arquivos selecionados.`;
    }
    uploadMessage.textContent = ''; // Limpa mensagens anteriores
}

/**
 * Lida com o envio do formulário para adicionar nova mídia.
 * @param {Event} e - O evento de submit.
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    const files = fileInput.files;
    const title = titleInput.value.trim();

    if (files.length === 0) {
        showUserMessage("Por favor, selecione um ou mais arquivos de mídia.", true);
        return;
    }

    const uploadPromises = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Para múltiplos arquivos, usamos o nome do arquivo como título.
        // Se apenas um arquivo for enviado, usamos o título do input.
        const fileTitle = files.length > 1 ? file.name.split('.').slice(0, -1).join('.') : title || file.name.split('.').slice(0, -1).join('.');

        // Criamos uma div para a barra de progresso de cada arquivo
        const progressElement = document.createElement('div');
        progressBarContainer.appendChild(progressElement);

        uploadPromises.push(uploadFileWithProgress(file, fileTitle, progressElement, i + 1, files.length));
    }

    await Promise.all(uploadPromises);

    showUserMessage("Todos os uploads foram concluídos com sucesso!");
    form.reset();
    updateFileDisplay(null);
    loadInitialMedia();
    updateStorageInfo();
    
    // Limpa as barras de progresso após um tempo
    setTimeout(() => {
        progressBarContainer.innerHTML = '';
    }, 5000);
}

/**
 * Faz o upload de um único arquivo com uma barra de progresso.
 * @param {File} file - O arquivo para upload.
 * @param {string} title - O título da mídia.
 * @param {HTMLElement} progressElement - O elemento que conterá a barra de progresso.
 * @param {number} fileNumber - O número do arquivo atual (ex: 1).
 * @param {number} totalFiles - O número total de arquivos.
 */
function uploadFileWithProgress(file, title, progressElement, fileNumber, totalFiles) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();

        formData.append('file', file);
        formData.append('title', title);
        formData.append('contentType', file.type);

        xhr.open('POST', `${API_BASE_URL}/media`, true);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentage = Math.round((event.loaded / event.total) * 100);
                progressElement.innerHTML = `
                    <p class="text-sm text-gray-600">Enviando ${fileNumber}/${totalFiles}: "${file.name}"</p>
                    <div class="w-full bg-gray-200 rounded-full h-2.5 mt-1">
                        <div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div>
                    </div>`;
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                progressElement.innerHTML = `<p class="text-sm text-green-600">✓ Enviado: "${file.name}"</p>`;
                resolve(xhr.response);
            } else {
                progressElement.innerHTML = `<p class="text-sm text-red-600">✗ Erro no envio: "${file.name}"</p>`;
                reject(new Error(xhr.statusText));
            }
        };

        xhr.onerror = () => {
            progressElement.innerHTML = `<p class="text-sm text-red-600">✗ Erro de rede ao enviar: "${file.name}"</p>`;
            reject(new Error("Erro de rede"));
        };

        xhr.send(formData);
    });
}
/**
 * Renderiza a lista de mídias na tela.
 * @param {Array} mediaItems - Array de documentos de mídia do Firestore.
 */
function renderMediaList(mediaItems) {
    if (!mediaItems || mediaItems.length === 0) {
        mediaList.innerHTML = '';
        emptyMessage.classList.remove('hidden');
        return;
    }

    emptyMessage.classList.add('hidden');
    mediaList.innerHTML = mediaItems.map((item, index) => {
        const { id, title, type, url, status, duration } = item;

        const isImage = type === 'Imagem';
        const thumbnailHTML = isImage
            ? `<img src="${url}" alt="Thumbnail" class="w-full h-full object-cover rounded-md">`
            : `<div class="w-full h-full bg-gray-800 text-white rounded-md flex items-center justify-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                 </svg>
               </div>`;

        // REFORMULADO: Lógica de duração separada para vídeos e imagens.
        // A duração do vídeo será adicionada dinamicamente após a renderização.
        let durationHTML = '';
        if (type === 'Imagem') {
            durationHTML = `<p class="text-xs text-gray-500 mt-1">Duração: ${duration ? `${duration}s` : 'Padrão do sistema'}</p>`;
        }

        return `
            <li class="p-4 flex justify-between items-center hover:bg-gray-50 cursor-grab" data-id="${id}" data-url="${url}" data-title="${title}" data-duration="${duration || ''}" data-type="${type}">
                <div class="flex items-center flex-grow">
                    <div class="w-24 h-16 bg-gray-200 rounded-md flex items-center justify-center mr-4">${thumbnailHTML}</div>
                    <div>
                        <p class="text-sm font-medium text-gray-900 media-title-text">${title}</p> 
                        <p class="text-sm text-gray-500">${type} - ${status}</p>${durationHTML}
                    </div>
                </div>
                <div class="flex items-center space-x-3">
                    <span class="text-sm font-bold text-gray-400">#${index + 1}</span>
                    <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" name="toggle" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" ${status === 'ativo' ? 'checked' : ''}/>
                        <label class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                    </div>
                    <button title="Editar" class="edit-btn p-2 text-blue-500 hover:bg-blue-100 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.536L16.732 3.732z" /></svg></button>
                    <button title="Excluir" class="p-2 text-red-500 hover:bg-red-100 rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </li>
        `;
    }).join('');
}

/**
 * NOVO: Percorre a lista de mídias renderizada e atualiza a duração dos vídeos.
 * Isso é feito após a renderização inicial, pois requer a criação de elementos de vídeo
 * para ler seus metadados (duração).
 */
function updateVideoDurations() {
    const mediaItems = mediaList.querySelectorAll('li[data-type="Vídeo"]');

    mediaItems.forEach(item => {
        const videoUrl = item.dataset.url;
        if (!videoUrl) return;

        // Cria um elemento de vídeo temporário para carregar os metadados
        const video = document.createElement('video');
        video.preload = 'metadata'; // Otimização: só precisamos dos metadados

        // Quando os metadados (incluindo a duração) estiverem prontos...
        video.onloadedmetadata = () => {
            const duration = video.duration;
            const minutes = Math.floor(duration / 60);
            const seconds = Math.round(duration % 60);
            const formattedDuration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            // Encontra o local para inserir a duração e a adiciona
            const infoContainer = item.querySelector('.text-sm.text-gray-500');
            infoContainer.insertAdjacentHTML('afterend', `<p class="text-xs text-gray-500 mt-1">Duração: ${formattedDuration}</p>`);
        };

        video.src = videoUrl; // Define a fonte, o que dispara o carregamento
    });
}
/**
 * NOVO: Lógica de gerenciamento de promoções
 */

const PROMO_ICONS = {
    'fa-solid fa-tag': 'Padrão (Tag)',
    'fa-solid fa-car-battery': 'Bateria',
    'fa-solid fa-oil-can': 'Troca de Óleo',
    'fa-solid fa-ruler-combined': 'Alinhamento',
    'fa-solid fa-truck-monster': 'Pneu Off-Road',
    'fa-solid fa-car-burst': 'Suspensão',
    'fa-solid fa-gears': 'Câmbio / Motor',
    'fa-solid fa-fan': 'Ar Condicionado',
    'fa-solid fa-car-on': 'Elétrica',
    'fa-solid fa-lightbulb': 'Faróis',
    'fa-solid fa-percent': 'Desconto (%)',
    'fa-solid fa-gift': 'Brinde',
    'fa-solid fa-screwdriver-wrench': 'Revisão'
};

/**
 * NOVO: Popula o dropdown de ícones personalizado.
 */
function populateIconSelector() {
    promoIconOptions.innerHTML = Object.entries(PROMO_ICONS).map(([className, name]) => `
        <li class="text-gray-900 relative cursor-default select-none py-2 pl-3 pr-9 hover:bg-blue-600 hover:text-white" data-value="${className}">
            <div class="flex items-center">
                <i class="${className} w-5 h-5 text-center mr-3"></i>
                <span class="font-normal block truncate">${name}</span>
            </div>
        </li>
    `).join('');

    // Define o valor padrão
    const firstIconClass = Object.keys(PROMO_ICONS)[0];
    const firstIconName = Object.values(PROMO_ICONS)[0];
    promoIconValueInput.value = firstIconClass;
    promoIconSelectedDisplay.innerHTML = `<i class="${firstIconClass} w-5 h-5 text-center mr-3 text-blue-600"></i> ${firstIconName}`;

    // NOVO: Popula também o seletor do modal de edição
    promoEditIconInput.innerHTML = Object.entries(PROMO_ICONS).map(([className, name]) => 
        `<option value="${className}">${name}</option>`
    ).join('');
}

/**
 * NOVO: Configura os eventos para o dropdown de ícones.
 */
function setupIconSelector() {
    promoIconSelectorBtn.addEventListener('click', () => {
        promoIconOptions.classList.toggle('hidden');
    });

    promoIconOptions.addEventListener('click', (e) => {
        const selectedLi = e.target.closest('li');
        if (!selectedLi) return;
        promoIconValueInput.value = selectedLi.dataset.value;
        promoIconSelectedDisplay.innerHTML = selectedLi.querySelector('div').innerHTML;
        promoIconOptions.classList.add('hidden');
    });
}

function renderPromotionsList(promos) {
    if (!promos || promos.length === 0) {
        promotionsList.innerHTML = '';
        promoEmptyMessage.classList.remove('hidden');
        return;
    }

    promoEmptyMessage.classList.add('hidden');
    promotionsList.innerHTML = promos.map(promo => {
        let formattedDate = 'Sem validade';
        if (promo.validity) {
            try {
                const [year, month, day] = promo.validity.split('-');
                formattedDate = `Válido até ${day}/${month}/${year}`;
            } catch (e) { formattedDate = 'Data inválida'; }
        }

        return `
            <li class="p-4 flex justify-between items-center hover:bg-gray-50 cursor-grab" data-id="${promo.id}">
                <div class="flex items-center flex-grow">
                    <div class="w-16 h-16 bg-gray-100 rounded-md flex items-center justify-center mr-4 text-blue-600 text-3xl">
                        <i class="${promo.icon || 'fa-solid fa-tag'}"></i>
                    </div>
                    <div class="flex-grow">
                        <p class="text-sm font-bold text-gray-900">${promo.title}</p>
                        <p class="text-sm text-gray-600">${promo.description}</p>
                        <p class="text-sm font-medium text-blue-600 mt-1">${promo.offer}</p>
                        <p class="text-xs text-gray-500 mt-1">${formattedDate}</p>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button title="Editar" class="promo-edit-btn p-2 text-blue-500 hover:bg-blue-100 rounded-full"><svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.536L16.732 3.732z" /></svg></button>
                    <button title="Excluir" class="promo-delete-btn p-2 text-red-500 hover:bg-red-100 rounded-full"><svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                </div>
            </li>
        `;
    }).join('');
}

async function handlePromotionSubmit(e) {
    e.preventDefault();
    // ATUALIZADO: O formulário principal agora SÓ cria novas promoções.
    // O bug de substituição é resolvido removendo a leitura do `promoIdInput`.
    const id = doc(collection(db, PROMOTIONS_COLLECTION_PATH)).id;
    
    const promoData = {
        title: promoTitleInput.value.trim(),
        description: promoDescInput.value.trim(),
        offer: promoOfferInput.value.trim(),
        validity: promoValidityInput.value,
        icon: promoIconValueInput.value // Usa o valor do input hidden
    };

    try {
        // Descobre a ordem para o novo item
        const q = query(collection(db, PROMOTIONS_COLLECTION_PATH));
        const querySnapshot = await getDocs(q);
        promoData.order = querySnapshot.size; // Adiciona no final da lista
        
        await setDoc(doc(db, PROMOTIONS_COLLECTION_PATH, id), promoData, { merge: true });
        showPromoMessage("Promoção salva com sucesso!", false);
        resetPromotionForm();
    } catch (error) {
        console.error("Erro ao salvar promoção:", error);
        showPromoMessage("Erro ao salvar promoção.", true);
    }
}

function resetPromotionForm() {
    promotionForm.reset();
    // ATUALIZADO: A lógica de "cancelar edição" foi removida deste formulário.
    // Ele agora apenas se reseta após uma criação bem-sucedida.
    const firstIconClass = Object.keys(PROMO_ICONS)[0];
    promoIconValueInput.value = firstIconClass;
    promoIconSelectedDisplay.innerHTML = `<i class="${firstIconClass} w-5 h-5 text-center mr-3 text-blue-600"></i> ${Object.values(PROMO_ICONS)[0]}`;
}

async function handlePromotionsListClick(e) {
    const target = e.target;
    const listItem = target.closest('li');
    if (!listItem) return;

    const promoId = listItem.dataset.id;
    const promoDocRef = doc(db, PROMOTIONS_COLLECTION_PATH, promoId);

    if (target.closest('.promo-delete-btn')) {
        if (confirm("Tem certeza que deseja excluir esta promoção?")) {
            try {
                await deleteDoc(promoDocRef);
                showPromoMessage("Promoção excluída com sucesso.");
                // A lista será atualizada pelo listener onSnapshot
            } catch (error) {
                console.error("Erro ao excluir promoção:", error);
                showPromoMessage("Erro ao excluir promoção.", true);
            }
        }
    }

    // ATUALIZADO: Lógica de edição agora abre o MODAL
    if (target.closest('.promo-edit-btn')) {
        currentEditingPromoId = promoId;

        // Busca os dados do Firebase para preencher o modal
        const promoData = (await getDoc(promoDocRef)).data();
        
        promoEditTitleInput.value = promoData.title || '';
        promoEditDescInput.value = promoData.description || '';
        promoEditOfferInput.value = promoData.offer || '';
        promoEditValidityInput.value = promoData.validity || '';
        promoEditIconInput.value = promoData.icon || '';

        promoEditModal.classList.remove('hidden'); // Mostra o modal
    }
}

function initPromotionsSortable() {
    new Sortable(promotionsList, {
        animation: 150,
        ghostClass: 'bg-blue-100',
        onEnd: async (evt) => {
            const items = Array.from(promotionsList.querySelectorAll('li'));
            const batch = writeBatch(db);

            items.forEach((item, index) => {
                const promoId = item.dataset.id;
                const docRef = doc(db, PROMOTIONS_COLLECTION_PATH, promoId);
                batch.update(docRef, { order: index });
            });

            try {
                await batch.commit();
            } catch (error) {
                console.error("Erro ao reordenar promoções:", error);
            }
        },
    });
}

/**
 * Lida com cliques na lista de mídia para exclusão ou atualização de status.
 * @param {Event} e - O evento de clique.
 */
async function handleMediaListClick(e) {
    const target = e.target;
    const listItem = target.closest('li');
    if (!listItem) return;

    const mediaId = listItem.dataset.id; // ID do documento no Firestore

    // --- Lógica para o botão de excluir ---
    if (target.closest('button[title="Excluir"]')) {
        if (confirm("Tem certeza que deseja excluir esta mídia? Esta ação não pode ser desfeita.")) {
            // A URL do arquivo está armazenada no atributo 'data-url' do item da lista.
            const fileUrl = listItem.dataset.url;

            try {
                const response = await fetch(`${API_BASE_URL}/media/${mediaId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: fileUrl }) // Envia a URL para a API
                });
                if (!response.ok) {
                    throw new Error('Falha ao excluir');
                }
                showUserMessage("Mídia excluída com sucesso.");
                loadInitialMedia(); // Recarrega a lista
                updateStorageInfo(); // Atualiza o uso de espaço
            } catch (error) {
                console.error("Erro ao excluir mídia:", error);
                showUserMessage("Erro ao excluir a mídia.", true);
            }
        }
    }

    // --- Lógica para o switch de status ---
    const isToggleClick = target.classList.contains('toggle-checkbox') || target.classList.contains('toggle-label');
    if (isToggleClick) {
        const checkbox = listItem.querySelector('.toggle-checkbox');
        // O evento de clique no label já altera o 'checked' do input, então o estado já está "novo"
        const newStatus = checkbox.checked ? 'ativo' : 'inativo';
        try {
            await fetch(`${API_BASE_URL}/media/${mediaId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            // Atualiza a UI diretamente sem recarregar a lista inteira
            const statusElement = listItem.querySelector('.text-sm.text-gray-500');
            const type = statusElement.textContent.split(' - ')[0]; // Mantém o tipo de mídia
            statusElement.textContent = `${type} - ${newStatus}`;
            showUserMessage(`Status atualizado para '${newStatus}'.`);
        } catch (error) {
            console.error("Erro ao atualizar status:", error);
            showUserMessage("Erro ao atualizar o status.", true);
            checkbox.checked = !checkbox.checked; // Reverte a mudança visual em caso de erro
        }
    }

    // --- Lógica para o botão de editar (título e duração) ---
    if (target.closest('.edit-btn')) {
        currentEditingMediaId = mediaId;
        const currentTitle = listItem.dataset.title;
        const mediaType = listItem.dataset.type; // NOVO: Pega o tipo de mídia
        const currentDuration = listItem.dataset.duration;
        
        const durationContainer = document.getElementById('edit-duration-container');

        document.getElementById('edit-media-title').value = currentTitle;
        document.getElementById('edit-media-duration').value = currentDuration;

        // ATUALIZADO: Mostra ou esconde o campo de duração baseado no tipo
        if (mediaType === 'Vídeo') {
            durationContainer.classList.add('hidden');
        } else {
            durationContainer.classList.remove('hidden');
        }

        editModal.classList.remove('hidden'); // Mostra o modal
    }
}

/**
 * Inicializa a funcionalidade de arrastar e soltar para reordenar a lista.
 */
function initSortable() {
    new Sortable(mediaList, {
        animation: 150,
        ghostClass: 'bg-blue-100',
        filter: 'button, .toggle-checkbox, .toggle-label', // Ignora cliques em botões e no switch
        onEnd: async (evt) => {
            const items = Array.from(mediaList.querySelectorAll('li'));
            const orderedIds = items.map(item => item.dataset.id);

            try {
                const response = await fetch(`${API_BASE_URL}/media/reorder`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderedIds: orderedIds })
                });

                if (!response.ok) {
                    throw new Error('Falha ao reordenar');
                }
                loadInitialMedia(); // Recarrega para atualizar os números de posição
            } catch (error) {
                console.error("Erro ao reordenar mídias:", error);
                showUserMessage("Ocorreu um erro ao salvar a nova ordem.", true);
            }
        },
    });
}

/**
 * NOVO: Função genérica para atualizar mídia.
 * @param {string} mediaId - O ID da mídia.
 * @param {object} data - O objeto com os dados a serem atualizados.
 */
async function updateMedia(mediaId, data) {
    try {
        const response = await fetch(`${API_BASE_URL}/media/${mediaId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('A resposta da API não foi OK');
    } catch (error) {
        console.error(`Erro ao atualizar mídia ${mediaId}:`, error);
        throw error; // Propaga o erro para ser tratado pela função que chamou
    }
}

// --- Listeners de Mídia ---
form.addEventListener('submit', handleFormSubmit);
fileInput.addEventListener('change', () => {
    updateFileDisplay(fileInput.files.length > 0 ? fileInput.files : null);
});

// Listeners para feedback visual do Drag and Drop
['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.add('border-blue-500', 'bg-blue-50'), false);
});

['dragleave', 'drop', 'change'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.remove('border-blue-500', 'bg-blue-50'), false);
});

mediaList.addEventListener('click', handleMediaListClick);

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditingMediaId) return;

    const newTitle = document.getElementById('edit-media-title').value.trim();
    const newDuration = document.getElementById('edit-media-duration').value;

    let durationValue = null;
    // ATUALIZADO: Só processa a duração se o campo estiver visível
    const durationContainer = document.getElementById('edit-duration-container');
    if (!durationContainer.classList.contains('hidden')) {
        durationValue = newDuration.trim() === '' ? null : parseInt(newDuration, 10);

        // Valida a duração apenas se ela foi inserida
        if (newDuration.trim() !== '' && (isNaN(durationValue) || durationValue <= 0)) {
            showUserMessage("Por favor, insira um número válido maior que zero para a duração.", true);
            return;
        }
    }
    
    const dataToUpdate = {
        title: newTitle || "Sem título",
        duration: durationValue
    };

    try {
        await updateMedia(currentEditingMediaId, dataToUpdate);
        showUserMessage("Mídia atualizada com sucesso.");
        loadInitialMedia(); // Recarrega para refletir a mudança
    } catch (error) {
        showUserMessage("Erro ao atualizar a mídia.", true);
    } finally {
        editModal.classList.add('hidden');
        currentEditingMediaId = null;
        editForm.reset();
    }
});

configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const globalDuration = globalDurationInput.value.trim();
    const intervalDuration = intervalDurationInput.value.trim();

    // Validação dos inputs: só valida se o campo foi de fato preenchido
    if (globalDuration && (isNaN(parseInt(globalDuration, 10)) || parseInt(globalDuration, 10) <= 0)) {
        showConfigMessage("Duração Global: Por favor, insira um número válido maior que zero.", true);
        return;
    }
    if (intervalDuration && (isNaN(parseInt(intervalDuration, 10)) || parseInt(intervalDuration, 10) <= 0)) {
        showConfigMessage("Intervalo: Por favor, insira um número válido maior que zero.", true);
        return;
    }

    const promises = [];
    let success = true;

    // Se nenhum campo foi preenchido, informa o usuário e não faz nada
    if (!globalDuration && !intervalDuration) {
        showConfigMessage("Nenhum valor para salvar.", true);
        return;
    }

    // Mostra uma mensagem de "Salvando..."
    showConfigMessage("Salvando configurações...", false);

    // Adiciona a promise para salvar a Duração Global, se o campo foi preenchido
    if (globalDuration) {
        const durationPromise = fetch(`${API_BASE_URL}/config/value`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: globalDuration })
        })
        .then(response => { if (!response.ok) success = false; }).catch(() => { success = false; });
        promises.push(durationPromise);
    }

    // Adiciona a promise para salvar o Intervalo, se o campo foi preenchido
    if (intervalDuration) {
        // Converte minutos para milissegundos
        const intervalInMs = parseInt(intervalDuration, 10) * 60 * 1000;

        const intervalPromise = fetch(`${API_BASE_URL}/config/interval`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: intervalInMs.toString() })
        })
        .then(response => { if (!response.ok) success = false; }).catch(() => { success = false; });
        promises.push(intervalPromise);
    }

    // Espera todas as operações terminarem
    await Promise.all(promises);

    // Mostra a mensagem final de sucesso ou erro
    if (success) {
        showConfigMessage("Configurações salvas com sucesso!");
    } else {
        showConfigMessage("Ocorreu um erro ao salvar uma ou mais configurações. Tente novamente.", true);
    }
});

/**
 * NOVO: Carrega a configuração de duração global da API.
 */
async function loadGlobalDuration() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/value`);
        if (response.ok) {
            const config = await response.json();
            if (config && config.value) {
                globalDurationInput.value = config.value;
            }
        }
        // Se a resposta não for ok (ex: 404), simplesmente não preenche o campo.
    } catch (error) {
        console.error("Erro ao carregar a configuração de duração global:", error);
    }
}

/**
 * NOVO: Carrega a configuração de intervalo da API.
 */
async function loadIntervalDuration() {
    try {
        const response = await fetch(`${API_BASE_URL}/config/interval`);
        if (response.ok) {
            const config = await response.json();
            if (config && config.value) {
                // Converte de milissegundos para minutos para exibir no input
                const intervalInMinutes = parseInt(config.value, 10) / 60000;
                intervalDurationInput.value = intervalInMinutes;
            }
        }
        // Se a resposta não for ok, simplesmente não preenche o campo.
    } catch (error) {
        console.error("Erro ao carregar a configuração de intervalo:", error);
    }
}

/**
 * Busca as informações de armazenamento da API e atualiza a UI.
 */
async function updateStorageInfo() {
    if (!storageInfoDisplay) return; // Se o elemento não existe, não faz nada.

    try {
        const response = await fetch(`${API_BASE_URL}/storage-info`); // RF009
        if (!response.ok) {
            storageInfoDisplay.innerHTML = `<p class="text-sm text-red-500">Erro ao buscar dados de uso.</p>`;
            return;
        }
        const data = await response.json();
        const usedBytes = data.usedBytes;

        // O plano gratuito do R2 oferece 10 GiB. 1 GiB = 1024*1024*1024 bytes.
        const totalBytes = 10 * 1024 * 1024 * 1024; 

        const usedGB = (usedBytes / (1024 * 1024 * 1024)).toFixed(2);
        const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(0);
        const percentage = Math.min((usedBytes / totalBytes) * 100, 100).toFixed(2);

        // Define a cor da barra de progresso com base no uso
        let progressBarColor = 'bg-blue-600'; // Normal
        if (percentage > 90) {
            progressBarColor = 'bg-red-600'; // Crítico
        } else if (percentage > 75) {
            progressBarColor = 'bg-yellow-500'; // Atenção
        }

        storageInfoDisplay.innerHTML = `
            <div class="flex justify-between mb-1">
                <span class="text-sm font-medium text-gray-700">${usedGB} GB de ${totalGB} GB utilizados</span>
                <span class="text-sm font-medium text-gray-700">${percentage}%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2.5">
                <div class="${progressBarColor} h-2.5 rounded-full" style="width: ${percentage}%"></div>
            </div>
        `;

    } catch (error) {
        console.error("Erro ao buscar informações de armazenamento:", error);
        storageInfoDisplay.innerHTML = `<p class="text-sm text-red-500">Não foi possível carregar os dados de uso.</p>`;
    }
}


/**
 * Carrega a lista de mídias da nossa API e renderiza na tela.
 */
async function loadInitialMedia() {
    try {
        const response = await fetch(`${API_BASE_URL}/media`);
        if (!response.ok) {
            throw new Error('Não foi possível carregar a lista de mídias.');
        }
        const mediaItems = await response.json(); // RF003
        renderMediaList(mediaItems);
        updateVideoDurations(); // NOVO: Chama a função para atualizar as durações dos vídeos
        if (mediaItems.length > 0) {
            initSortable();
        }
    } catch (error) {
        console.error("Erro ao buscar mídias:", error);
        showUserMessage(error.message, true);
    }
}

/**
 * NOVO: Gerencia a troca de abas
 */
function setupTabs() {
    Object.values(tabs).forEach(tab => {
        tab.addEventListener('click', () => {
            // Desativa todas as abas e conteúdos
            Object.values(tabs).forEach(t => t.classList.remove('border-blue-500', 'text-blue-600'));
            Object.values(tabs).forEach(t => t.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300'));
            Object.values(tabContents).forEach(c => c.classList.add('hidden'));

            // Ativa a aba clicada e seu conteúdo
            tab.classList.add('border-blue-500', 'text-blue-600');
            tab.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
            const contentId = tab.id.replace('tab-', 'tab-content-');
            document.getElementById(contentId).classList.remove('hidden');
        });
    });
}

/**
 * NOVO: Inicialização do sistema
 */
function initializeSystem() {
    // Carregamento da aba de Mídia
    loadInitialMedia();
    loadGlobalDuration();
    loadIntervalDuration();
    updateStorageInfo();

    // Carregamento da aba de Promoções
    populateIconSelector();
    setupIconSelector(); // NOVO: Configura os eventos do seletor
    promotionForm.addEventListener('submit', handlePromotionSubmit);
    promotionsList.addEventListener('click', handlePromotionsListClick);
    promoCancelBtn.addEventListener('click', resetPromotionForm);

    // NOVO: Listeners para o modal de edição de promoção
    promoEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentEditingPromoId) return;

        const promoData = {
            title: promoEditTitleInput.value.trim(),
            description: promoEditDescInput.value.trim(),
            offer: promoEditOfferInput.value.trim(),
            validity: promoEditValidityInput.value,
            icon: promoEditIconInput.value
        };

        try {
            const docRef = doc(db, PROMOTIONS_COLLECTION_PATH, currentEditingPromoId);
            await setDoc(docRef, promoData, { merge: true }); // Usa merge para não sobrescrever o campo 'order'
            showPromoMessage("Promoção atualizada com sucesso!");
        } catch (error) {
            console.error("Erro ao atualizar promoção:", error);
            showPromoMessage("Erro ao atualizar promoção.", true);
        } finally {
            promoEditModal.classList.add('hidden');
            currentEditingPromoId = null;
        }
    });

    document.getElementById('promo-edit-cancel-btn').addEventListener('click', () => {
        promoEditModal.classList.add('hidden');
        currentEditingPromoId = null;
    });
    
    // Listener em tempo real para promoções
    const q = query(collection(db, PROMOTIONS_COLLECTION_PATH), orderBy("order"));
    onSnapshot(q, (snapshot) => {
        const promos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPromotionsList(promos);
        initPromotionsSortable();
    });

    // Configuração das abas
    setupTabs();
}

// --- Ponto de Entrada ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        initializeSystem();
    } else {
        signInAnonymously(auth).catch(error => console.error("Falha no login anônimo:", error));
    }
});