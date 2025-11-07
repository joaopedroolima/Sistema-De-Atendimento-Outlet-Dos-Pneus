// assets/js/services.js
import { state } from './appState.js';
import {
  db,
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  where,
  getDocs,
  SERVICE_COLLECTION_PATH,
  ALIGNMENT_COLLECTION_PATH,
  serverNow
} from './firebaseConfig.js';
import {
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  renderServiceQueues,
  renderAlignmentQueue,
  renderAlignmentMirror,
  renderReadyJobs,
  calculateAndRenderDailyStats
} from './uiRender.js';
import { MANAGER_ROLE } from './auth.js';

/* ============================================================================
   🔔 UTILITÁRIOS
============================================================================ */
export function alertUser(message) {
  const serviceError = document.getElementById('service-error');
  const alignmentError = document.getElementById('alignment-error');
  if (serviceError) serviceError.textContent = message;
  if (alignmentError) alignmentError.textContent = message;
  setTimeout(() => {
    if (serviceError) serviceError.textContent = '';
    if (alignmentError) alignmentError.textContent = '';
  }, 3000);
}

function isTimestampFromToday(timestamp) {
    if (!timestamp) return false;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const jobDate = timestamp.toDate();
    return jobDate >= startOfToday;
}

/* ============================================================================
   ⚡️ SINCRONIZAÇÃO EM TEMPO REAL
============================================================================ */
export function setupRealtimeListeners() {
  if (!db) {
    console.warn("⚠️ Firestore não inicializado, listeners não ativados.");
    return;
  }

  const serviceQuery = query(
    collection(db, ...SERVICE_COLLECTION_PATH),
    where('status', 'in', ['Pendente', 'Pronto para Pagamento', 'Finalizado', 'Serviço Geral Concluído'])
  );

  onSnapshot(serviceQuery, (snapshot) => {
    const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    state.serviceJobs = jobs.filter(j => j.status !== 'Finalizado' || isTimestampFromToday(j.finalizedAt));
    renderServiceQueues(state.serviceJobs);
    renderReadyJobs(state.serviceJobs, state.alignmentQueue);
    calculateAndRenderDailyStats();
  }, (error) => {
    console.error("Erro no listener de Serviços:", error);
    alertUser("Erro de conexão (Serviços): " + error.message);
  });

  const alignmentQuery = query(
    collection(db, ...ALIGNMENT_COLLECTION_PATH),
    where('status', 'in', ['Aguardando', 'Em Atendimento', 'Aguardando Serviço Geral', 'Pronto para Pagamento', 'Finalizado'])
  );

  onSnapshot(alignmentQuery, (snapshot) => {
    const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    state.alignmentQueue = cars.filter(c => c.status !== 'Finalizado' || isTimestampFromToday(c.finalizedAt));
    renderAlignmentQueue(state.alignmentQueue);
    renderAlignmentMirror(state.alignmentQueue);
    renderReadyJobs(state.serviceJobs, state.alignmentQueue);
    calculateAndRenderDailyStats();
  }, (error) => {
    console.error("Erro no listener de Alinhamento:", error);
    alertUser("Erro de conexão (Alinhamento): " + error.message);
  });

  console.log("📡 Firestore listeners ativos (serviceJobs e alignmentQueue)");
}

/* ============================================================================
   🧾 MARCAR SERVIÇO COMO PRONTO
============================================================================ */
export async function markServiceReady(docId, serviceType) { // serviceType é 'GS' ou 'TS'
  const dataToUpdate = {};
  const serviceDocRef = doc(db, ...SERVICE_COLLECTION_PATH, docId);

  try {
    // Atualiza o sub-serviço específico
    if (serviceType === 'GS') dataToUpdate.statusGS = 'Serviço Geral Concluído';
    if (serviceType === 'TS') dataToUpdate.statusTS = 'Serviço Pneus Concluído';
    await updateDoc(serviceDocRef, dataToUpdate);

    // Pega o documento atualizado para verificar se ambos estão prontos
    const serviceDoc = await getDoc(serviceDocRef);
    if (!serviceDoc.exists()) throw new Error("Documento de Serviço não encontrado.");

    const job = serviceDoc.data();
    const isGsReady = job.statusGS === 'Serviço Geral Concluído';
    const isTsReady = job.statusTS === 'Serviço Pneus Concluído' || job.statusTS === null;

    if (isGsReady && isTsReady) {
      if (job.requiresAlignment) {
        const alignQuery = query(
          collection(db, ...ALIGNMENT_COLLECTION_PATH),
          where('serviceJobId', '==', docId),
          where('status', '==', 'Aguardando Serviço Geral')
        );
        const alignSnapshot = await getDocs(alignQuery);

        if (!alignSnapshot.empty) {
          const alignDocRef = alignSnapshot.docs[0].ref;
          await updateDoc(alignDocRef, { status: 'Aguardando' });
          await updateDoc(serviceDocRef, { status: 'Serviço Geral Concluído' });
        } else {
          await updateDoc(serviceDocRef, { status: 'Pronto para Pagamento' });
        }
      } else {
        await updateDoc(serviceDocRef, { status: 'Pronto para Pagamento' });
      }
    }
  } catch (error) {
    console.error("Erro ao marcar serviço como pronto (Firestore):", error);
    alertUser(`Erro no Banco de Dados: ${error.message}`);
  }
}

/* ============================================================================
   💰 FINALIZAR SERVIÇO
============================================================================ */
export async function finalizeJob(docId, collectionType) {
  if (state.currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado.");

  try {
    const path = collectionType === 'service' ? SERVICE_COLLECTION_PATH : ALIGNMENT_COLLECTION_PATH;
    const docRef = doc(db, ...path, docId);
    const dataToUpdate = { status: 'Finalizado', finalizedAt: serverNow() };
    await updateDoc(docRef, dataToUpdate);

    // Se for Alinhamento, finaliza o GS associado também
    if (collectionType === 'alignment') {
      const carDoc = await getDoc(docRef);
      if (carDoc.exists() && carDoc.data().serviceJobId) {
        const serviceJobId = carDoc.data().serviceJobId;
        const serviceDocRef = doc(db, ...SERVICE_COLLECTION_PATH, serviceJobId);
        const serviceDoc = await getDoc(serviceDocRef);
        if (serviceDoc.exists() && serviceDoc.data().status !== 'Finalizado') {
          await updateDoc(serviceDocRef, dataToUpdate);
        }
      }
    }
    console.log(`💰 Job finalizado (${collectionType}):`, docId);
  } catch (err) {
    console.error('Erro ao finalizar job:', err);
    alertUser('Erro ao finalizar serviço.');
  }
}
/* ============================================================================
   🧠 LÓGICA DE ATRIBUIÇÃO
============================================================================ */
async function getLeastLoadedMechanic() {
    if (state.MECHANICS.length === 0) {
        throw new Error("Nenhum mecânico (Geral) ativo para atribuição.");
    }

    const q = query(collection(db, ...SERVICE_COLLECTION_PATH), where('status', '==', 'Pendente'));
    const snapshot = await getDocs(q);
    const jobsToCount = snapshot.docs.map(doc => doc.data());

    const load = {};
    state.MECHANICS.forEach(m => load[m] = 0);

    jobsToCount.forEach(job => {
        if (state.MECHANICS.includes(job.assignedMechanic)) {
            load[job.assignedMechanic]++;
        }
    });

    let leastLoad = Infinity;
    let leastLoadedMechanic = state.MECHANICS[0];
    for (const mechanic of state.MECHANICS) {
        if (load[mechanic] < leastLoad) {
            leastLoad = load[mechanic];
            leastLoadedMechanic = mechanic;
        }
    }
    return leastLoadedMechanic;
}

/* ============================================================================
   🎬 HANDLERS DE FORMULÁRIO
============================================================================ */
export function initServiceFormHandler() {
    document.getElementById('service-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.isLoggedIn) return alertUser("Você precisa estar logado.");

        const customerName = document.getElementById('customerName').value.trim();
        const vendedorName = document.getElementById('vendedorName').value.trim();
        const licensePlate = document.getElementById('licensePlate').value.trim().toUpperCase();
        const carModel = document.getElementById('carModel').value.trim();
        let serviceDescription = document.getElementById('serviceDescription').value.trim();
        const isServiceDefined = serviceDescription !== '';
        if (!isServiceDefined) serviceDescription = 'Avaliação';

        const manualSelection = document.getElementById('manualMechanic').value;
        const willAlign = document.querySelector('input[name="willAlign"]:checked').value === 'Sim';
        const willTireChange = document.querySelector('input[name="willTireChange"]:checked').value === 'Sim';

        const errorElement = document.getElementById('service-error');
        const messageElement = document.getElementById('assignment-message');
        errorElement.textContent = '';
        messageElement.textContent = 'Atribuindo...';

        try {
            const assignedMechanic = manualSelection && state.MECHANICS.includes(manualSelection)
                ? manualSelection
                : await getLeastLoadedMechanic();

            const newJob = {
                customerName, vendedorName, licensePlate, carModel, serviceDescription, isServiceDefined,
                assignedMechanic,
                assignedTireShop: willTireChange ? state.TIRE_SHOP_MECHANIC : null,
                status: 'Pendente',
                statusGS: 'Pendente',
                statusTS: willTireChange ? 'Pendente' : null,
                requiresAlignment: willAlign,
                timestamp: serverNow(),
                registeredBy: state.userId,
                type: 'Serviço Geral',
                finalizedAt: null
            };

            const jobRef = await addDoc(collection(db, ...SERVICE_COLLECTION_PATH), newJob);

            if (willAlign) {
                const newAlignmentCar = {
                    customerName, vendedorName, licensePlate, carModel,
                    status: 'Aguardando Serviço Geral',
                    gsDescription: newJob.serviceDescription,
                    gsMechanic: newJob.assignedMechanic,
                    timestamp: serverNow(),
                    addedBy: state.userId,
                    type: 'Alinhamento',
                    serviceJobId: jobRef.id,
                    finalizedAt: null
                };
                await addDoc(collection(db, ...ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
            }

            messageElement.textContent = `✅ Serviço atribuído a ${assignedMechanic}!`;
            document.getElementById('service-form').reset();
            setTimeout(() => (messageElement.textContent = ''), 5000);

        } catch (error) {
            console.error("Erro ao cadastrar serviço:", error);
            errorElement.textContent = `Erro no cadastro: ${error.message}`;
            messageElement.textContent = '';
        }
    });
}

export function initAlignmentFormHandler() {
    document.getElementById('alignment-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.isLoggedIn) return alertUser("Você precisa estar logado.");

        const customerName = document.getElementById('aliCustomerName').value.trim();
        const vendedorName = document.getElementById('aliVendedorName').value.trim();
        const licensePlate = document.getElementById('aliLicensePlate').value.trim().toUpperCase();
        const carModel = document.getElementById('aliCarModel').value.trim();
        const errorElement = document.getElementById('alignment-error');
        errorElement.textContent = '';

        try {
            const newAlignmentCar = {
                customerName, vendedorName, licensePlate, carModel,
                status: 'Aguardando',
                timestamp: serverNow(),
                addedBy: state.userId,
                type: 'Alinhamento',
                gsDescription: 'N/A (Adicionado Manualmente)',
                gsMechanic: 'N/A',
                finalizedAt: null
            };

            await addDoc(collection(db, ...ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
            errorElement.textContent = '✅ Cliente adicionado à fila de alinhamento!';
            document.getElementById('alignment-form').reset();
            setTimeout(() => errorElement.textContent = '', 5000);

        } catch (error) {
            console.error("Erro ao adicionar à fila de alinhamento:", error);
            errorElement.textContent = `Erro: ${error.message}`;
        }
    });
}

export async function defineService(docId, newDescription) {
    if (state.currentUserRole !== MANAGER_ROLE) return alertUser("Acesso negado.");
    if (!newDescription || !docId) return alertUser("Descrição inválida.");

    const dataToUpdate = { serviceDescription: newDescription, isServiceDefined: true };

    try {
        const docRef = doc(db, ...SERVICE_COLLECTION_PATH, docId);
        await updateDoc(docRef, dataToUpdate);

        const alignQuery = query(collection(db, ...ALIGNMENT_COLLECTION_PATH), where('serviceJobId', '==', docId));
        const alignSnapshot = await getDocs(alignQuery);

        if (!alignSnapshot.empty) {
            const alignDocRef = alignSnapshot.docs[0].ref;
            await updateDoc(alignDocRef, { gsDescription: newDescription });
        }
        alertUser("Serviço definido com sucesso!");
    } catch (error) {
        console.error("Erro ao definir serviço:", error);
        alertUser("Erro ao salvar serviço no banco de dados.");
    }
}
