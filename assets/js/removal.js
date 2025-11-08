// assets/js/removal.js
import { state } from './appState.js';
import { db, doc, updateDoc, serverNow, SERVICE_COLLECTION_PATH, ALIGNMENT_COLLECTION_PATH } from './firebaseConfig.js';
import { renderRemovalList } from './uiRender.js';
import { alertUser } from './services.js';
import { MANAGER_ROLE, VENDEDOR_ROLE } from './auth.js';

let jobToManage = null;

/**
 * Inicializa os handlers da aba de remoção.
 */
export function initRemovalHandlers() {
    // Expor funções para o HTML
    window.showManagementModal = showManagementModal;
    window.hideManagementModal = hideManagementModal;
    window.handleMarkAsLost = handleMarkAsLost;
    window.hideEditModal = hideEditModal;

    // Listeners dos modais
    document.getElementById('edit-and-return-button').addEventListener('click', handleShowEditModal);
    document.getElementById('edit-job-form').addEventListener('submit', handleUpdateJob);
}

/**
 * Atualiza a lista de remoção com os dados mais recentes.
 */
export function updateRemovalList() {
    if (state.currentUserRole === MANAGER_ROLE || state.currentUserRole === VENDEDOR_ROLE) {
        renderRemovalList(state.serviceJobs, state.alignmentQueue);
    }
}

/**
 * Mostra o modal de gerenciamento para um serviço específico.
 */
function showManagementModal(id, type, licensePlate) {
    jobToManage = { id, type };
    document.getElementById('management-modal-title').textContent = `Gerenciar Serviço: ${licensePlate}`;
    document.getElementById('management-modal').classList.remove('hidden');
}

/**
 * Esconde o modal de gerenciamento.
 */
function hideManagementModal() {
    document.getElementById('management-modal').classList.add('hidden');
    jobToManage = null;
}

/**
 * Mostra o modal de edição e preenche com os dados do serviço.
 */
function handleShowEditModal() {
    if (!jobToManage) {
        console.error("Nenhum serviço selecionado para edição");
        return;
    }

    const { id, type } = jobToManage;
    const jobData = type === 'service'
        ? state.serviceJobs.find(j => j.id === id)
        : state.alignmentQueue.find(j => j.id === id);

    if (!jobData) {
        alertUser("Erro: Serviço não encontrado para edição.");
        console.error("Serviço não encontrado:", { id, type, serviceJobs: state.serviceJobs.length, alignmentQueue: state.alignmentQueue.length });
        return;
    }

    // Popula as informações do carro
    const carInfoEl = document.getElementById('edit-modal-car-info');
    if (carInfoEl) {
        carInfoEl.textContent = `Carro: ${jobData.carModel || 'N/A'} (${jobData.licensePlate || 'N/A'})`;
    }

    // Popula os dropdowns
    const vendedorSelect = document.getElementById('edit-vendedor');
    const mecanicoSelect = document.getElementById('edit-mecanico');

    if (!vendedorSelect || !mecanicoSelect) {
        console.error("Elementos do formulário de edição não encontrados");
        alertUser("Erro: Formulário de edição não encontrado.");
        return;
    }

    const vendedores = state.users.filter(u => u.role === 'vendedor' || u.role === 'manager');
    const mecanicos = state.users.filter(u => u.role === 'mecanico');

    vendedorSelect.innerHTML = vendedores.map(u => `<option value="${u.username}">${u.username}</option>`).join('');
    mecanicoSelect.innerHTML = mecanicos.map(u => `<option value="${u.username}">${u.username}</option>`).join('');

    // Seleciona os valores atuais
    vendedorSelect.value = jobData.vendedorName || '';
    if (type === 'service' && jobData.assignedMechanic) {
        mecanicoSelect.value = jobData.assignedMechanic;
        mecanicoSelect.parentElement.style.display = 'block';
    } else if (type === 'alignment' && jobData.gsMechanic) {
        mecanicoSelect.value = jobData.gsMechanic;
        mecanicoSelect.parentElement.style.display = 'block';
    } else {
        // Esconde o campo de mecânico se não houver mecânico associado
        mecanicoSelect.parentElement.style.display = type === 'service' ? 'block' : 'none';
        if (mecanicos.length > 0) {
            mecanicoSelect.value = mecanicos[0].username; // Define um valor padrão
        }
    }

    // Esconde o modal de gerenciamento e mostra o de edição
    hideManagementModal();
    const editModal = document.getElementById('edit-job-modal');
    if (editModal) {
        editModal.classList.remove('hidden');
    } else {
        console.error("Modal de edição não encontrado");
        alertUser("Erro: Modal de edição não encontrado.");
    }
}

/**
 * Esconde o modal de edição.
 */
function hideEditModal() {
    document.getElementById('edit-job-modal').classList.add('hidden');
    document.getElementById('edit-job-form').reset();
    jobToManage = null; // Limpa o job em gerenciamento
}


/**
 * Marca um serviço como 'Perdido'.
 */
async function handleMarkAsLost() {
    if (!jobToManage) return;
    const { id, type } = jobToManage;
    const collectionPath = type === 'service' ? SERVICE_COLLECTION_PATH : ALIGNMENT_COLLECTION_PATH;

    try {
        await updateDoc(doc(db, ...collectionPath, id), { status: 'Perdido' });
        alertUser(`Serviço marcado como 'Perdido'.`);
    } catch (error) {
        console.error("Erro ao marcar serviço como perdido:", error);
        alertUser("Erro ao atualizar o status no banco de dados.");
    } finally {
        hideManagementModal();
    }
}

/**
 * Atualiza o serviço no banco de dados e o retorna para a fila.
 */
async function handleUpdateJob(e) {
    e.preventDefault();
    if (!jobToManage) return;

    const { id, type } = jobToManage;
    const collectionPath = type === 'service' ? SERVICE_COLLECTION_PATH : ALIGNMENT_COLLECTION_PATH;

    const newVendedor = document.getElementById('edit-vendedor').value.trim();
    const mecanicoSelect = document.getElementById('edit-mecanico');
    const newMecanico = mecanicoSelect ? mecanicoSelect.value.trim() : '';
    
    if (!newVendedor) {
        alertUser("Por favor, selecione um vendedor.");
        return;
    }

    const dataToUpdate = {
        vendedorName: newVendedor,
        timestamp: serverNow(), // Novo timestamp para dar prioridade
    };

    if (type === 'service') {
        // Retorna o serviço à fila resetando os status
        if (!newMecanico) {
            alertUser("Por favor, selecione um mecânico.");
            return;
        }
        
        dataToUpdate.status = 'Pendente';
        dataToUpdate.assignedMechanic = newMecanico;
        
        // Reseta os status dos sub-serviços para garantir que volte à fila corretamente
        const jobData = state.serviceJobs.find(j => j.id === id);
        if (jobData) {
            // Sempre reseta statusGS para pendente ao retornar à fila
            dataToUpdate.statusGS = 'Pendente';
            
            // Se o serviço tinha statusTS, reseta também (mas só se tinha pneus)
            if (jobData.statusTS !== null && jobData.statusTS !== undefined) {
                dataToUpdate.statusTS = 'Pendente';
            }
        } else {
            // Se não encontrou no estado, reseta mesmo assim
            dataToUpdate.statusGS = 'Pendente';
        }
    } else {
        // Para alinhamento
        dataToUpdate.status = 'Aguardando';
        // Se o serviço de alinhamento tiver um mecânico associado, atualiza também
        if (mecanicoSelect.parentElement.style.display !== 'none' && newMecanico) {
            dataToUpdate.gsMechanic = newMecanico;
        }
    }

    try {
        await updateDoc(doc(db, ...collectionPath, id), dataToUpdate);
        alertUser("Serviço atualizado e retornado à fila com prioridade.");
        hideEditModal();
    } catch (error) {
        console.error("Erro ao atualizar e retornar serviço:", error);
        alertUser("Erro ao salvar as alterações no banco de dados.");
    }
}