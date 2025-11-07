
import { state } from './appState.js';
import { markServiceReady, finalizeJob, defineService } from './services.js';
import { updateAlignmentStatus } from './alignment.js';
import { MANAGER_ROLE, ALIGNER_ROLE } from './auth.js';

export let currentJobToConfirm = { id: null, type: null, confirmAction: null, serviceType: null };

export function initModalHandlers() {
    window.showServiceReadyConfirmation = showServiceReadyConfirmation;
    window.showAlignmentReadyConfirmation = showAlignmentReadyConfirmation;
    window.showFinalizeConfirmation = showFinalizeConfirmation;
    window.showDefineServiceModal = showDefineServiceModal;
    window.hideDefineServiceModal = hideDefineServiceModal;
    window.hideConfirmationModal = hideConfirmationModal;

    document.getElementById("confirm-button").addEventListener("click", handleConfirm);
    document.getElementById('define-service-form').addEventListener('submit', handleDefineServiceSubmit);
}

export function showConfirmationModal(id, type, title, message, confirmAction, serviceType = null) {
    currentJobToConfirm = { id, type, confirmAction, serviceType };
    const modal = document.getElementById('confirmation-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    const confirmButton = document.getElementById('confirm-button');
    confirmButton.classList.remove('bg-red-600', 'hover:bg-red-700');
    confirmButton.classList.add('bg-green-600', 'hover:bg-green-700');
    confirmButton.textContent = 'Sim, Confirmar';
    modal.classList.remove('hidden');
}

export function showFinalizeModal(id, type, title, message, confirmAction) {
    currentJobToConfirm = { id, type, confirmAction, serviceType: null };
    const modal = document.getElementById('confirmation-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    const confirmButton = document.getElementById('confirm-button');
    confirmButton.classList.remove('bg-green-600', 'hover:bg-green-700');
    confirmButton.classList.add('bg-red-600', 'hover:bg-red-700');
    confirmButton.textContent = 'Sim, Finalizar e Receber';
    modal.classList.remove('hidden');
}

export function hideConfirmationModal() {
    const modal = document.getElementById('confirmation-modal');
    modal.classList.add('hidden');
    currentJobToConfirm = { id: null, type: null, confirmAction: null, serviceType: null };
}

function handleConfirm() {
    const { id, confirmAction, type, serviceType } = currentJobToConfirm;
    if (!id || !confirmAction) { hideConfirmationModal(); return; }
    if (confirmAction === "service") markServiceReady(id, serviceType); // 'GS' ou 'TS'
    if (confirmAction === "alignment") updateAlignmentStatus(id, 'Done'); // 'Done' vira 'Pronto para Pagamento'
    if (confirmAction === "finalize") finalizeJob(id, type); // 'service' ou 'alignment'
    hideConfirmationModal();
}

// Wrappers que serão chamados pelo HTML
function showServiceReadyConfirmation(docId, serviceType) {
    if (!state.isLoggedIn) return alert("Você precisa estar logado.");
    const title = serviceType === 'GS' ? 'Confirmar Serviço Geral Concluído' : 'Confirmar Serviço de Pneus Concluído';
    const message = `Tem certeza de que deseja marcar este serviço (${serviceType === 'GS' ? 'Geral' : 'Pneus'}) como PRONTO e liberá-lo?`;
    showConfirmationModal(docId, 'service', title, message, 'service', serviceType);
}

function showAlignmentReadyConfirmation(docId) {
    if (state.currentUserRole !== MANAGER_ROLE && state.currentUserRole !== ALIGNER_ROLE) return alert("Acesso negado.");
    showConfirmationModal(docId, 'alignment', 'Confirmar Alinhamento Concluído', 'Tem certeza de que o **Alinhamento** está PRONTO e deve ser enviado para a Gerência?', 'alignment');
}

function showFinalizeConfirmation(docId, collectionType) {
    if (state.currentUserRole !== MANAGER_ROLE) return alert("Acesso negado.");
    const title = collectionType === 'service' ? 'Finalizar Pagamento (Mecânica)' : 'Finalizar Pagamento (Alinhamento)';
    const message = `Confirma a finalização e recebimento do pagamento? Esta ação marcará o carro como 'Finalizado'.`;
    showFinalizeModal(docId, collectionType, title, message, 'finalize');
}

// Define service modal simple handlers (assumes markup exists)
export let currentJobToDefineId = null;

function showDefineServiceModal(docId) {
    if (state.currentUserRole !== MANAGER_ROLE) return;

    const job = state.serviceJobs.find(j => j.id === docId);
    if (!job) {
        alert("Erro: Serviço não encontrado.");
        return;
    }
    currentJobToDefineId = docId;
    document.getElementById('service-modal-car-info').textContent = `Carro: ${job.carModel} (${job.licensePlate})`;
    const currentDescription = job.serviceDescription === "Avaliação" ? "" : job.serviceDescription;
    document.getElementById('new-service-description').value = currentDescription;
    document.getElementById('define-service-modal').classList.remove('hidden');
    document.getElementById('new-service-description').focus();
}

function hideDefineServiceModal() {
    document.getElementById('define-service-modal').classList.add('hidden');
    const form = document.getElementById('define-service-form');
    if (form) form.reset();
    currentJobToDefineId = null;
}

async function handleDefineServiceSubmit(e) {
    e.preventDefault();
    const newDescription = document.getElementById('new-service-description').value.trim();
    await defineService(currentJobToDefineId, newDescription);
    hideDefineServiceModal();
}
