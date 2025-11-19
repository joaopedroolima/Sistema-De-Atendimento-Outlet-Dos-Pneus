// --- Configuração da API (Cloudflare Worker) ---
// IMPORTANTE: Substitua pela URL do seu Worker!
const API_BASE_URL = 'https://marketing-api.lucasscosilva.workers.dev';


// --- Elementos da UI ---
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
// NOVO: Elementos para configuração de duração
const configForm = document.getElementById('config-form');
const globalDurationInput = document.getElementById('global-duration');
const configMessage = document.getElementById('config-message');
// NOVO: Elementos do modal de duração
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
let currentEditingMediaId = null; // Armazena o ID da mídia sendo editada

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
 * NOVO: Obtém a duração de um arquivo de vídeo.
 * @param {File} file - O arquivo de vídeo.
 * @returns {Promise<number>} Uma promessa que resolve com a duração do vídeo em segundos.
 */
function getVideoDuration(file) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = function() {
            window.URL.revokeObjectURL(video.src);
            resolve(Math.round(video.duration));
        }
        video.onerror = function() {
            reject("Erro ao carregar metadados do vídeo.");
        };
        video.src = URL.createObjectURL(file);
    });
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

        // NOVO: Obtém a duração se for um vídeo
        let duration = null;
        if (file.type.startsWith('video/')) {
            try {
                duration = await getVideoDuration(file);
            } catch (error) {
                console.error("Não foi possível obter a duração do vídeo:", error);
            }
        }

        // Criamos uma div para a barra de progresso de cada arquivo
        const progressElement = document.createElement('div');
        progressBarContainer.appendChild(progressElement);

        uploadPromises.push(uploadFileWithProgress(file, fileTitle, duration, progressElement, i + 1, files.length));
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
 * @param {number|null} duration - A duração do vídeo, se aplicável.
 * @param {HTMLElement} progressElement - O elemento que conterá a barra de progresso.
 * @param {number} fileNumber - O número do arquivo atual (ex: 1).
 * @param {number} totalFiles - O número total de arquivos.
 */
function uploadFileWithProgress(file, title, duration, progressElement, fileNumber, totalFiles) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();

        formData.append('file', file);
        formData.append('title', title);
        formData.append('contentType', file.type);
        if (duration) formData.append('duration', duration); // NOVO: Adiciona a duração ao formulário

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
        let durationHTML = '';
        if (type === 'Vídeo') {
            // Para vídeos, a duração é inerente ao arquivo. Se existir, mostramos.
            // Não há fallback para "Padrão".
            durationHTML = `<p class="text-xs text-gray-500 mt-1">Duração: ${duration ? `${duration}s` : 'N/A'}</p>`;
        } else {
            // Para imagens e GIFs, a lógica original é mantida.
            durationHTML = `<p class="text-xs text-gray-500 mt-1">Duração: ${duration ? `${duration}s` : 'Padrão'}</p>`;
        }

        return `
            <li class="p-4 flex justify-between items-center hover:bg-gray-50 cursor-grab" data-id="${id}" data-url="${url}" data-title="${title}" data-duration="${duration || ''}">
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
        const currentDuration = listItem.dataset.duration;

        document.getElementById('edit-media-title').value = currentTitle;
        document.getElementById('edit-media-duration').value = currentDuration;
        editModal.classList.remove('hidden');
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

// --- Listeners ---
form.addEventListener('submit', handleFormSubmit);

// Listener para seleção de arquivo (funciona para clique e drag-and-drop)
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

// ATUALIZADO: Listener para o formulário do modal de edição
editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditingMediaId) return;

    const newTitle = document.getElementById('edit-media-title').value.trim();
    const newDuration = document.getElementById('edit-media-duration').value;

    const durationValue = newDuration.trim() === '' ? null : parseInt(newDuration, 10);

    if (newDuration.trim() !== '' && (isNaN(durationValue) || durationValue <= 0)) {
        showUserMessage("Por favor, insira um número válido maior que zero.", true);
        return;
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

// NOVO: Listener para o formulário de configuração global
configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const duration = globalDurationInput.value;

    if (duration && (isNaN(parseInt(duration, 10)) || parseInt(duration, 10) <= 0)) {
        showConfigMessage("Por favor, insira um número válido maior que zero.", true);
        return;
    }

    try {
        // CORREÇÃO: O endpoint deve especificar a chave que está sendo alterada ('duration').
        // CORREÇÃO 2: Voltando a usar o endpoint /config/value conforme especificado pelo usuário.
        // O corpo envia apenas o valor, conforme a lógica do backend.
        const response = await fetch(`${API_BASE_URL}/config/value`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: duration })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Falha ao salvar a configuração.' }));
            throw new Error(errorData.message || 'Falha ao salvar a configuração.');
        }

        const result = await response.json();
        showConfigMessage(result.message || "Tempo de exibição padrão salvo com sucesso!");
    } catch (error) {
        console.error("Erro ao salvar configuração:", error);
        showConfigMessage(error.message, true);
    }
});

/**
 * NOVO: Carrega a configuração de duração global da API.
 */
async function loadGlobalDuration() {
    try {
        // CORREÇÃO: Voltando a usar o endpoint /config/value para carregar a configuração.
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
        if (mediaItems.length > 0) {
            initSortable();
        }
    } catch (error) {
        console.error("Erro ao buscar mídias:", error);
        showUserMessage(error.message, true);
    }
}

// Carrega os dados iniciais quando a página é carregada.
loadInitialMedia();
loadGlobalDuration(); // NOVO
updateStorageInfo();