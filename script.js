import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        // =========================================================================
        // CORREÇÃO PARA EXECUÇÃO LOCAL (LIVE SERVER/PREVIEW)
        // Definimos variáveis locais para os globais da plataforma (que não existem)
        // =========================================================================
        const isCanvasEnvironment = typeof __app_id !== 'undefined';
        const LOCAL_APP_ID = 'local-autocenter-app';

        // 1. Definições de Variáveis
        const appId = isCanvasEnvironment ? __app_id : LOCAL_APP_ID;
        
        // Define uma configuração de placeholder segura para evitar falhas ao rodar localmente
        const LOCAL_FIREBASE_CONFIG = {
            apiKey: "SUA_API_KEY_AQUI", // Use sua chave aqui para persistência
            authDomain: "SUA_AUTH_DOMAIN_AQUI", 
            projectId: "SUA_PROJECT_ID_AQUI", 
            storageBucket: "SUA_STORAGE_BUCKET_AQUI",
            messagingSenderId: "SUA_MESSAGING_SENDER_ID_AQUI",
            appId: "SUA_APP_ID_AQUI",
        };

        let firebaseConfig = {};
        if (isCanvasEnvironment && typeof __firebase_config !== 'undefined') {
            try {
                firebaseConfig = JSON.parse(__firebase_config);
            } catch (e) {
                console.error("Erro ao fazer parse da configuração do Firebase da plataforma. Usando placeholders.", e);
                firebaseConfig = LOCAL_FIREBASE_CONFIG;
            }
        } else {
            firebaseConfig = LOCAL_FIREBASE_CONFIG;
        }

        const initialAuthToken = isCanvasEnvironment && typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        
        let db;
        let auth;
        let userId = 'loading';
        let isAuthReady = false;
        let isDemoMode = false; // FLAG para Modo Demo

        // 2. Detecção de Modo Demo
        if (!isCanvasEnvironment || firebaseConfig.apiKey === "SUA_API_KEY_AQUI") {
            isDemoMode = true;
        }
        // =========================================================================
        // FIM DA CORREÇÃO
        // =========================================================================


        // Armazenamento em memória para Modo Demo
        let serviceJobs = [];
        let alignmentQueue = [];
        let jobIdCounter = 100;
        let aliIdCounter = 200;
        let currentJobToConfirm = { id: null, type: null }; // OBJETO NOVO: Variável global para confirmação

        // MECÂNICOS ATUALIZADOS
        const MECHANICS = ['José', 'Wendell'];
        const SERVICE_COLLECTION_PATH = `/artifacts/${appId}/public/data/serviceJobs`;
        const ALIGNMENT_COLLECTION_PATH = `/artifacts/${appId}/public/data/alignmentQueue`;
        const STATUS_PENDING = 'Pendente';
        const STATUS_READY = 'Pronto para Pagamento'; // Serviço concluído E Alinhamento concluído (se aplicável)
        const STATUS_FINALIZED = 'Finalizado'; // Pago e liberado pelo gerente
        
        // Status do Serviço Geral
        const STATUS_GS_FINISHED = 'Serviço Geral Concluído'; // NOVO: Serviço Geral terminou, mas AGUARDA Alinhamento
        
        // Status do Alinhamento
        const STATUS_WAITING_GS = 'Aguardando Serviço Geral'; // Alinhamento esperando mecânico (LINHA VERMELHA)
        const STATUS_WAITING = 'Aguardando'; // Disponível para Alinhar (Prioridade Alta)
        const STATUS_ATTENDING = 'Em Atendimento';

        // ------------------------------------
        // 1. Configuração e Autenticação
        // ------------------------------------
        
        // Função para inicializar o Firebase
        function initializeFirebase() {
            if (isDemoMode) {
                document.getElementById('user-info').textContent = `MODO DEMO ATIVO (Dados não persistentes).`;
                document.getElementById('service-error').textContent = "As ações não serão salvas. Para persistência, use suas chaves Firebase.";
                isAuthReady = true; // Crucial: Libera a UI imediatamente no modo local
                
                // Renderiza a UI vazia no Modo Demo
                renderServiceQueues(serviceJobs);
                renderAlignmentQueue(alignmentQueue);
                renderAlignmentMirror(alignmentQueue); 
                renderReadyJobs(serviceJobs, alignmentQueue); 
                return;
            }

            try {
                const app = initializeApp(firebaseConfig);
                db = getFirestore(app);
                auth = getAuth(app);
                setLogLevel('Debug'); // Ativa logs detalhados do Firestore

                // Listener de autenticação
                onAuthStateChanged(auth, async (user) => {
                    if (user) {
                        userId = user.uid;
                    } else {
                        // Se não houver token, faz login anônimo
                        await signInAnonymously(auth);
                        userId = auth.currentUser.uid;
                    }

                    // Tentativa de login com token personalizado se disponível
                    if (initialAuthToken) {
                        try {
                            await signInWithCustomToken(auth, initialAuthToken);
                        } catch (e) {
                            console.error("Erro ao fazer login com custom token:", e);
                            await signInAnonymously(auth); // Fallback para anônimo
                        }
                    }

                    userId = auth.currentUser?.uid || crypto.randomUUID();
                    document.getElementById('user-info').textContent = `Usuário ID: ${userId} (Dados são compartilhados com o ID do App: ${appId})`;
                    isAuthReady = true;

                    // Uma vez autenticado, inicia os listeners de dados
                    setupRealtimeListeners();
                });
            } catch (e) {
                console.error("Erro ao inicializar Firebase:", e);
                // Se a inicialização falhar (ex: credenciais inválidas), mostra o erro
                document.getElementById('service-error').textContent = `Erro Fatal: Falha na inicialização do Firebase. Verifique a console.`;
            }
        }

        // ------------------------------------
        // 2. Lógica de Atribuição e Persistência
        // ------------------------------------

        /**
         * Busca a carga de trabalho atual dos mecânicos e retorna o menos ocupado.
         * @returns {Promise<string>} O nome do mecânico menos carregado.
         */
        async function getLeastLoadedMechanic() {
            let jobsToCount = [];

            if (isDemoMode) {
                 // MODO DEMO: Usa o array em memória
                 jobsToCount = serviceJobs.filter(job => job.status === STATUS_PENDING);
            } else {
                // MODO REAL: Consulta o Firestore
                try {
                    const q = query(
                        collection(db, SERVICE_COLLECTION_PATH),
                        where('status', '==', STATUS_PENDING)
                    );
                    const snapshot = await getDocs(q);
                    jobsToCount = snapshot.docs.map(doc => doc.data());
                } catch (e) {
                    console.error("Erro ao consultar Firestore para carga de mecânicos:", e);
                    throw new Error("Falha ao calcular a carga de trabalho.");
                }
            }
            
            const load = {};
            MECHANICS.forEach(m => load[m] = 0);

            jobsToCount.forEach(job => {
                if (MECHANICS.includes(job.assignedMechanic)) {
                    load[job.assignedMechanic]++;
                }
            });

            console.log("Carga atual dos mecânicos:", load);

            // Encontra o mecânico com a menor carga
            let leastLoad = Infinity;
            let leastLoadedMechanic = MECHANICS[0];

            for (const mechanic of MECHANICS) {
                if (load[mechanic] < leastLoad) {
                    leastLoad = load[mechanic];
                    leastLoadedMechanic = mechanic;
                }
            }

            return leastLoadedMechanic;
        }


        // ------------------------------------
        // 3. Handlers de Formulário
        // ------------------------------------

        /**
         * Cadastra um novo serviço e atribui automaticamente ao mecânico.
         */
        document.getElementById('service-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const customerName = document.getElementById('customerName').value.trim();
            const licensePlate = document.getElementById('licensePlate').value.trim().toUpperCase();
            const carModel = document.getElementById('carModel').value.trim();
            const serviceDescription = document.getElementById('serviceDescription').value.trim();
            
            // Captura se o carro vai alinhar
            const willAlign = document.querySelector('input[name="willAlign"]:checked').value;

            const errorElement = document.getElementById('service-error');
            const messageElement = document.getElementById('assignment-message');
            errorElement.textContent = '';
            messageElement.textContent = 'Atribuindo...';

            if (!isAuthReady) {
                errorElement.textContent = 'Aguardando inicialização do sistema...';
                return;
            }

            try {
                const assignedMechanic = await getLeastLoadedMechanic();
                const requiresAlignment = (willAlign === 'Sim');

                const newJob = {
                    customerName,
                    licensePlate,
                    carModel,
                    serviceDescription,
                    assignedMechanic,
                    status: STATUS_PENDING,
                    requiresAlignment: requiresAlignment, // Flag
                    timestamp: isDemoMode ? { seconds: Date.now() / 1000 } : serverTimestamp(),
                    registeredBy: userId,
                    id: `job_${jobIdCounter++}`, // ID exclusivo para Modo Demo
                    type: 'Serviço Geral'
                };
                
                if (isDemoMode) {
                    // MODO DEMO: Adiciona ao array e renderiza
                    serviceJobs.push(newJob);
                    
                    let statusMessage = `✅ Simulação: Serviço atribuído a ${assignedMechanic}!`;
                    
                    // Se for para alinhamento, cria o job de alinhamento AGUARDANDO GS
                    if (requiresAlignment) {
                        const newAlignmentCar = {
                            customerName,
                            licensePlate,
                            carModel,
                            status: STATUS_WAITING_GS, // ENTRA VERMELHO: AGUARDANDO MECÂNICO
                            gsDescription: newJob.serviceDescription, // Para exibir
                            gsMechanic: newJob.assignedMechanic,    // Para exibir
                            serviceJobId: newJob.id, // Link para o GS Job
                            timestamp: { seconds: Date.now() / 1000 + 0.001 }, 
                            addedBy: userId,
                            id: `ali_${aliIdCounter++}`,
                            type: 'Alinhamento'
                        };
                        alignmentQueue.push(newAlignmentCar);
                        
                        renderAlignmentQueue(alignmentQueue); 
                        renderAlignmentMirror(alignmentQueue); // ATUALIZA ESPELHO
                        statusMessage += ` e adicionado à fila de Alinhamento (Aguardando)!`;
                    }

                    renderServiceQueues(serviceJobs);
                    renderReadyJobs(serviceJobs, alignmentQueue);


                    errorElement.textContent = "MODO DEMO: Dados não salvos.";
                    messageElement.textContent = statusMessage;
                } else {
                    // MODO REAL: Adiciona ao Firestore
                    const serviceJobId = newJob.id;
                    delete newJob.id;
                    const jobRef = await addDoc(collection(db, SERVICE_COLLECTION_PATH), newJob);
                    
                    // Se for para alinhamento, adiciona à fila de alinhamento no Firestore
                    if (requiresAlignment) {
                         const newAlignmentCar = {
                            customerName,
                            licensePlate,
                            carModel,
                            status: STATUS_WAITING_GS, // ENTRA VERMELHO: AGUARDANDO MECÂNICO
                            gsDescription: newJob.serviceDescription,
                            gsMechanic: newJob.assignedMechanic,
                            timestamp: serverTimestamp(),
                            addedBy: userId,
                            type: 'Alinhamento',
                            serviceJobRef: jobRef.id // Link para o Job principal
                        };
                        await addDoc(collection(db, ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
                    }
                    
                    messageElement.textContent = `✅ Serviço atribuído automaticamente a ${assignedMechanic}!`;
                    if (requiresAlignment) {
                        messageElement.textContent += ` e carro na fila de alinhamento (Aguardando GS)!`;
                    }
                }

                document.getElementById('service-form').reset();
                setTimeout(() => messageElement.textContent = isDemoMode ? "Modo Demo Ativo." : '', 5000);

            } catch (error) {
                console.error("Erro ao cadastrar serviço:", error);
                errorElement.textContent = `Erro no cadastro: ${error.message}`;
                messageElement.textContent = '';
            }
        });

        /**
         * Adiciona um carro à fila de alinhamento (manualmente pela aba 2).
         */
        document.getElementById('alignment-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const customerName = document.getElementById('aliCustomerName').value.trim();
            const licensePlate = document.getElementById('aliLicensePlate').value.trim().toUpperCase();
            const carModel = document.getElementById('aliCarModel').value.trim(); // NOVO
            const errorElement = document.getElementById('alignment-error');
            errorElement.textContent = '';

            if (!isAuthReady) {
                errorElement.textContent = 'Aguardando inicialização do sistema...';
                return;
            }

            try {
                const newAlignmentCar = {
                    customerName,
                    licensePlate,
                    carModel, // NOVO
                    status: STATUS_WAITING, // Manualmente adicionado, PODE IR DIRETO para Waiting (Prioridade Alta)
                    timestamp: isDemoMode ? { seconds: Date.now() / 1000 } : serverTimestamp(),
                    addedBy: userId,
                    id: `ali_${aliIdCounter++}`, // ID exclusivo para Modo Demo
                    type: 'Alinhamento',
                    gsDescription: 'N/A (Adicionado Manualmente)',
                    gsMechanic: 'N/A'
                };

                if (isDemoMode) {
                    // MODO DEMO: Adiciona ao array e renderiza
                    alignmentQueue.push(newAlignmentCar);
                    renderAlignmentQueue(alignmentQueue);
                    renderAlignmentMirror(alignmentQueue); // ATUALIZA ESPELHO
                    renderReadyJobs(serviceJobs, alignmentQueue); 
                    errorElement.textContent = 'MODO DEMO: Cliente adicionado (Não salvo).';
                } else {
                    // MODO REAL: Adiciona ao Firestore
                    delete newAlignmentCar.id;
                    await addDoc(collection(db, ALIGNMENT_COLLECTION_PATH), newAlignmentCar);
                    errorElement.textContent = '✅ Cliente adicionado à fila de alinhamento com sucesso!';
                }

                document.getElementById('alignment-form').reset();
                setTimeout(() => errorElement.textContent = '', 5000);

            } catch (error) {
                console.error("Erro ao adicionar à fila de alinhamento:", error);
                errorElement.textContent = `Erro: ${error.message}`;
            }
        });

        /**
         * Move um carro na fila de alinhamento para cima.
         * @param {string} docId ID do carro.
         */
        function moveAlignmentUp(docId) {
            if (isDemoMode) {
                const index = alignmentQueue.findIndex(car => car.id === docId);
                // Garante que o carro está no grupo de PRIORIDADE (STATUS_WAITING)
                if (index > 0 && alignmentQueue[index].status === STATUS_WAITING) {
                    // Encontra o último carro que está no mesmo status de PRIORIDADE
                    let prevWaitingIndex = index - 1;
                    while(prevWaitingIndex >= 0 && alignmentQueue[prevWaitingIndex].status !== STATUS_WAITING) {
                        prevWaitingIndex--;
                    }

                    if (prevWaitingIndex >= 0) {
                         // Troca a posição com o anterior no grupo de prioridade
                         [alignmentQueue[prevWaitingIndex], alignmentQueue[index]] = [alignmentQueue[index], alignmentQueue[prevWaitingIndex]];
                         renderAlignmentQueue(alignmentQueue);
                         renderAlignmentMirror(alignmentQueue); // ATUALIZA ESPELHO
                    }
                } else {
                    alertUser("Este carro já está no topo da fila de espera ou não está disponível para movimentação.");
                }
                return;
            } 
            
            // MODO REAL: Implementação complexa para Firebase (requer campo de prioridade)
            alertUser("A movimentação manual da fila requer a implementação de lógica de prioridade no Firestore.");
        }

        /**
         * Move um carro na fila de alinhamento para baixo.
         * @param {string} docId ID do carro.
         */
        function moveAlignmentDown(docId) {
            if (isDemoMode) {
                const index = alignmentQueue.findIndex(car => car.id === docId);
                // Garante que o carro existe, não é o último e que está apenas WAITING
                if (index !== -1 && index < alignmentQueue.length - 1 && alignmentQueue[index].status === STATUS_WAITING) {
                    // Encontra o próximo carro que está APENAS WAITING
                    let nextWaitingIndex = index + 1;
                    while(nextWaitingIndex < alignmentQueue.length && alignmentQueue[nextWaitingIndex].status !== STATUS_WAITING) {
                        nextWaitingIndex++;
                    }

                    if (nextWaitingIndex < alignmentQueue.length) {
                         // Troca a posição com o posterior na fila de espera
                        [alignmentQueue[nextWaitingIndex], alignmentQueue[index]] = [alignmentQueue[index], alignmentQueue[nextWaitingIndex]];
                        renderAlignmentQueue(alignmentQueue);
                        renderAlignmentMirror(alignmentQueue); // ATUALIZA ESPELHO
                    }
                } else {
                    alertUser("Este carro já é o último na fila de espera ou não está disponível para movimentação.");
                }
                return;
            } 

            // MODO REAL: Implementação complexa para Firebase (requer campo de prioridade)
            alertUser("A movimentação manual da fila requer a implementação de lógica de prioridade no Firestore.");
        }

        // NOVO: Função genérica para mostrar o modal de confirmação
        function showConfirmationModal(id, type, title, message, confirmAction) {
            currentJobToConfirm = { id, type, confirmAction };
            const modal = document.getElementById('confirmation-modal');
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').innerHTML = message;
            
            const confirmButton = document.getElementById('confirm-button');
            confirmButton.classList.remove('bg-red-600', 'hover:bg-red-700');
            confirmButton.classList.add('bg-green-600', 'hover:bg-green-700');
            confirmButton.textContent = 'Sim, Confirmar';

            // Configura o botão de confirmação para chamar a função correta
            confirmButton.onclick = () => {
                if (currentJobToConfirm.confirmAction === 'service') {
                    confirmServiceReady(); 
                } else if (currentJobToConfirm.confirmAction === 'alignment') {
                    confirmAlignmentReady(); 
                } else if (currentJobToConfirm.confirmAction === 'finalize') {
                    confirmFinalizeJob(); 
                }
            };

            modal.classList.remove('hidden');
        }

        // NOVO: Função genérica para mostrar o modal de finalização (com botão vermelho)
        function showFinalizeModal(id, type, title, message, confirmAction) {
            currentJobToConfirm = { id, type, confirmAction };
            const modal = document.getElementById('confirmation-modal');
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').innerHTML = message;
            
            const confirmButton = document.getElementById('confirm-button');
            confirmButton.classList.remove('bg-green-600', 'hover:bg-green-700');
            confirmButton.classList.add('bg-red-600', 'hover:bg-red-700');
            confirmButton.textContent = 'Sim, Finalizar e Receber';

            // Configura o botão de confirmação para chamar a função correta
            confirmButton.onclick = () => {
                confirmFinalizeJob(); 
            };

            modal.classList.remove('hidden');
        }

        // NOVO: Função para esconder o modal
        function hideConfirmationModal() {
            const modal = document.getElementById('confirmation-modal');
            modal.classList.add('hidden');
            currentJobToConfirm = { id: null, type: null };
        }
        
        // NOVO: Wrapper para Mecânico (Serviço Geral)
        function showServiceReadyConfirmation(docId) {
            showConfirmationModal(
                docId, 
                'service', 
                'Confirmar Serviço Geral Concluído',
                'Tem certeza de que deseja marcar este **Serviço Geral** como PRONTO e liberá-lo para a próxima etapa (Alinhamento ou Pagamento)?',
                'service'
            );
        }
        
        // NOVO: Wrapper para Alinhador
        function showAlignmentReadyConfirmation(docId) {
             showConfirmationModal(
                docId, 
                'alignment', 
                'Confirmar Alinhamento Concluído',
                'Tem certeza de que o **Alinhamento** está PRONTO e deve ser enviado para a Gerência?',
                'alignment'
            );
        }

        // NOVO: Wrapper para Gerente
        function showFinalizeConfirmation(docId, collectionType) {
            const title = collectionType === 'service' ? 'Finalizar Pagamento (Mecânica)' : 'Finalizar Pagamento (Alinhamento)';
            const message = `Confirma a finalização e recebimento do pagamento para o serviço de **${collectionType === 'service' ? 'Mecânica' : 'Alinhamento'}**? Esta ação removerá o carro do sistema.`;
            
             showFinalizeModal(
                docId, 
                collectionType, 
                title, 
                message, 
                'finalize'
            );
        }


        // NOVO: Função para confirmar a ação do Mecânico e disparar a lógica de pronto
        function confirmServiceReady() {
            if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'service') {
                markServiceReady(currentJobToConfirm.id); // Executa a lógica original
            }
            hideConfirmationModal();
        }
        
        // NOVO: Função para confirmar a ação do Alinhador e disparar a lógica de pronto
        function confirmAlignmentReady() {
            if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'alignment') {
                updateAlignmentStatus(currentJobToConfirm.id, 'Done'); // Executa a lógica original
            }
            hideConfirmationModal();
        }

        // NOVO: Função para confirmar a ação do Gerente
        function confirmFinalizeJob() {
            if (currentJobToConfirm.id && currentJobToConfirm.confirmAction === 'finalize') {
                finalizeJob(currentJobToConfirm.id, currentJobToConfirm.type); // Executa a lógica original
            }
            hideConfirmationModal();
        }


        /**
         * Marca um serviço geral (Mecânico) como PRONTO e libera o Alinhamento.
         * @param {string} docId ID do documento no Firestore ou ID de simulação.
         */
        async function markServiceReady(docId) {
            if (isDemoMode) {
                // MODO DEMO: Atualiza o status no array e re-renderiza
                const job = serviceJobs.find(j => j.id === docId);
                if (job) {
                    if (job.requiresAlignment) {
                        // 1. Marca o GS como concluído
                        job.status = STATUS_GS_FINISHED;
                        
                        // 2. Libera o Alinhamento
                        const alignmentCar = alignmentQueue.find(a => a.serviceJobId === docId);
                        if (alignmentCar) {
                            alignmentCar.status = STATUS_WAITING;
                        } else {
                            // Safety net: se o job de alinhamento sumiu, envia o GS para pronto.
                            job.status = STATUS_READY;
                        }
                    } else {
                        // 3. Se não precisa de alinhamento, vai para READY
                        job.status = STATUS_READY;
                    }
                    
                    // Re-renderiza todas as telas
                    renderServiceQueues(serviceJobs);
                    renderAlignmentQueue(alignmentQueue);
                    renderAlignmentMirror(alignmentQueue);
                    renderReadyJobs(serviceJobs, alignmentQueue);

                } else {
                    alertUser("Erro Demo: Serviço não encontrado.");
                }
                return;
            }
            
            // MODO REAL: Atualiza no Firestore
            try {
                const jobRef = doc(db, SERVICE_COLLECTION_PATH, docId);
                const jobDoc = await getDoc(jobRef);
                const jobData = jobDoc.data();
                
                if (!jobData) {
                    alertUser("Erro: Serviço não encontrado no DB.");
                    return;
                }

                if (jobData.requiresAlignment) {
                    // 1. Marca o Serviço Geral como Concluído (STATUS_GS_FINISHED)
                    await updateDoc(jobRef, {
                        status: STATUS_GS_FINISHED,
                        generalServiceFinishedAt: serverTimestamp()
                    });

                    // 2. Encontra o Job de Alinhamento e o marca como AGUARDANDO (STATUS_WAITING)
                    const alignmentQuery = query(
                        collection(db, ALIGNMENT_COLLECTION_PATH),
                        where('serviceJobRef', '==', docId)
                    );
                    const alignmentSnapshot = await getDocs(alignmentQuery);

                    if (!alignmentSnapshot.empty) {
                        const alignmentDocRef = alignmentSnapshot.docs[0].ref;
                        await updateDoc(alignmentDocRef, {
                            status: STATUS_WAITING
                        });
                    } else {
                        console.error("Alinhamento requerido, mas job de alinhamento não encontrado. Enviando GS para Pagamento.");
                        // Fallback de segurança: Se não achou o alinhamento, envia para pronto
                        await updateDoc(jobRef, { status: STATUS_READY, readyAt: serverTimestamp() });
                    }

                } else {
                    // 3. Se não requer alinhamento, envia diretamente para pagamento (STATUS_READY)
                    await updateDoc(jobRef, {
                        status: STATUS_READY,
                        readyAt: serverTimestamp()
                    });
                }

            } catch (e) {
                console.error("Erro ao marcar serviço como pronto:", e);
                alertUser("Erro ao marcar o serviço como pronto (Verifique o console).");
            }
        }

         /**
         * Finaliza um serviço (Gerente)
         * @param {string} docId ID do documento (job ou alinhamento).
         * @param {string} collectionType Tipo da coleção ('service' ou 'alignment').
         */
        async function finalizeJob(docId, collectionType) {
             const collectionPath = collectionType === 'service' ? SERVICE_COLLECTION_PATH : ALIGNMENT_COLLECTION_PATH;
             const isService = collectionType === 'service';

            if (isDemoMode) {
                 // MODO DEMO: Remove o job do array (simula finalização/limpeza)
                if (isService) {
                    serviceJobs = serviceJobs.filter(job => job.id !== docId);
                } else {
                    // Se o job de alinhamento foi finalizado, também remove o job de Serviço Geral (se vinculado)
                    const car = alignmentQueue.find(car => car.id === docId);
                    if (car && car.serviceJobId) {
                         serviceJobs = serviceJobs.filter(job => job.id !== car.serviceJobId);
                    }
                    alignmentQueue = alignmentQueue.filter(car => car.id !== docId);
                }
                
                renderReadyJobs(serviceJobs, alignmentQueue); // Re-renderiza a aba do gerente
                renderAlignmentMirror(alignmentQueue); // ATUALIZA ESPELHO
                return;
            }

            // MODO REAL: Atualiza no Firestore
            try {
                const docRef = doc(db, collectionPath, docId);
                // Usaremos a atualização para manter o registro, mas ele sairá do listener READY.
                await updateDoc(docRef, {
                    status: STATUS_FINALIZED,
                    finalizedAt: serverTimestamp(),
                    finalizedBy: userId
                });
                
            } catch (e) {
                console.error("Erro ao finalizar o serviço:", e);
                alertUser("Erro ao finalizar o serviço (Verifique o console).");
            }
        }


        /**
         * Atualiza o status de um item na fila de alinhamento.
         * MUDANÇA: 'Done' agora significa STATUS_READY, não remoção.
         * @param {string} docId ID do documento no Firestore ou ID de simulação.
         * @param {string} newStatus O novo status.
         */
        async function updateAlignmentStatus(docId, newStatus) {
            if (isDemoMode) {
                 // MODO DEMO: Atualiza o array
                 const carIndex = alignmentQueue.findIndex(car => car.id === docId);
                 if (carIndex !== -1) {
                     if (newStatus === 'Done') {
                         alignmentQueue[carIndex].status = STATUS_READY; // NOVO STATUS READY
                     } else {
                         alignmentQueue[carIndex].status = newStatus; // WAITING ou ATTENDING
                     }
                     renderAlignmentQueue(alignmentQueue);
                     renderAlignmentMirror(alignmentQueue); // ATUALIZA ESPELHO
                     renderReadyJobs(serviceJobs, alignmentQueue); 
                 } else {
                    alertUser("Erro Demo: Carro de alinhamento não encontrado.");
                 }
                 return;
            }
            
            // MODO REAL: Atualiza no Firestore
            try {
                const carRef = doc(db, ALIGNMENT_COLLECTION_PATH, docId);
                let statusToSet = newStatus === 'Done' ? STATUS_READY : newStatus;

                await updateDoc(carRef, { 
                    status: statusToSet,
                    readyAt: statusToSet === STATUS_READY ? serverTimestamp() : null
                });

            } catch (e) {
                console.error("Erro ao atualizar status do alinhamento:", e);
                alertUser("Erro ao atualizar status do alinhamento (Verifique o console).");
            }
        }
        
        /**
         * Função de alerta customizada para Modo Demo
         */
        function alertUser(message) {
            // Usamos uma mensagem simples na UI
            const serviceError = document.getElementById('service-error');
            const alignmentError = document.getElementById('alignment-error');
            
            serviceError.textContent = message;
            alignmentError.textContent = message;
            
            setTimeout(() => {
                serviceError.textContent = isDemoMode ? "As ações não serão salvas. Para persistência, use suas chaves Firebase." : '';
                alignmentError.textContent = '';
            }, 3000);
        }


        // ------------------------------------
        // 4. Renderização em Tempo Real (onSnapshot)
        // ------------------------------------

        /**
         * Renderiza a fila de serviços gerais agrupada por mecânico (PENDENTE).
         * @param {Array} jobs Lista de jobs.
         */
        function renderServiceQueues(jobs) {
            const container = document.getElementById('mechanics-queue-display');
            const monitorContainer = document.getElementById('mechanics-monitor');
            container.innerHTML = '';
            monitorContainer.innerHTML = '';
            
            const pendingJobs = jobs.filter(job => job.status === STATUS_PENDING);

            const groupedJobs = {};
            MECHANICS.forEach(m => groupedJobs[m] = []);

            // A ordenação é necessária para manter a ordem de entrada correta
            pendingJobs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

            pendingJobs.forEach(job => {
                if (MECHANICS.includes(job.assignedMechanic)) {
                    groupedJobs[job.assignedMechanic].push(job);
                }
            });

            // Renderiza as filas principais (Serviços e Atribuição)
            MECHANICS.forEach(mechanic => {
                const jobListHTML = groupedJobs[mechanic].map(job => `
                    <li class="p-3 bg-white border-l-4 border-blue-500 rounded-md shadow-sm flex justify-between items-center">
                        <div>
                            <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel})</p>
                            <p class="text-sm text-gray-600">${job.serviceDescription.substring(0, 50)}...</p>
                            <p class="text-xs text-gray-400 mt-1">Entrada: ${new Date((job.timestamp?.seconds || 0) * 1000).toLocaleTimeString('pt-BR')}</p>
                        </div>
                        <!-- BOTÃO MUDADO PARA CHAMAR A CONFIRMAÇÃO -->
                        <button onclick="showServiceReadyConfirmation('${job.id}')"
                                class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition duration-150 ease-in-out">
                            Pronto
                        </button>
                    </li>
                `).join('');

                container.innerHTML += `
                    <div class="mechanic-card bg-gray-50 p-4 rounded-lg shadow-md border border-gray-100">
                        <h3 class="text-xl font-bold mb-3 text-gray-800 flex justify-between items-center">
                            ${mechanic}
                            <span class="text-sm font-semibold py-1 px-3 rounded-full ${groupedJobs[mechanic].length > 1 ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800'}">
                                ${groupedJobs[mechanic].length} Carros
                            </span>
                        </h3>
                        <ul class="space-y-2">
                            ${jobListHTML.length > 0 ? jobListHTML : '<p class="text-sm text-gray-500 italic p-3 border rounded-md">Nenhum carro na fila. ✅</p>'}
                        </ul>
                    </div>
                `;

                 // Renderiza os cartões do Monitor (aba 3 - PENDENTE)
                monitorContainer.innerHTML += `
                    <div class="p-6 bg-white rounded-xl shadow-lg border border-gray-200 text-center">
                        <h3 class="text-2xl font-bold text-gray-800 mb-2">${mechanic}</h3>
                        <p class="text-6xl font-extrabold ${groupedJobs[mechanic].length > 1 ? 'text-red-600' : 'text-blue-600'}">
                            ${groupedJobs[mechanic].length}
                        </p>
                        <p class="text-gray-500 mt-2">Carros Pendentes</p>
                    </div>
                `;
            });
        }
        
        /**
         * NOVO: Renderiza o espelho da fila de alinhamento na aba de serviços (mirror).
         * @param {Array} cars Lista de carros na fila de alinhamento (WAITING/ATTENDING).
         */
        function renderAlignmentMirror(cars) {
            const mirrorContainer = document.getElementById('alignment-mirror');
            if (!mirrorContainer) return; 
            
            // Filtra apenas carros ativos (Aguardando GS, Aguardando, Em Atendimento)
            const activeCars = cars.filter(car => 
                car.status === STATUS_WAITING || 
                car.status === STATUS_ATTENDING || 
                car.status === STATUS_WAITING_GS
            );
            
            // NOVO SORTEIO: Prioriza STATUS_WAITING/ATTENDING sobre STATUS_WAITING_GS
            activeCars.sort((a, b) => {
                const getPriority = (status) => {
                    if (status === STATUS_WAITING || status === STATUS_ATTENDING) return 1; // Prioridade Alta
                    if (status === STATUS_WAITING_GS) return 2; // Prioridade Baixa
                    return 3; 
                };

                const priorityA = getPriority(a.status);
                const priorityB = getPriority(b.status);

                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                // Ordenação secundária por timestamp (ordem de chegada)
                return (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0);
            });


            let mirrorHTML = '';
            
            if (activeCars.length === 0) {
                 mirrorHTML = '<p class="text-sm text-gray-500 italic p-3 text-center">Fila de Alinhamento vazia. ✅</p>';
            } else {
                mirrorHTML = `
                    <ul class="space-y-2">
                        ${activeCars.map((car, index) => {
                            const isWaitingGS = car.status === STATUS_WAITING_GS;
                            const isAttending = car.status === STATUS_ATTENDING;

                            const statusClass = isAttending ? 'bg-yellow-100 text-yellow-800' : 
                                                isWaitingGS ? 'bg-red-100 text-red-800' : 
                                                'bg-blue-100 text-blue-800';

                            // EXIBIÇÃO ALTERADA: Serviço Geral ou Disponível
                            const gsDescriptionShort = car.gsDescription ? car.gsDescription.substring(0, 20) + '...' : 'N/A';
                            const statusText = isAttending ? 'Em Atendimento' : 
                                               isWaitingGS ? `Aguardando GS (Serviço: ${gsDescriptionShort})` : 
                                               'Disponível';
                            
                            return `
                                <li class="p-3 bg-white rounded-md border border-gray-200 shadow-sm flex justify-between items-center text-sm">
                                    <!-- ATUALIZADO: Mostrar Modelo e Placa -->
                                    <span class="font-semibold">${index + 1}. ${car.carModel} (${car.licensePlate})</span>
                                    <span class="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                                        ${statusText}
                                    </span>
                                </li>
                            `;
                        }).join('')}
                    </ul>
                `;
            }

            mirrorContainer.innerHTML = mirrorHTML;
        }


        /**
         * Renderiza a fila de alinhamento em formato de tabela (WAITING/ATTENDING/WAITING_GS).
         * @param {Array} cars Lista de carros na fila de alinhamento.
         */
        function renderAlignmentQueue(cars) {
            const tableContainer = document.getElementById('alignment-table-container');
            const emptyMessage = document.getElementById('alignment-empty-message');
            
            // Filtra carros ativos (WAITING/ATTENDING/WAITING_GS)
            const activeCars = cars.filter(car => 
                car.status === STATUS_WAITING || 
                car.status === STATUS_ATTENDING ||
                car.status === STATUS_WAITING_GS
            );
            
            // NOVO SORTEIO: Prioriza STATUS_WAITING/ATTENDING sobre STATUS_WAITING_GS
            activeCars.sort((a, b) => {
                const getPriority = (status) => {
                    if (status === STATUS_WAITING || status === STATUS_ATTENDING) return 1; // Prioridade Alta
                    if (status === STATUS_WAITING_GS) return 2; // Prioridade Baixa
                    return 3; 
                };

                const priorityA = getPriority(a.status);
                const priorityB = getPriority(b.status);

                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                // Ordenação secundária por timestamp (ordem de chegada)
                return (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0);
            });


            if (activeCars.length === 0) {
                tableContainer.innerHTML = '';
                tableContainer.appendChild(emptyMessage);
                emptyMessage.style.display = 'block';
                return;
            } else {
                emptyMessage.style.display = 'none';
            }

            let tableHTML = `
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                            <!-- ATUALIZADO: Modelo / Placa -->
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modelo / Placa</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mover</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
            `;

            activeCars.forEach((car, index) => {
                const isNextWaiting = index === 0 && car.status === STATUS_WAITING;
                const isWaiting = car.status === STATUS_WAITING;
                const isAttending = car.status === STATUS_ATTENDING;
                const isWaitingGS = car.status === STATUS_WAITING_GS;
                
                // Os botões de mover e iniciar só aparecem se o status for STATUS_WAITING
                const isMovableOrStartable = isWaiting && !isAttending; 

                const statusColor = isAttending ? 'bg-yellow-100 text-yellow-800' : 
                                    isWaitingGS ? 'bg-red-100 text-red-800' : 
                                    'bg-blue-100 text-blue-800';

                // EXIBIÇÃO ALTERADA: Serviço Geral ou Disponível
                const gsDescriptionShort = car.gsDescription ? car.gsDescription.substring(0, 25) + '...' : 'N/A';
                const statusText = isAttending ? 'Em Atendimento' : 
                                   isWaitingGS ? `Aguardando GS: ${gsDescriptionShort}` : 
                                   'Disponível para Alinhar';

                // Cor da linha: Vermelho se Aguardando GS, Amarelo se Próximo a ser Atendido
                const rowClass = isWaitingGS ? 'bg-red-50/50' : (isNextWaiting ? 'bg-yellow-50/50' : '');

                // Botões de Mover (disponíveis apenas para carros AGUARDANDO (STATUS_WAITING))
                let moverButtons = '';
                if (isWaiting) {
                    // Encontra a posição real na lista filtrada de STATUS_WAITING (excluindo GS e ATTENDING)
                    const waitingOnlyList = activeCars.filter(c => c.status === STATUS_WAITING);
                    const waitingIndex = waitingOnlyList.findIndex(c => c.id === car.id);
                    const isLastWaiting = waitingIndex === waitingOnlyList.length - 1;
                    const isFirstWaiting = waitingIndex === 0;

                    moverButtons = `
                        <div class="flex items-center justify-center space-x-1">
                            <button onclick="moveAlignmentUp('${car.id}')"
                                    class="text-sm p-1 rounded-full text-blue-600 hover:bg-gray-200 disabled:text-gray-300 transition"
                                    ${isFirstWaiting ? 'disabled' : ''} title="Mover para cima">
                                &#9650; <!-- Seta para Cima -->
                            </button>
                            <button onclick="moveAlignmentDown('${car.id}')"
                                    class="text-sm p-1 rounded-full text-blue-600 hover:bg-gray-200 disabled:text-gray-300 transition"
                                    ${isLastWaiting ? 'disabled' : ''} title="Mover para baixo">
                                &#9660; <!-- Seta para Baixo -->
                            </button>
                        </div>
                    `;
                }

                let actions;

                if (isAttending) {
                     // Botão de Pronto (Se já estiver em atendimento)
                    actions = `
                        <!-- MUDADO PARA CHAMAR O MODAL DE CONFIRMAÇÃO DO ALINHADOR -->
                        <button onclick="showAlignmentReadyConfirmation('${car.id}')"
                            class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-lg hover:bg-green-600 transition min-w-[120px]">
                            Pronto
                        </button>
                    `;
                } else if (isNextWaiting) {
                    // Botão de Iniciar (se for o próximo disponível na fila)
                    actions = `
                        <button onclick="updateAlignmentStatus('${car.id}', '${STATUS_ATTENDING}')"
                            class="text-xs font-medium bg-yellow-500 text-gray-900 py-1 px-3 rounded-lg hover:bg-yellow-600 transition min-w-[120px]">
                            Iniciar Atendimento
                        </button>
                    `;
                } else {
                    // Sem ações para carros esperando atrás do primeiro ou aguardando GS
                    actions = `<span class="text-xs text-gray-400">Na fila...</span>`;
                }


                tableHTML += `
                    <tr class="${rowClass}">
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${index + 1}</td>
                        <!-- ATUALIZADO: Mostrar Modelo e Placa -->
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            <span class="font-semibold">${car.carModel}</span>
                            <span class="text-xs text-gray-500 block">${car.licensePlate}</span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${car.customerName}</td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}">
                                ${statusText}
                            </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                            ${moverButtons}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div class="flex flex-col space-y-1 sm:space-y-0 sm:space-x-2 justify-end">
                                ${actions}
                            </div>
                        </td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table>`;
            tableContainer.innerHTML = tableHTML;
            tableContainer.prepend(emptyMessage);
            emptyMessage.style.display = 'none';
        }

        /**
         * Renderiza a lista unificada de trabalhos prontos para pagamento (STATUS_READY).
         * @param {Array} serviceJobs Lista completa de jobs.
         * @param {Array} alignmentQueue Lista completa de carros de alinhamento.
         */
        function renderReadyJobs(serviceJobs, alignmentQueue) {
            const container = document.getElementById('ready-jobs-container');
            const emptyMessage = document.getElementById('ready-empty-message');

            // APENAS jobs que não precisavam de alinhamento OU alinhamento que foi concluído
            const readyServiceJobs = serviceJobs
                .filter(job => job.status === STATUS_READY)
                .map(job => ({ ...job, source: 'service', sortTimestamp: job.timestamp?.seconds || 0 }));
            
            const readyAlignmentJobs = alignmentQueue
                .filter(car => car.status === STATUS_READY)
                .map(car => ({ ...car, source: 'alignment', sortTimestamp: car.timestamp?.seconds || 0 }));

            const readyJobs = [...readyServiceJobs, ...readyAlignmentJobs];
            readyJobs.sort((a, b) => a.sortTimestamp - b.sortTimestamp);

            if (readyJobs.length === 0) {
                container.innerHTML = '';
                container.appendChild(emptyMessage);
                emptyMessage.style.display = 'block';
                return;
            } else {
                 emptyMessage.style.display = 'none';
            }

            let tableHTML = `
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origem</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modelo / Placa</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serviço/Mecânico</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status (Pronto)</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações (Gerente)</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
            `;

            readyJobs.forEach(job => {
                const isService = job.source === 'service';
                const serviceInfo = isService ? job.assignedMechanic : 'Alinhador';
                const serviceDetail = isService ? job.serviceDescription.substring(0, 50) + '...' : 'Revisão de Geometria/Balanceamento';
                const readyTime = new Date((job.readyAt?.seconds || job.timestamp?.seconds || 0) * 1000).toLocaleTimeString('pt-BR');


                tableHTML += `
                    <tr class="ready-row">
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium ${isService ? 'text-blue-700' : 'text-yellow-700'}">${isService ? 'Mecânica' : 'Alinhamento'}</td>
                        <!-- ATUALIZADO: Mostrar Modelo e Placa -->
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                             <span class="font-semibold">${job.carModel || 'N/A'}</span>
                             <span class="text-xs text-gray-500 block">${job.licensePlate}</span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${job.customerName}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${serviceInfo} (${serviceDetail})</td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-200 text-green-800">
                                PRONTO (${readyTime})
                            </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <!-- BOTÃO DE FINALIZAÇÃO (Gerente) - CHAMA O MODAL -->
                            <button onclick="showFinalizeConfirmation('${job.id}', '${job.source}')"
                                class="text-sm font-medium bg-red-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-red-700 transition duration-150 ease-in-out">
                                Finalizar e Receber
                            </button>
                        </td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table>`;
            container.innerHTML = tableHTML;
            container.prepend(emptyMessage);
            emptyMessage.style.display = 'none';
        }


        /**
         * Configura os listeners de dados em tempo real.
         */
        function setupRealtimeListeners() {
            if (!isAuthReady || isDemoMode) return; // Não configura listeners em Modo Demo

            // Listener para Fila de Serviços Gerais (PENDENTE, GS_FINISHED, READY, FINALIZED)
            const serviceQuery = query(
                collection(db, SERVICE_COLLECTION_PATH),
                where('status', 'in', [STATUS_PENDING, STATUS_GS_FINISHED, STATUS_READY, STATUS_FINALIZED])
            );

            onSnapshot(serviceQuery, (snapshot) => {
                const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Ordenação no cliente
                jobs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
                serviceJobs = jobs; // Atualiza o array global
                renderServiceQueues(jobs);
                renderReadyJobs(jobs, alignmentQueue); // Atualiza aba de gerente
            }, (error) => {
                console.error("Erro no listener de Serviços:", error);
            });


            // Listener para Fila de Alinhamento (WAITING_GS, WAITING, ATTENDING, READY, FINALIZED)
            const alignmentQuery = query(
                collection(db, ALIGNMENT_COLLECTION_PATH),
                where('status', 'in', [STATUS_WAITING_GS, STATUS_WAITING, STATUS_ATTENDING, STATUS_READY, STATUS_FINALIZED])
            );

            onSnapshot(alignmentQuery, (snapshot) => {
                const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Ordenação no cliente
                // Não fazemos ordenação aqui, pois o renderizador fará a ordenação de prioridade
                alignmentQueue = cars; // Atualiza o array global para o monitor
                renderAlignmentQueue(cars);
                renderAlignmentMirror(cars); // NOVO: CHAMA A RENDERIZAÇÃO DO ESPELHO
                renderReadyJobs(serviceJobs, cars); // Atualiza aba de gerente
            }, (error) => {
                console.error("Erro no listener de Alinhamento:", error);
            });
        }


        // ------------------------------------
        // 5. Funções Globais e Inicialização
        // ------------------------------------

        // Expor funções para o escopo global para que os botões HTML possam chamá-las
        window.markServiceReady = markServiceReady;      
        window.updateAlignmentStatus = updateAlignmentStatus;
        window.moveAlignmentUp = moveAlignmentUp;
        window.moveAlignmentDown = moveAlignmentDown;
        window.finalizeJob = finalizeJob;               
        window.showServiceReadyConfirmation = showServiceReadyConfirmation; 
        window.hideConfirmationModal = hideConfirmationModal;               
        window.confirmServiceReady = confirmServiceReady;                   
        window.showAlignmentReadyConfirmation = showAlignmentReadyConfirmation; 
        window.confirmAlignmentReady = confirmAlignmentReady;               
        window.showFinalizeConfirmation = showFinalizeConfirmation; // NOVO
        window.confirmFinalizeJob = confirmFinalizeJob;             // NOVO

        // Inicializa o Firebase
        initializeFirebase();


        // ------------------------------------
        // 6. Controle de Navegação por Abas
        // ------------------------------------

        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.dataset.tab;

                // Remove a classe 'active' de todos os botões e conteúdos
                document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

                // Adiciona a classe 'active' ao botão e conteúdo clicados
                button.classList.add('active');
                document.getElementById(tabId).classList.add('active');
            });
        });