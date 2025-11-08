// assets/js/admin.js
import { state } from './appState.js';
import {
    db,
    collection,
    addDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    where,
    getDocs,
    USERS_COLLECTION_PATH
} from './firebaseConfig.js';
import { renderUserList, renderMechanicsManagement, renderSalespersonDropdowns } from './uiRender.js';
import { showDestructiveConfirmationModal } from './modals.js';

/**
 * Configura os listeners para a aba de administração.
 */
export function initAdminHandlers() {
    // Listener para o formulário de criação de usuário
    document.getElementById('create-user-form').addEventListener('submit', handleCreateUser);

    // Expor a função de confirmação de exclusão para o HTML
    window.showDeleteUserConfirmation = showDeleteUserConfirmation;

    // Listener em tempo real para a coleção de usuários
    setupUserListener();
}

/**
 * Cria um listener em tempo real para a coleção de usuários.
 */
function setupUserListener() {
    if (!db) return;
    const q = query(collection(db, ...USERS_COLLECTION_PATH));
    onSnapshot(q, (snapshot) => {
        // Otimização: Usar docChanges() para processar apenas as alterações.
        snapshot.docChanges().forEach((change) => {
            const user = { id: change.doc.id, ...change.doc.data() };
            const index = state.users.findIndex(u => u.id === user.id);

            if (change.type === "added") {
                if (index === -1) state.users.push(user);
            }
            if (change.type === "modified") {
                if (index !== -1) state.users[index] = user;
            }
            if (change.type === "removed") {
                if (index !== -1) state.users.splice(index, 1);
            }
        });

        // Sincroniza a lista de mecânicos no estado global
        state.MECHANICS = state.users.filter(u => u.role === 'mecanico').map(u => u.username);
        renderUserList(state.users);
        renderMechanicsManagement();
        renderSalespersonDropdowns();
    }, (error) => {
        console.error("Erro ao ouvir a coleção de usuários:", error);
    });
}

/**
 * Manipula o evento de submit do formulário de criação de usuário.
 */
async function handleCreateUser(e) {
    e.preventDefault();
    const feedbackEl = document.getElementById('user-feedback');
    feedbackEl.textContent = 'Criando...';

    const username = document.getElementById('newUserName').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;

    try {
        // Verifica se o usuário já existe
        const q = query(collection(db, ...USERS_COLLECTION_PATH), where("username", "==", username));
        const existingUser = await getDocs(q);
        if (!existingUser.empty) {
            feedbackEl.textContent = 'Erro: Nome de usuário já existe.';
            feedbackEl.className = 'mt-3 text-center text-sm font-medium text-red-600';
            return;
        }

        // Adiciona o novo usuário
        const newUser = { username, password, role };
        await addDoc(collection(db, ...USERS_COLLECTION_PATH), newUser);

        // Se for mecânico, atualiza o estado local imediatamente para agilidade da UI
        if (role === 'mecanico') state.MECHANICS.push(username);

        feedbackEl.textContent = '✅ Usuário criado com sucesso!';
        feedbackEl.className = 'mt-3 text-center text-sm font-medium text-green-600';
        document.getElementById('create-user-form').reset();

    } catch (error) {
        console.error("Erro ao criar usuário:", error);
        feedbackEl.textContent = 'Erro ao salvar no banco de dados.';
        feedbackEl.className = 'mt-3 text-center text-sm font-medium text-red-600';
    } finally {
        setTimeout(() => feedbackEl.textContent = '', 5000);
    }
}

/**
 * Deleta um usuário do Firestore.
 */
export async function deleteUser(userId) {
    if (!userId) return;
    try {
        const userToDelete = state.users.find(u => u.id === userId);
        await deleteDoc(doc(db, ...USERS_COLLECTION_PATH, userId));

        // Se for mecânico, remove do estado local imediatamente
        if (userToDelete && userToDelete.role === 'mecanico') {
            state.MECHANICS = state.MECHANICS.filter(m => m !== userToDelete.username);
        }

        console.log(`Usuário ${userId} deletado com sucesso.`);
    } catch (error) {
        console.error("Erro ao deletar usuário:", error);
        alert("Falha ao deletar usuário do banco de dados.");
    }
}

// Wrapper para o modal de confirmação
function showDeleteUserConfirmation(userId, username) {
    const message = `Tem certeza que deseja excluir o usuário <strong>${username}</strong>? Esta ação não pode ser desfeita.`;
    showDestructiveConfirmationModal(userId, 'user', 'Confirmar Exclusão', message, 'deleteUser');
}