// assets/js/alignment.js
import { state } from './appState.js';
import {
  db,
  collection,
  doc,
  updateDoc,
  getDocs,
  ALIGNMENT_COLLECTION_PATH,
  serverNow
} from './firebaseConfig.js';
import { getTimestampSeconds } from './uiRender.js';
import { alertUser } from './services.js';
import { MANAGER_ROLE, ALIGNER_ROLE } from './auth.js';
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export function initAlignmentHandlers() {
    window.moveAlignmentUp = moveAlignmentUp;
    window.moveAlignmentDown = moveAlignmentDown;
    window.updateAlignmentStatus = updateAlignmentStatus;
}

/* ============================================================================
   ⚙️ FUNÇÕES DE ORDENAÇÃO E BUSCA
============================================================================ */
export function getSortedAlignmentQueue() {
    const activeCars = state.alignmentQueue.filter(car =>
        ['Aguardando', 'Em Atendimento', 'Aguardando Serviço Geral'].includes(car.status)
    );

    activeCars.sort((a, b) => {
        const getPriority = (status) => {
            if (status === 'Em Atendimento') return 1;
            if (status === 'Aguardando') return 2;
            if (status === 'Aguardando Serviço Geral') return 3;
            return 4;
        };
        const priorityA = getPriority(a.status);
        const priorityB = getPriority(b.status);

        if (priorityA !== priorityB) return priorityA - priorityB;

        return getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp);
    });
    return activeCars;
}

export function findAdjacentCar(currentIndex, direction) {
  const activeCars = getSortedAlignmentQueue();
  let adjacentIndex = currentIndex + direction;
  while (adjacentIndex >= 0 && adjacentIndex < activeCars.length) {
    if (activeCars[adjacentIndex].status === 'Aguardando')
      return activeCars[adjacentIndex];
    adjacentIndex += direction;
  }
  return null;
}

/* ============================================================================
   🔼 MOVER PARA CIMA NA FILA
============================================================================ */
export async function moveAlignmentUp(docId) {
  if (state.currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado.");

  try {
    const sortedQueue = getSortedAlignmentQueue();
    const index = sortedQueue.findIndex((car) => car.id === docId);
    if (index === -1 || sortedQueue[index].status !== 'Aguardando') return;

    const carBefore = findAdjacentCar(index, -1);
    if (!carBefore) return alertUser("Este carro já está no topo da fila de espera.");

    const newTimeMillis = (getTimestampSeconds(carBefore.timestamp) * 1000) - 1000;
    const ref = doc(db, ...ALIGNMENT_COLLECTION_PATH, docId);
    await updateDoc(ref, { timestamp: newTimeMillis });
    console.log(`🔼 Carro movido para cima: ${docId}`);
  } catch (err) {
    console.error("Erro ao mover para cima:", err);
    alertUser("Erro ao mover carro no Firestore.");
  }
}

/* ============================================================================
   🔽 MOVER PARA BAIXO NA FILA
============================================================================ */
export async function moveAlignmentDown(docId) {
  if (state.currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado.");

  try {
    const sortedQueue = getSortedAlignmentQueue();
    const index = sortedQueue.findIndex((car) => car.id === docId);
    if (index === -1 || sortedQueue[index].status !== 'Aguardando') return;

    const carAfter = findAdjacentCar(index, +1);
    if (!carAfter) return alertUser("Este carro já é o último na fila de espera.");

    const newTimeMillis = (getTimestampSeconds(carAfter.timestamp) * 1000) + 1000;
    const ref = doc(db, ...ALIGNMENT_COLLECTION_PATH, docId);
    await updateDoc(ref, { timestamp: newTimeMillis });
    console.log(`🔽 Carro movido para baixo: ${docId}`);
  } catch (err) {
    console.error("Erro ao mover para baixo:", err);
    alertUser("Erro ao mover carro no Firestore.");
  }
}

/* ============================================================================
   🧾 ATUALIZAR STATUS DO ALINHAMENTO
============================================================================ */
export async function updateAlignmentStatus(docId, newStatus) {
  // Verifica permissões
  if (!state.isLoggedIn) {
    alertUser("Você precisa estar logado.");
    return;
  }
  
  if (state.currentUserRole !== MANAGER_ROLE && state.currentUserRole !== ALIGNER_ROLE) {
    alertUser("Acesso negado. Apenas Gerente ou Alinhador podem atualizar status.");
    return;
  }

  try {
    let finalStatus = newStatus;
    let dataToUpdate = { status: finalStatus };

    // Se for "Em Atendimento", apenas atualiza o status
    if (newStatus === 'Em Atendimento') {
      dataToUpdate = { status: 'Em Atendimento' };
    } else if (newStatus === 'Done') {
      finalStatus = 'Pronto para Pagamento';
      dataToUpdate = { status: finalStatus, readyAt: serverNow() };
    }

    const ref = doc(db, ...ALIGNMENT_COLLECTION_PATH, docId);
    await updateDoc(ref, dataToUpdate);

    console.log(`🔧 Status atualizado: ${docId} -> ${finalStatus}`);
  } catch (err) {
    console.error("Erro ao atualizar status:", err);
    alertUser(`Erro ao atualizar status do alinhamento: ${err.message}`);
  }
}
