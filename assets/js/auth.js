// assets/js/auth.js
import { state } from './appState.js';
import { initializeFirebase } from './firebaseConfig.js';
import {
  renderMechanicsManagement,
  renderServiceQueues,
  renderAlignmentQueue,
  renderAlignmentMirror,
  renderReadyJobs,
  calculateAndRenderDailyStats
} from './uiRender.js';
import { setupRealtimeListeners } from './services.js';

export const USER_CREDENTIALS = {
  'gerente.outlet': { password: 'gerenteitapoa', role: 'manager' },
  'alinhador': { password: 'alinhador123', role: 'aligner' }
};
export const MANAGER_ROLE = 'manager';
export const ALIGNER_ROLE = 'aligner';

export function postLoginSetup(username, role) {
  state.isLoggedIn = true;
  state.currentUserRole = role;
  state.userId = username;

  // Interface
  document.getElementById('login-container').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
  document.getElementById('user-info').textContent = `Usuário: ${username} | Cargo: ${role.toUpperCase()}`;

  const mechanicTitle = state.MECHANICS.join(', ');
  document.getElementById('mechanic-list-title').textContent = mechanicTitle;
  document.getElementById('mechanic-monitor-title').textContent = mechanicTitle;

  // Controle de abas
  const tabServicos = document.getElementById('tab-servicos');
  const tabAlinhamento = document.getElementById('tab-alinhamento');
  const tabMonitor = document.getElementById('tab-monitor');
  
  const contentServicos = document.getElementById('servicos');
  const contentAlinhamento = document.getElementById('alinhamento');
  const contentMonitor = document.getElementById('monitor');
  const mechMgmt = document.getElementById('mechanic-management');

  if (role === ALIGNER_ROLE) {
    tabServicos.classList.add('aligner-hidden');
    tabMonitor.classList.add('aligner-hidden');
    contentServicos.classList.remove('active');
    contentMonitor.classList.remove('active');
    
    tabAlinhamento.classList.add('active');
    contentAlinhamento.classList.add('active');
    mechMgmt.classList.add('hidden');
  } else if (role === MANAGER_ROLE) {
    tabServicos.classList.remove('aligner-hidden');
    tabMonitor.classList.remove('aligner-hidden');
    
    tabServicos.classList.add('active');
    contentServicos.classList.add('active');
    tabAlinhamento.classList.remove('active');
    contentAlinhamento.classList.remove('active');
    mechMgmt.classList.remove('hidden');
  }

  renderMechanicsManagement();

  // 🔥 Ativa os listeners Firestore após login
  if (state.isAuthReady) {
    try {
      setupRealtimeListeners();
      console.log("📡 Firestore listeners iniciados.");
    } catch (e) {
      console.warn("Erro ao iniciar listeners:", e);
    }
  }

  // Renderização inicial
  renderServiceQueues(state.serviceJobs);
  renderAlignmentQueue(state.alignmentQueue);
  renderAlignmentMirror(state.alignmentQueue);
  renderReadyJobs(state.serviceJobs, state.alignmentQueue);
  calculateAndRenderDailyStats();
}

export function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorElement = document.getElementById('login-error');
  errorElement.textContent = '';

  const user = USER_CREDENTIALS[username];
  if (user && user.password === password) {
    postLoginSetup(username, user.role);
  } else {
    errorElement.textContent = 'Credenciais inválidas. Tente novamente.';
  }
}

export function handleLogout() {
  state.isLoggedIn = false;
  state.currentUserRole = null;
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('login-form').reset();
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-container').classList.remove('hidden');
}
