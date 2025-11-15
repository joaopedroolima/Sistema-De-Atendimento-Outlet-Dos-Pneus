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
const dropArea = document.getElementById('drop-area');
const fileNameDisplay = document.getElementById('file-name-display');
const storageInfoDisplay = document.getElementById('storage-info-display');

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
 * Atualiza a UI para mostrar o nome do arquivo selecionado.
 * @param {File} file - O arquivo selecionado.
 */
function updateFileDisplay(file) {
    fileNameDisplay.textContent = file ? `Arquivo selecionado: ${file.name}` : '';
    uploadMessage.textContent = ''; // Limpa mensagens anteriores
}

/**
 * Lida com o envio do formulário para adicionar nova mídia.
 * @param {Event} e - O evento de submit.
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    const file = fileInput.files[0];
    const title = titleInput.value.trim();

    if (!file) {
        showUserMessage("Por favor, selecione um arquivo de mídia.", true);
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);

    showUserMessage("Enviando...");

    try {
        const response = await fetch(`${API_BASE_URL}/media`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha no upload');
        }

        showUserMessage("Mídia adicionada com sucesso!");
        form.reset();
        updateFileDisplay(null);
        loadInitialMedia(); // Recarrega a lista
        updateStorageInfo(); // Atualiza o uso de espaço

    } catch (error) {
        console.error("Erro no upload:", error);
        showUserMessage(`Erro no upload: ${error.message}`, true);
    }
}

/**
 * Renderiza a lista de mídias na tela.
 * @param {Array} mediaItems - Array de documentos de mídia do Firestore.
 */
function renderMediaList(mediaItems) {
    if (mediaItems.length === 0) {
        mediaList.innerHTML = '';
        emptyMessage.classList.remove('hidden');
        return;
    }

    emptyMessage.classList.add('hidden');
    mediaList.innerHTML = mediaItems.map((item, index) => {
        const { id, title, type, url, status } = item;

        const isImage = type === 'Imagem';
        const thumbnailHTML = isImage
            ? `<img src="${url}" alt="Thumbnail" class="w-full h-full object-cover rounded-md">`
            : `<div class="w-full h-full bg-gray-800 text-white rounded-md flex items-center justify-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                 </svg>
               </div>`;

        return `
            <li class="p-4 flex justify-between items-center hover:bg-gray-50 cursor-grab" data-id="${id}">
                <div class="flex items-center">
                    <div class="w-24 h-16 bg-gray-200 rounded-md flex items-center justify-center mr-4">${thumbnailHTML}</div>
                    <div>
                        <p class="text-sm font-medium text-gray-900 media-title-text">${title}</p>
                        <p class="text-sm text-gray-500">${type}</p>
                    </div>
                </div>
                <div class="flex items-center space-x-3">
                    <span class="text-sm font-bold text-gray-400">#${index + 1}</span>
                    <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" name="toggle" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" ${status === 'ativo' ? 'checked' : ''}/>
                        <label class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                    </div>
                    <button title="Editar" class="p-2 text-blue-500 hover:bg-blue-100 rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.536L16.732 3.732z" /></svg>
                    </button>
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

    const mediaId = listItem.dataset.id;

    // --- Lógica para o botão de excluir ---
    if (target.closest('button[title="Excluir"]')) {
        if (confirm("Tem certeza que deseja excluir esta mídia? Esta ação não pode ser desfeita.")) {
            try {
                const response = await fetch(`${API_BASE_URL}/media/${mediaId}`, { method: 'DELETE' });
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
    if (target.classList.contains('toggle-checkbox')) {
        const newStatus = target.checked ? 'ativo' : 'inativo';
        try {
            await fetch(`${API_BASE_URL}/media/${mediaId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            showUserMessage(`Status atualizado para ${newStatus}.`);
        } catch (error) {
            console.error("Erro ao atualizar status:", error);
            showUserMessage("Erro ao atualizar o status.", true);
            target.checked = !target.checked; // Reverte a mudança visual em caso de erro
        }
    }

    // --- Lógica para o botão de editar ---
    if (target.closest('button[title="Editar"]')) {
        const titleElement = listItem.querySelector('.media-title-text');
        const currentTitle = titleElement.textContent;

        const newTitle = prompt("Digite o novo título para a mídia:", currentTitle);

        // Se o usuário não cancelar e o título for diferente
        if (newTitle !== null && newTitle.trim() !== currentTitle) {
            try {
                await fetch(`${API_BASE_URL}/media/${mediaId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle.trim() || "Sem título" })
                });
                showUserMessage("Título atualizado com sucesso.");
            } catch (error) {
                console.error("Erro ao atualizar título:", error);
                showUserMessage("Erro ao atualizar o título.", true);
            }
        }
    }
}

/**
 * Inicializa a funcionalidade de arrastar e soltar para reordenar a lista.
 */
function initSortable() {
    new Sortable(mediaList, {
        animation: 150,
        ghostClass: 'bg-blue-100',
        handle: '.cursor-grab',
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
            } catch (error) {
                console.error("Erro ao reordenar mídias:", error);
                showUserMessage("Ocorreu um erro ao salvar a nova ordem.", true);
            }
        },
    });
}
// --- Listeners ---
form.addEventListener('submit', handleFormSubmit);

// Listener para seleção de arquivo (funciona para clique e drag-and-drop)
fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        updateFileDisplay(fileInput.files[0]);
    }
});

// Listeners para feedback visual do Drag and Drop
['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.add('border-blue-500', 'bg-blue-50'), false);
});

['dragleave', 'drop', 'change'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.remove('border-blue-500', 'bg-blue-50'), false);
});

mediaList.addEventListener('click', handleMediaListClick);

/**
 * Busca as informações de armazenamento da API e atualiza a UI.
 */
async function updateStorageInfo() {
    try {
        const response = await fetch(`${API_BASE_URL}/storage-info`);
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
        const mediaItems = await response.json();
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
updateStorageInfo();