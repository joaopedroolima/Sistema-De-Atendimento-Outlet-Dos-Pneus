
import { state } from './appState.js';
import { MANAGER_ROLE, VENDEDOR_ROLE, MECANICO_ROLE, ALIGNER_ROLE } from './auth.js';
import { getSortedAlignmentQueue } from './alignment.js';
import {
    Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


export function renderMechanicsManagement() {
    const activeMechSpan = document.getElementById('active-mechanics');
    const assignSelect = document.getElementById('assignedMechanic');

    const mechanicNames = state.MECHANICS;

    document.getElementById('mechanic-list-title').textContent = mechanicNames.join(', ');
    document.getElementById('mechanic-monitor-title').textContent = mechanicNames.join(', ');
    assignSelect.innerHTML = '<option value="automatic">-- Atribuição Automática --</option>' + mechanicNames.map(name => `<option value="${name}">${name}</option>`).join('');
}

export function renderSalespersonDropdowns() {
    const vendedorSelect = document.getElementById('vendedorName');
    const aliVendedorSelect = document.getElementById('aliVendedorName');
    if (!vendedorSelect || !aliVendedorSelect) return;

    const salespeople = state.users.filter(u => u.role === 'vendedor').map(u => u.username);
    
    // Adiciona "Gerente" como uma opção de vendedor
    const options = ['Gerente', ...salespeople];

    const optionsHTML = options.map(name => `<option value="${name}">${name}</option>`).join('');

    vendedorSelect.innerHTML = optionsHTML;
    aliVendedorSelect.innerHTML = optionsHTML;
}

// Função de priorização inteligente para ordenação (escopo global da função)
function getServicePriority(job, forTireShop = false) {
    const isGsPending = job.statusGS === 'Pendente';
    const isGsCompleted = job.statusGS === 'Serviço Geral Concluído';
    const isTsPending = job.statusTS === 'Pendente';
    const isTsCompleted = job.statusTS === 'Serviço Pneus Concluído';
    
    if (forTireShop) {
        // Para borracheiro: serviços com GS concluído (prontos para pneus) têm prioridade máxima
        if (isGsCompleted && isTsPending) {
            return 1; // Prioridade máxima - pode iniciar imediatamente
        } else if (isGsPending && isTsPending) {
            return 2; // Prioridade média - aguardando GS
        } else {
            return 3; // Outros casos
        }
    } else {
        // Para mecânicos: serviços normais (GS pendente) têm prioridade
        if (isGsPending) {
            return 1; // Prioridade máxima - pode iniciar
        } else if (isGsCompleted && isTsPending) {
            return 2; // Prioridade menor - GS já feito, só aguardando TS
        } else {
            return 3; // Outros casos
        }
    }
}

export function renderServiceQueues(jobs) {
    const mechanicsContainer = document.getElementById('mechanics-queue-display');
    const monitorContainer = document.getElementById('mechanics-monitor');
    const tireShopList = document.getElementById('tire-shop-list');
    const tireShopCount = document.getElementById('tire-shop-count');

    // CORREÇÃO: Agrupamento de jobs movido para o início da função.
    const groupedJobs = {};
    [...state.MECHANICS, state.TIRE_SHOP_MECHANIC].forEach(m => groupedJobs[m] = []); // Inclui 'Borracheiro'
    const tireShopJobs = [];

    // Ordena por prioridade primeiro, depois por timestamp
    jobs.sort((a, b) => {
        // Para cada tipo de fila, calcula a prioridade
        const priorityA = getServicePriority(a, false); // Mecânico
        const priorityB = getServicePriority(b, false);
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB; // Menor número = maior prioridade
        }
        
        // Se mesma prioridade, ordena por timestamp
        return getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp);
    });

    jobs.forEach(job => {
        // Serviço Geral: mostra na fila do mecânico se GS está pendente
        // Mas também mostra se GS está concluído mas TS ainda está pendente (para mostrar estado)
        const isGsPending = job.statusGS === 'Pendente';
        const isGsCompleted = job.statusGS === 'Serviço Geral Concluído';
        const isTsPending = job.statusTS === 'Pendente';
        const isTsCompleted = job.statusTS === 'Serviço Pneus Concluído';
        const hasTs = job.statusTS !== null && job.statusTS !== undefined;
        
        // Mostra na fila do mecânico se GS está pendente OU se GS está concluído mas TS ainda está pendente
        if (state.MECHANICS.includes(job.assignedMechanic)) {
            if (isGsPending || (isGsCompleted && hasTs && isTsPending)) {
                groupedJobs[job.assignedMechanic].push(job);
            }
        }
        
        // Mostra na fila do borracheiro se TS está pendente
        // Mas também mostra se TS está concluído mas GS ainda está pendente (para mostrar estado)
        if (job.assignedTireShop === state.TIRE_SHOP_MECHANIC) {
            if (isTsPending || (isTsCompleted && isGsPending)) {
                tireShopJobs.push(job);
            }
        }
    });

    mechanicsContainer.innerHTML = '';
    
    // Se for mecânico, chama a função de renderização específica e encerra
    if (state.currentUserRole === MECANICO_ROLE) {
        renderMechanicView(jobs, groupedJobs);
        return;
    }
    monitorContainer.innerHTML = '';
    tireShopList.innerHTML = '';

    // Ordena a fila do borracheiro por prioridade (GS concluído primeiro)
    tireShopJobs.sort((a, b) => {
        const priorityA = getServicePriority(a, true); // true = para borracheiro
        const priorityB = getServicePriority(b, true);
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB; // Menor número = maior prioridade
        }
        
        // Se mesma prioridade, ordena por timestamp
        return getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp);
    });

    tireShopCount.textContent = `${tireShopJobs.length} Carros`;
    if (tireShopJobs.length > 0) {
         tireShopList.innerHTML = tireShopJobs.map(job => {
            const isGsPending = job.statusGS === 'Pendente';
            const isGsCompleted = job.statusGS === 'Serviço Geral Concluído';
            const isTsPending = job.statusTS === 'Pendente';
            
            let statusText = '';
            let statusColor = 'text-gray-500';
            
            if (isGsPending && isTsPending) {
                statusText = `(Aguardando GS: ${job.assignedMechanic})`;
                statusColor = 'text-red-500';
            } else if (isGsCompleted && isTsPending) {
                statusText = `(GS Concluído - Pronto para Pneus)`;
                statusColor = 'text-green-600';
            } else if (isGsPending && !isTsPending) {
                statusText = `(Aguardando GS: ${job.assignedMechanic})`;
                statusColor = 'text-red-500';
            }
            
            const canMarkReady = isTsPending;
            
            return `
                <li class="p-3 bg-white border-l-4 border-yellow-500 rounded-md shadow-sm flex justify-between items-center">
                    <div>
                        <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel || 'N/A'})</p>
                        <p class="text-sm ${statusColor}">${job.serviceDescription ? job.serviceDescription.substring(0, 30) + '...' : 'Avaliação'} ${statusText}</p>
                    </div>
                    <button onclick="showServiceReadyConfirmation('${job.id}', 'TS')"
                            class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            ${!canMarkReady ? 'disabled' : ''}>
                        ${canMarkReady ? 'Pronto' : 'Aguardando'}
                    </button>
                </li>
            `;
         }).join('');
    } else {
        tireShopList.innerHTML = '<p class="text-sm text-gray-500 italic p-3 border rounded-md">Nenhum carro na fila. ✅</p>';
    }

    // VISÃO DO GERENTE/VENDEDOR: Mostra todos os painéis
    if (state.MECHANICS.length === 0) {
         mechanicsContainer.innerHTML = '<p class="text-sm text-red-600 italic p-3 border rounded-md">Nenhum mecânico geral cadastrado. Por favor, adicione mecânicos na Aba de Serviços.</p>';
    }

    state.MECHANICS.forEach(mechanic => { // Para cada mecânico geral
        let mechanicJobs = groupedJobs[mechanic] || [];
        
        // Ordena a fila do mecânico por prioridade
        mechanicJobs.sort((a, b) => {
            const priorityA = getServicePriority(a, false); // false = para mecânico
            const priorityB = getServicePriority(b, false);
            
            if (priorityA !== priorityB) {
                return priorityA - priorityB; // Menor número = maior prioridade
            }
            
            // Se mesma prioridade, ordena por timestamp
            return getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp);
        });
        
        const jobListHTML = mechanicJobs.map(job => {
            const isGsPending = job.statusGS === 'Pendente';
            const isGsCompleted = job.statusGS === 'Serviço Geral Concluído';
            const isTsPending = job.statusTS === 'Pendente';
            const isTsCompleted = job.statusTS === 'Serviço Pneus Concluído';
            const hasTs = job.statusTS !== null && job.statusTS !== undefined;
            
            let statusText = '';
            let statusColor = 'text-gray-500';
            
            if (isTsPending && hasTs) {
                statusText = `(Aguardando Pneus)`;
                statusColor = 'text-orange-500';
            } else if (isGsCompleted && !hasTs) {
                statusText = `(GS Concluído)`;
                statusColor = 'text-green-600';
            } else if (isGsCompleted && isTsCompleted) {
                statusText = `(Ambos Concluídos)`;
                statusColor = 'text-green-600';
            }
            
            const canDefineService = state.currentUserRole === MANAGER_ROLE || state.currentUserRole === VENDEDOR_ROLE;
            const isDefined = job.isServiceDefined;
            const canMarkReady = isGsPending && isDefined;

            let descriptionHTML = '';
            let clickHandler = '';
            let cursorClass = '';

            if (!isDefined) {
                descriptionHTML = '<span class="font-bold text-red-600">(Aguardando Definição de Serviço)</span>';
                if (canDefineService) {
                    clickHandler = `onclick="showDefineServiceModal('${job.id}')"`;
                    cursorClass = 'cursor-pointer hover:bg-yellow-100/50 transition duration-150';
                    descriptionHTML += '<span class="text-xs text-blue-600 block">(Clique para definir)</span>';
                }
            } else {
                const serviceDesc = job.serviceDescription ? job.serviceDescription.substring(0, 30) + '...' : 'Avaliação';
                descriptionHTML = `<p class="text-sm ${statusColor}">${serviceDesc} ${statusText}</p>`;
            }

            return `
                <li class="p-3 bg-white border-l-4 border-blue-500 rounded-md shadow-sm flex justify-between items-center ${cursorClass}" ${clickHandler}>
                    <div>
                        <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel || 'N/A'})</p>
                        ${descriptionHTML}
                    </div>
                    <button onclick="event.stopPropagation(); showServiceReadyConfirmation('${job.id}', 'GS')"
                            class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            ${!canMarkReady ? 'disabled' : ''}>
                        ${canMarkReady ? 'Pronto' : (isGsCompleted ? 'Concluído' : 'Aguardando')}
                    </button>
                </li>
            `;
        }).join('');

        mechanicsContainer.innerHTML += `
            <div class="mechanic-card bg-gray-50 p-4 rounded-lg shadow-md border border-gray-100">
                <h3 class="text-xl font-bold mb-3 text-gray-800 flex justify-between items-center">
                    ${mechanic}
                    <span class="text-sm font-semibold py-1 px-3 rounded-full ${mechanicJobs.length > 1 ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800'}">
                        ${mechanicJobs.length} Carros
                    </span>
                </h3>
                <ul class="space-y-2">
                    ${jobListHTML.length > 0 ? jobListHTML : '<p class="text-sm text-gray-500 italic p-3 border rounded-md">Nenhum carro na fila. ✅</p>'}
                </ul>
            </div>
        `;

        monitorContainer.innerHTML += `
            <div class="p-6 bg-white rounded-xl shadow-lg border border-gray-200 text-center">
                <h3 class="text-2xl font-bold text-gray-800 mb-2">${mechanic}</h3>
                <p class="text-6xl font-extrabold ${mechanicJobs.length > 1 ? 'text-red-600' : 'text-blue-600'}">
                    ${mechanicJobs.length}
                </p>
                <p class="text-gray-500 mt-2">Carros Pendentes (Geral)</p>
            </div>
        `;
    });

    // Garante que o monitor do borracheiro também apareça
    monitorContainer.innerHTML += `
        <div class="p-6 bg-white rounded-xl shadow-lg border border-gray-200 text-center">
            <h3 class="text-2xl font-bold text-gray-800 mb-2">${state.TIRE_SHOP_MECHANIC}</h3>
            <p class="text-6xl font-extrabold ${tireShopJobs.length > 1 ? 'text-red-600' : 'text-blue-600'}">
                ${tireShopJobs.length}
            </p>
            <p class="text-gray-500 mt-2">Carros Pendentes (Pneus)</p>
        </div>
    `;
}

/**
 * Renderiza a visão exclusiva para o mecânico logado.
 */
function renderMechanicView(jobs, groupedJobs) {
    const mechanicViewContainer = document.getElementById('mechanic-view');
    if (!mechanicViewContainer) return;

    // CORREÇÃO: Limpa o container antes de renderizar para evitar duplicatas.
    mechanicViewContainer.innerHTML = '';

    const myName = state.userId;
    let myJobs = groupedJobs[myName] || [];
    
    // Ordena a fila do mecânico logado por prioridade
    myJobs.sort((a, b) => {
        const priorityA = getServicePriority(a, false); // false = para mecânico
        const priorityB = getServicePriority(b, false);
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB; // Menor número = maior prioridade
        }
        
        // Se mesma prioridade, ordena por timestamp
        return getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp);
    });

    const jobListHTML = myJobs.map(job => {
        const isGsPending = job.statusGS === 'Pendente';
        const isGsCompleted = job.statusGS === 'Serviço Geral Concluído';
        const isTsPending = job.statusTS === 'Pendente';
        const isTsCompleted = job.statusTS === 'Serviço Pneus Concluído';
        const hasTs = job.statusTS !== null && job.statusTS !== undefined;
        
        let statusText = '';
        let statusColor = 'text-gray-500';
        
        if (isTsPending && hasTs) {
            statusText = `(Aguardando Pneus)`;
            statusColor = 'text-orange-500';
        } else if (isGsCompleted && !hasTs) {
            statusText = `(GS Concluído)`;
            statusColor = 'text-green-600';
        } else if (isGsCompleted && isTsCompleted) {
            statusText = `(Ambos Concluídos)`;
            statusColor = 'text-green-600';
        }
        
        const isDefined = job.isServiceDefined;
        const canMarkReady = isGsPending && isDefined;
        
        const descriptionHTML = isDefined
            ? `<p class="text-sm ${statusColor}">${job.serviceDescription ? job.serviceDescription.substring(0, 30) + '...' : 'Avaliação'} ${statusText}</p>`
            : '<span class="font-bold text-red-600">(Aguardando Definição de Serviço)</span>';

        return `
            <li class="p-3 bg-white border-l-4 border-blue-500 rounded-md shadow-sm flex justify-between items-center">
                <div>
                    <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel || 'N/A'})</p>
                    ${descriptionHTML}
                </div>
                <button onclick="event.stopPropagation(); showServiceReadyConfirmation('${job.id}', 'GS')"
                        class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        ${!canMarkReady ? 'disabled' : ''}>
                    ${canMarkReady ? 'Pronto' : (isGsCompleted ? 'Concluído' : 'Aguardando')}
                </button>
            </li>
        `;
    }).join('');

    mechanicViewContainer.innerHTML = `
        <div class="p-4 md:p-8">
            <div class="mechanic-card bg-gray-50 p-6 rounded-lg shadow-lg border border-gray-200">
                <h2 class="text-2xl font-bold mb-4 text-gray-800 border-b pb-3 flex justify-between items-center">
                    Meus Serviços Pendentes
                    <span class="text-base font-semibold py-1 px-4 rounded-full ${myJobs.length > 1 ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800'}">
                        ${myJobs.length} Carro(s)
                    </span>
                </h2>
                <ul class="space-y-3">
                    ${jobListHTML.length > 0 ? jobListHTML : '<li class="text-base text-gray-500 italic p-4 border rounded-md bg-white">Nenhum carro na sua fila. ✅</li>'}
                </ul>
            </div>
        </div>
    `;
}

export function renderAlignmentQueue(cars) {
    const tableContainer = document.getElementById('alignment-table-container');
    const emptyMessage = document.getElementById('alignment-empty-message');
    const activeCars = getSortedAlignmentQueue();

    if (activeCars.length === 0) {
        tableContainer.innerHTML = '';
        emptyMessage.classList.remove('hidden');
        tableContainer.appendChild(emptyMessage);
        return;
    }
    emptyMessage.classList.add('hidden');

    const nextCarIndex = activeCars.findIndex(c => c.status === 'Aguardando');

    const tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modelo / Placa</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mover</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${activeCars.map((car, index) => {
                    const isNextWaiting = (index === nextCarIndex);
                    const isWaiting = car.status === 'Aguardando';
                    const isAttending = car.status === 'Em Atendimento';
                    const isWaitingGS = car.status === 'Aguardando Serviço Geral';

                    const statusColor = isAttending ? 'bg-yellow-100 text-yellow-800' :
                                        isWaitingGS ? 'bg-red-100 text-red-800' :
                                        'bg-blue-100 text-blue-800';

                    const gsDescriptionShort = (car.gsDescription && car.gsDescription !== "Avaliação")
                        ? car.gsDescription.substring(0, 25) + '...'
                        : 'Avaliação...';

                    const statusText = isAttending ? 'Em Atendimento' :
                                       isWaitingGS ? `Aguardando GS: ${gsDescriptionShort}` :
                                       'Disponível para Alinhar';

                    const rowClass = isWaitingGS ? 'bg-red-50/50' : (isNextWaiting ? 'bg-yellow-50/50' : '');

                    const canMove = state.currentUserRole === MANAGER_ROLE && isWaiting;
                    const waitingOnlyList = activeCars.filter(c => c.status === 'Aguardando');
                    const waitingIndex = waitingOnlyList.findIndex(c => c.id === car.id);
                    const isFirstWaiting = waitingIndex === 0;
                    const isLastWaiting = waitingIndex === waitingOnlyList.length - 1;

                    const moverButtons = `
                        <div class="flex items-center justify-center space-x-1">
                            <button onclick="moveAlignmentUp('${car.id}')" class="text-sm p-1 rounded-full text-blue-600 hover:bg-gray-200 disabled:text-gray-300 transition" ${!canMove || isFirstWaiting ? 'disabled' : ''}>&#9650;</button>
                            <button onclick="moveAlignmentDown('${car.id}')" class="text-sm p-1 rounded-full text-blue-600 hover:bg-gray-200 disabled:text-gray-300 transition" ${!canMove || isLastWaiting ? 'disabled' : ''}>&#9660;</button>
                        </div>`;

                    let actions = '';
                    const canStartService = state.currentUserRole === MANAGER_ROLE || state.currentUserRole === ALIGNER_ROLE;
                    
                    if (isAttending) {
                        // Mostra botão "Pronto" apenas para quem pode finalizar
                        if (canStartService) {
                            actions = `<button onclick="showAlignmentReadyConfirmation('${car.id}')" class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-lg hover:bg-green-600 transition min-w-[120px]">Pronto</button>`;
                        } else {
                            actions = `<span class="text-xs text-gray-400">Em atendimento...</span>`;
                        }
                    } else if (isNextWaiting && canStartService) {
                        // Mostra botão "Iniciar Atendimento" apenas para quem pode iniciar
                        actions = `<button onclick="updateAlignmentStatus('${car.id}', 'Em Atendimento')" class="text-xs font-medium bg-yellow-500 text-gray-900 py-1 px-3 rounded-lg hover:bg-yellow-600 transition min-w-[120px]">Iniciar Atendimento</button>`;
                    } else if (isNextWaiting) {
                        actions = `<span class="text-xs text-gray-400">Aguardando atendimento...</span>`;
                    } else {
                        actions = `<span class="text-xs text-gray-400">Na fila...</span>`;
                    }

                    return `
                        <tr class="${rowClass}">
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${index + 1}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                <span class="font-semibold">${car.carModel}</span>
                                <span class="text-xs text-gray-500 block">${car.licensePlate}</span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${car.customerName} (Vendedor: ${car.vendedorName || 'N/A'})</td>
                            <td class="px-6 py-4 whitespace-nowrap"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}">${statusText}</span></td>
                            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">${moverButtons}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">${actions}</td>
                        </tr>`;
                }).join('')}
            </tbody>
        </table>`;
    tableContainer.innerHTML = tableHTML;
}

export function renderAlignmentMirror(cars) {
    const mirrorContainer = document.getElementById('alignment-mirror');
    const activeCars = getSortedAlignmentQueue();

    if (activeCars.length === 0) {
        mirrorContainer.innerHTML = '<p class="text-sm text-gray-500 italic p-3 text-center">Fila de Alinhamento vazia. ✅</p>';
        return;
    }

    mirrorContainer.innerHTML = `
        <ul class="space-y-2">
            ${activeCars.map((car, index) => {
                const isWaitingGS = car.status === 'Aguardando Serviço Geral';
                const isAttending = car.status === 'Em Atendimento';
                const statusClass = isAttending ? 'bg-yellow-100 text-yellow-800' : isWaitingGS ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800';
                const gsDescriptionShort = (car.gsDescription && car.gsDescription !== "Avaliação") ? car.gsDescription.substring(0, 20) + '...' : 'Avaliação...';
                const statusText = isAttending ? 'Em Atendimento' : isWaitingGS ? `Aguardando GS (${gsDescriptionShort})` : 'Disponível';

                return `
                    <li class="p-3 bg-white rounded-md border border-gray-200 shadow-sm flex justify-between items-center text-sm">
                        <span class="font-semibold">${index + 1}. ${car.carModel} (${car.licensePlate})</span>
                        <span class="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${statusText}</span>
                    </li>`;
            }).join('')}
        </ul>`;
}

export function renderReadyJobs(serviceJobs, alignmentQueue) {
    const container = document.getElementById('ready-jobs-container');
    const emptyMessage = document.getElementById('ready-empty-message');

    const readyServiceJobs = serviceJobs.filter(job => job.status === 'Pronto para Pagamento').map(job => ({ ...job, source: 'service', sortTimestamp: getTimestampSeconds(job.timestamp) }));
    const readyAlignmentJobs = alignmentQueue.filter(car => car.status === 'Pronto para Pagamento').map(car => ({ ...car, source: 'alignment', sortTimestamp: getTimestampSeconds(car.readyAt) }));

    const readyJobs = [...readyServiceJobs, ...readyAlignmentJobs];
    readyJobs.sort((a, b) => a.sortTimestamp - b.sortTimestamp);

    if (readyJobs.length === 0) {
        container.innerHTML = '';
        emptyMessage.classList.remove('hidden');
        container.appendChild(emptyMessage);
        return;
    }
    emptyMessage.classList.add('hidden');

    const tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-100">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origem</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modelo / Placa</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente (Vendedor)</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serviço/Mecânico</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações (Gerente)</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${readyJobs.map(job => {
                    const isService = job.source === 'service';
                    const serviceInfo = isService ? job.assignedMechanic : 'Alinhador';
                    const serviceDetail = isService ? job.serviceDescription.substring(0, 50) + '...' : 'Revisão de Geometria';

                    return `
                        <tr>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium ${isService ? 'text-blue-700' : 'text-yellow-700'}">${isService ? 'Mecânica' : 'Alinhamento'}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                <span class="font-semibold">${job.carModel || 'N/A'}</span>
                                <span class="text-xs text-gray-500 block">${job.licensePlate}</span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${job.customerName} (${job.vendedorName || 'N/A'})</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${serviceInfo} (${serviceDetail})</td>
                            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <button onclick="showFinalizeConfirmation('${job.id}', '${job.source}')" class="text-sm font-medium bg-red-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-red-700 transition" ${state.currentUserRole !== MANAGER_ROLE ? 'disabled' : ''}>
                                    Finalizar e Receber
                                </button>
                            </td>
                        </tr>`;
                }).join('')}
            </tbody>
        </table>`;
    container.innerHTML = tableHTML;
}

export function calculateAndRenderDailyStats() {
    // OTIMIZAÇÃO: Usa cache de serviços finalizados hoje (já filtrados pela query)
    const finalizedServicesToday = state.finalizedToday.services || [];
    const finalizedAlignmentsToday = state.finalizedToday.alignments || [];

    // 1. Calcula o total de carros únicos (por placa) para evitar contagem dupla.
    const allFinalizedPlates = [
        ...finalizedServicesToday.map(j => j.licensePlate),
        ...finalizedAlignmentsToday.map(a => a.licensePlate)
    ];
    const uniquePlates = new Set(allFinalizedPlates.filter(Boolean));
    const totalToday = uniquePlates.size;

    // 2. Contagem específica de alinhamentos finalizados hoje.
    const alignmentCount = finalizedAlignmentsToday.length;

    // 3. Contagem de serviços por mecânico e borracheiro, apenas dos finalizados hoje.
    const mechanicStats = {};
    
    // Inicializa estatísticas para todos os mecânicos conhecidos
    if (state.MECHANICS && state.MECHANICS.length > 0) {
        state.MECHANICS.forEach(m => mechanicStats[String(m).trim()] = 0);
    }
    mechanicStats[state.TIRE_SHOP_MECHANIC] = 0;

    finalizedServicesToday.forEach(job => {
        // Conta serviço geral (GS) pelo mecânico atribuído
        if (job.assignedMechanic) {
            const mechanicName = String(job.assignedMechanic).trim();
            // Inicializa se não existir
            if (!mechanicStats.hasOwnProperty(mechanicName)) {
                mechanicStats[mechanicName] = 0;
            }
            mechanicStats[mechanicName]++;
        }
        
        // Conta serviço de pneus (TS) pelo borracheiro
        // Só conta se o serviço realmente teve troca de pneus (assignedTireShop não é null)
        if (job.assignedTireShop && String(job.assignedTireShop).trim() === state.TIRE_SHOP_MECHANIC) {
            mechanicStats[state.TIRE_SHOP_MECHANIC]++;
        }
    });

    // 4. Renderiza os resultados no HTML.
    const statsContainer = document.getElementById('stats-container');
    if (!statsContainer) return; // Proteção contra erro se elemento não existir
    
    // CORREÇÃO: Usa um Set para garantir que a lista de mecânicos seja única,
    // combinando a lista de mecânicos ativos com os que têm estatísticas, evitando duplicatas.
    const uniqueMechanics = new Set([
        ...(state.MECHANICS || []),
        ...Object.keys(mechanicStats).filter(m => m !== state.TIRE_SHOP_MECHANIC)
    ]);
    const sortedMechanics = Array.from(uniqueMechanics).sort();
    
    statsContainer.innerHTML = `
        <div class="p-4 bg-blue-100 rounded-lg shadow text-center">
            <p class="text-sm font-medium text-blue-800">TOTAL FINALIZADO (HOJE)</p>
            <p class="text-3xl font-bold text-blue-900">${totalToday}</p>
        </div>
        <div class="p-4 bg-gray-100 rounded-lg shadow text-center">
            <p class="text-sm font-medium text-gray-800">Alinhamento</p>
            <p class="text-3xl font-bold text-gray-900">${alignmentCount}</p>
        </div>
        <div class="p-4 bg-gray-100 rounded-lg shadow text-center">
            <p class="text-sm font-medium text-gray-800">${state.TIRE_SHOP_MECHANIC}</p>
            <p class="text-3xl font-bold text-gray-900">${mechanicStats[state.TIRE_SHOP_MECHANIC] || 0}</p>
        </div>
        ${sortedMechanics.map(mechanic => `
            <div class="p-4 bg-gray-100 rounded-lg shadow text-center">
                <p class="text-sm font-medium text-gray-800">${mechanic}</p>
                <p class="text-3xl font-bold text-gray-900">${mechanicStats[mechanic] || 0}</p>
            </div>`).join('')}
    `;
}

// NOVO: Função para calcular e renderizar as métricas da aba de Relatórios
export function renderReportMetrics() {
    const container = document.getElementById('reports-metrics-container');
    if (!container) return;

    // OTIMIZAÇÃO: Usa cache de serviços finalizados hoje
    const finalizedServicesToday = state.finalizedToday.services || [];
    const finalizedAlignmentsToday = state.finalizedToday.alignments || [];
    const totalFinalizedToday = finalizedServicesToday.length + finalizedAlignmentsToday.length;

    // Filtra serviços perdidos hoje (precisa buscar do estado completo ou criar query separada)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodaySeconds = Math.floor(startOfToday.getTime() / 1000);
    
    // Para serviços perdidos, filtra do estado atual (pode ser otimizado depois)
    const lostServicesToday = state.serviceJobs.filter(j => j.status === 'Perdido' && j.timestamp && getTimestampSeconds(j.timestamp) >= startOfTodaySeconds);
    const lostAlignmentsToday = state.alignmentQueue.filter(a => a.status === 'Perdido' && a.timestamp && getTimestampSeconds(a.timestamp) >= startOfTodaySeconds);
    const totalLostToday = lostServicesToday.length + lostAlignmentsToday.length;

    // 3. Calcula a taxa de desistência
    const totalOpportunities = totalFinalizedToday + totalLostToday;
    const lostRate = totalOpportunities > 0 ? ((totalLostToday / totalOpportunities) * 100).toFixed(1) : 0;

    // NOVO: Verifica se há dados para exibir. Se não, mostra uma mensagem.
    if (totalOpportunities === 0) {
        container.innerHTML = `
            <div class="col-span-full p-6 bg-gray-50 rounded-lg text-center border border-gray-200">
                <p class="text-gray-600">Não há dados de serviços finalizados ou perdidos hoje para gerar relatórios. 📊</p>
            </div>`;
        return;
    }

    // 4. Renderiza os cards
    container.innerHTML = `
        <div class="p-4 bg-red-100 rounded-lg shadow text-center border border-red-200">
            <p class="text-sm font-medium text-red-800">SERVIÇOS PERDIDOS (HOJE)</p>
            <p class="text-4xl font-bold text-red-900 mt-1">${totalLostToday}</p>
        </div>
        <div class="p-4 bg-orange-100 rounded-lg shadow text-center border border-orange-200">
            <p class="text-sm font-medium text-orange-800">TAXA DE DESISTÊNCIA</p>
            <p class="text-4xl font-bold text-orange-900 mt-1">${lostRate}%</p>
        </div>
        <!-- Outros cards podem ser adicionados aqui -->
    `;
}


// helper
export function getTimestampSeconds(timestamp) {
    if (!timestamp) return 0;
    if (timestamp.seconds) return timestamp.seconds; // Firestore Timestamp
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis() / 1000; // SDK v9
    if (typeof timestamp === 'number') return Math.floor(timestamp / 1000); // Date.now()
    return 0;
}

export function renderUserList(users) {
    const container = document.getElementById('user-list-container');
    if (!users || users.length === 0) {
        container.innerHTML = '<p class="p-4 text-center text-gray-500">Nenhum usuário cadastrado.</p>';
        return;
    }

    const tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome de Usuário</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cargo</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${users.map(user => `
                    <tr>
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${user.username}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${user.role}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button 
                                onclick="showDeleteUserConfirmation('${user.id}', '${user.username}')" 
                                class="text-red-600 hover:text-red-900 transition"
                                ${user.role === 'manager' ? 'disabled title="Não é possível excluir o gerente"' : ''}
                            >
                                Excluir
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = tableHTML;
}

export function renderRemovalList(serviceJobs, alignmentQueue) {
    const container = document.getElementById('removal-list-container');
    if (!container) return;

    // Filtra serviços ativos e remove duplicatas por ID
    const activeServiceJobs = serviceJobs
        .filter(job => {
            // Inclui serviços que estão pendentes ou têm algum serviço pendente
            const hasPendingService = job.statusGS === 'Pendente' || job.statusTS === 'Pendente';
            const isPending = job.status === 'Pendente';
            const isServiceGeneralCompleted = job.status === 'Serviço Geral Concluído';
            return (isPending || isServiceGeneralCompleted || hasPendingService) && 
                   job.status !== 'Finalizado' && 
                   job.status !== 'Perdido';
        })
        .map(job => ({ ...job, type: 'service', sortTimestamp: getTimestampSeconds(job.timestamp) }));

    const activeAlignmentJobs = alignmentQueue
        .filter(car => ['Aguardando', 'Em Atendimento', 'Aguardando Serviço Geral'].includes(car.status))
        .map(car => ({ ...car, type: 'alignment', sortTimestamp: getTimestampSeconds(car.timestamp) }));

    // Remove duplicatas por ID antes de combinar
    const uniqueServiceJobs = [];
    const seenServiceIds = new Set();
    activeServiceJobs.forEach(job => {
        if (!seenServiceIds.has(job.id)) {
            seenServiceIds.add(job.id);
            uniqueServiceJobs.push(job);
        }
    });

    const uniqueAlignmentJobs = [];
    const seenAlignmentIds = new Set();
    activeAlignmentJobs.forEach(job => {
        if (!seenAlignmentIds.has(job.id)) {
            seenAlignmentIds.add(job.id);
            uniqueAlignmentJobs.push(job);
        }
    });

    const allActiveJobs = [...uniqueServiceJobs, ...uniqueAlignmentJobs];
    allActiveJobs.sort((a, b) => b.sortTimestamp - a.sortTimestamp); // Invertido para mostrar mais recentes primeiro

    if (allActiveJobs.length === 0) {
        container.innerHTML = '<p class="p-4 text-center text-gray-500">Nenhum serviço ativo para gerenciar.</p>';
        return;
    }

    const tableHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origem</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Placa / Modelo</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status Atual</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Responsável</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${allActiveJobs.map(job => {
                    const isService = job.type === 'service';
                    const originText = isService ? 'Mecânica/Borracharia' : 'Alinhamento';
                    const originColor = isService ? 'text-blue-700' : 'text-yellow-700';
                    const responsible = isService ? job.assignedMechanic : (job.status === 'Em Atendimento' ? 'Alinhador' : 'Fila');

                    return `
                        <tr>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium ${originColor}">${originText}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${job.licensePlate} (${job.carModel})</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${job.status}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${responsible}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <button 
                                    onclick="showManagementModal('${job.id}', '${job.type}', '${job.licensePlate}')" 
                                    class="py-2 px-4 bg-gray-700 text-white font-semibold rounded-lg shadow-md hover:bg-gray-800 transition">
                                    Gerenciar
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = tableHTML;
}
