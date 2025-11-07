
import { state } from './appState.js';
import { MANAGER_ROLE } from './auth.js';
import { getSortedAlignmentQueue } from './alignment.js';
import {
    Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


export function renderMechanicsManagement() {
    const activeMechSpan = document.getElementById('active-mechanics');
    const removeSelect = document.getElementById('mechanicToRemove');
    const manualSelect = document.getElementById('manualMechanic'); 

    const mechanicTitle = state.MECHANICS.join(', ');
    document.getElementById('mechanic-list-title').textContent = mechanicTitle;
    document.getElementById('mechanic-monitor-title').textContent = mechanicTitle;
    activeMechSpan.textContent = mechanicTitle;

    let optionsHTML = '<option value="">-- Automático --</option>';
    optionsHTML += state.MECHANICS.map(m => `<option value="${m}">${m}</option>`).join('');

    removeSelect.innerHTML = state.MECHANICS.map(m => `<option value="${m}">${m}</option>`).join('');
    manualSelect.innerHTML = optionsHTML;
}

export function renderServiceQueues(jobs) {
    const mechanicsContainer = document.getElementById('mechanics-queue-display');
    const monitorContainer = document.getElementById('mechanics-monitor');
    const tireShopList = document.getElementById('tire-shop-list');
    const tireShopCount = document.getElementById('tire-shop-count');

    mechanicsContainer.innerHTML = '';
    monitorContainer.innerHTML = '';
    tireShopList.innerHTML = '';

    const pendingJobs = jobs.filter(job => job.status === 'Pendente' || job.status === 'Serviço Geral Concluído');

    const groupedJobs = {};
    state.MECHANICS.forEach(m => groupedJobs[m] = []);
    const tireShopJobs = [];

    pendingJobs.sort((a, b) => getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp));

    jobs.forEach(job => {
        if (job.statusGS === 'Pendente' && state.MECHANICS.includes(job.assignedMechanic)) {
            groupedJobs[job.assignedMechanic].push(job);
        }
        if (job.statusTS === 'Pendente' && job.assignedTireShop === state.TIRE_SHOP_MECHANIC) {
            tireShopJobs.push(job);
        }
    });

    tireShopCount.textContent = `${tireShopJobs.length} Carros`;
    if (tireShopJobs.length > 0) {
         tireShopList.innerHTML = tireShopJobs.map(job => {
            const isGsPending = job.statusGS === 'Pendente';
            const statusText = isGsPending ? `(Aguardando GS: ${job.assignedMechanic})` : '';
            const statusColor = isGsPending ? 'text-red-500' : 'text-gray-500';
            return `
                <li class="p-3 bg-white border-l-4 border-yellow-500 rounded-md shadow-sm flex justify-between items-center">
                    <div>
                        <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel || 'N/A'})</p>
                        <p class="text-sm ${statusColor}">${job.serviceDescription.substring(0, 30)}... ${statusText}</p>
                    </div>
                    <button onclick="showServiceReadyConfirmation('${job.id}', 'TS')"
                            class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition">
                        Pronto
                    </button>
                </li>
            `;
         }).join('');
    } else {
        tireShopList.innerHTML = '<p class="text-sm text-gray-500 italic p-3 border rounded-md">Nenhum carro na fila. ✅</p>';
    }

    if (state.MECHANICS.length === 0) {
         mechanicsContainer.innerHTML = '<p class="text-sm text-red-600 italic p-3 border rounded-md">Nenhum mecânico geral cadastrado. Por favor, adicione mecânicos na Aba de Serviços.</p>';
    }

    state.MECHANICS.forEach(mechanic => { // Para cada mecânico geral
        const mechanicJobs = groupedJobs[mechanic] || [];
        const jobListHTML = mechanicJobs.map(job => {
            const isTsPending = job.statusTS === 'Pendente';
            const statusText = isTsPending ? `(Aguardando Pneus)` : '';
            const statusColor = isTsPending ? 'text-red-500' : 'text-gray-500';
            const isManager = state.currentUserRole === MANAGER_ROLE;
            const isDefined = job.isServiceDefined;

            let descriptionHTML = '';
            let clickHandler = '';
            let cursorClass = '';

            if (!isDefined) {
                descriptionHTML = '<span class="font-bold text-red-600">(Aguardando Definição de Serviço)</span>';
                if (isManager) {
                    clickHandler = `onclick="showDefineServiceModal('${job.id}')"`;
                    cursorClass = 'cursor-pointer hover:bg-yellow-100/50 transition duration-150';
                    descriptionHTML += '<span class="text-xs text-blue-600 block">(Clique para definir)</span>';
                }
            } else {
                descriptionHTML = `<p class="text-sm ${statusColor}">${job.serviceDescription.substring(0, 30)}... ${statusText}</p>`;
            }

            return `
                <li class="p-3 bg-white border-l-4 border-blue-500 rounded-md shadow-sm flex justify-between items-center ${cursorClass}" ${clickHandler}>
                    <div>
                        <p class="font-semibold text-gray-800">${job.licensePlate} (${job.carModel || 'N/A'})</p>
                        ${descriptionHTML}
                    </div>
                    <button onclick="event.stopPropagation(); showServiceReadyConfirmation('${job.id}', 'GS')"
                            class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-full hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            ${!isDefined ? 'disabled' : ''}>
                        Pronto
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
                    if (isAttending) {
                        actions = `<button onclick="showAlignmentReadyConfirmation('${car.id}')" class="text-xs font-medium bg-green-500 text-white py-1 px-3 rounded-lg hover:bg-green-600 transition min-w-[120px]">Pronto</button>`;
                    } else if (isNextWaiting) {
                        actions = `<button onclick="updateAlignmentStatus('${car.id}', 'Em Atendimento')" class="text-xs font-medium bg-yellow-500 text-gray-900 py-1 px-3 rounded-lg hover:bg-yellow-600 transition min-w-[120px]">Iniciar Atendimento</button>`;
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
    const allFinalizedJobs = [
        ...state.serviceJobs.filter(j => j.status === 'Finalizado'),
        ...state.alignmentQueue.filter(a => a.status === 'Finalizado')
    ];

    const uniquePlates = new Set(allFinalizedJobs.map(job => job.licensePlate).filter(Boolean));
    const totalToday = uniquePlates.size;

    const alignmentCount = state.alignmentQueue.filter(a => a.status === 'Finalizado').length;

    const mechanicStats = {};
    state.MECHANICS.forEach(m => mechanicStats[m] = 0);
    mechanicStats[state.TIRE_SHOP_MECHANIC] = 0;

    state.serviceJobs.filter(j => j.status === 'Finalizado').forEach(job => {
        if (job.assignedMechanic && state.MECHANICS.includes(job.assignedMechanic)) {
            mechanicStats[job.assignedMechanic]++;
        }
        if (job.assignedTireShop === state.TIRE_SHOP_MECHANIC) {
            mechanicStats[state.TIRE_SHOP_MECHANIC]++;
        }
    });

    const statsContainer = document.getElementById('stats-container');
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
            <p class="text-3xl font-bold text-gray-900">${mechanicStats[state.TIRE_SHOP_MECHANIC]}</p>
        </div>
        ${state.MECHANICS.map(mechanic => `
            <div class="p-4 bg-gray-100 rounded-lg shadow text-center">
                <p class="text-sm font-medium text-gray-800">${mechanic}</p>
                <p class="text-3xl font-bold text-gray-900">${mechanicStats[mechanic]}</p>
            </div>`).join('')}
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
