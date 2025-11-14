import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- Configuração do Firebase (copiada do sistema principal para modularidade) ---
const firebaseConfig = {
    apiKey: "AIzaSyDleQ5Y1-o7Uoo3zOXKIm35KljdxJuxvWo",
    authDomain: "banco-de-dados-outlet2-0.firebaseapp.com",
    projectId: "banco-de-dados-outlet2-0",
    storageBucket: "banco-de-dados-outlet2-0.firebasestorage.app",
    messagingSenderId: "917605669915",
    appId: "1:917605669915:web:6a9ee233227cfd250bacbe",
    measurementId: "G-5SZ5F2WKXD"
};

const app = initializeApp(firebaseConfig, "marketingApp"); // Nome exclusivo para evitar conflitos
const db = getFirestore(app);
const storage = getStorage(app);

const MEDIA_COLLECTION = 'marketing_media';
const MEDIA_STORAGE_PATH = 'marketing_media';

// --- Elementos da UI ---
const form = document.getElementById('marketing-form');
const fileInput = document.getElementById('file-upload');
const titleInput = document.getElementById('media-title');
const uploadMessage = document.getElementById('upload-message');
const mediaList = document.getElementById('media-list');
const emptyMessage = document.getElementById('media-list-empty-message');

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

    const fileName = `${Date.now()}-${file.name}`;
    const storageRef = ref(storage, `${MEDIA_STORAGE_PATH}/${fileName}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    // Listener para o progresso do upload
    uploadTask.on('state_changed',
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            showUserMessage(`Enviando... ${Math.round(progress)}%`);
        },
        (error) => {
            console.error("Erro no upload:", error);
            showUserMessage(`Erro no upload: ${error.message}`, true);
        },
        async () => {
            // Upload concluído com sucesso
            try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                
                // Salva os metadados no Firestore
                await addDoc(collection(db, MEDIA_COLLECTION), {
                    title: title || file.name,
                    fileName: file.name,
                    url: downloadURL,
                    type: file.type.startsWith('image/') ? 'Imagem' : 'Vídeo',
                    status: 'ativo', // Padrão
                    order: Date.now(), // Ordem inicial baseada no tempo
                    createdAt: serverTimestamp()
                });

                showUserMessage("Mídia adicionada com sucesso!");
                form.reset();

            } catch (error) {
                console.error("Erro ao salvar no Firestore:", error);
                showUserMessage("Erro ao salvar os dados da mídia.", true);
            }
        }
    );
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
            <li class="p-4 flex justify-between items-center hover:bg-gray-50" data-id="${id}">
                <div class="flex items-center">
                    <div class="w-24 h-16 bg-gray-200 rounded-md flex items-center justify-center mr-4">${thumbnailHTML}</div>
                    <div>
                        <p class="text-sm font-medium text-gray-900">${title}</p>
                        <p class="text-sm text-gray-500">${type}</p>
                    </div>
                </div>
                <div class="flex items-center space-x-3">
                    <span class="text-sm font-bold text-gray-400">#${index + 1}</span>
                    <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" name="toggle" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" ${status === 'ativo' ? 'checked' : ''}/>
                        <label class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                    </div>
                    <button title="Excluir" class="p-2 text-red-500 hover:bg-red-100 rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </li>
        `;
    }).join('');
}

// --- Listeners ---
form.addEventListener('submit', handleFormSubmit);

// Listener do Firestore para carregar e atualizar a lista de mídias em tempo real
const q = query(collection(db, MEDIA_COLLECTION), orderBy("order", "asc"));
onSnapshot(q, (querySnapshot) => {
    const mediaItems = [];
    querySnapshot.forEach((doc) => {
        mediaItems.push({ id: doc.id, ...doc.data() });
    });
    renderMediaList(mediaItems);
}, (error) => {
    console.error("Erro ao buscar mídias:", error);
    showUserMessage("Não foi possível carregar a lista de mídias.", true);
});