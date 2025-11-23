const CACHE_NAME = 'fila-alinhamento-cache-v4';

// Lista de arquivos essenciais para o funcionamento offline do app (App Shell).
const URLS_TO_CACHE = [
  '/',
  'index.html',
  'auth.html',
  'style.css',
  'script.js',
  'auth.js',
  'manifest.json',
  'sounds/notify.mp3',
  'icons/icon01.png', // Conforme seu manifest.json
  'icons/icon02.png'  // Conforme seu manifest.json
];

// Evento de Instalação: Salva os arquivos do App Shell em cache.
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Abrindo cache e salvando App Shell.');
        return cache.addAll(URLS_TO_CACHE);
      })
      .then(() => {
        console.log('Service Worker: Instalação concluída.');
        return self.skipWaiting(); // Força o novo SW a se tornar ativo imediatamente.
      })
  );
});

// Evento de Fetch: Intercepta as requisições de rede.
self.addEventListener('fetch', event => {
  // Ignora requisições que não são GET (ex: POST para o Firebase)
  if (event.request.method !== 'GET') {
    return;
  }

  // Ignora requisições para o Firebase Firestore para evitar problemas de cache com dados em tempo real.
  if (event.request.url.includes('firestore.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Se o recurso estiver em cache, retorna do cache.
        if (cachedResponse) {
          return cachedResponse;
        }
        // Se não, busca na rede.
        return fetch(event.request);
      })
  );
});

// Evento de Push: Chamado quando uma notificação é recebida do servidor.
self.addEventListener('push', event => {
  console.log('Service Worker: Notificação Push recebida.');

  const data = event.data.json().notification;
  const title = data.title || 'Nova Notificação';
  const options = {
    body: data.body || 'Você tem uma nova mensagem.',
    icon: data.icon || 'icons/icon-192x192.png',
    badge: 'icons/icon-192x192.png', // DICA EXTRA: Ícone monocromático que aparece na barra de status.

    // PASSO NOVO: Adiciona som e vibração para quando o app estiver fechado.
    sound: 'sounds/notify.mp3', // Caminho para o som que já está no cache.
    vibrate: [200, 100, 200], // Vibra por 200ms, pausa por 100ms, vibra por 200ms.
    // SOLUÇÃO: Força a notificação a se comportar como nova, o que ajuda a acionar o som.
    tag: 'fila-alinhamento-notification', // Agrupa notificações para não lotar a barra de status.
    renotify: true, // Faz o dispositivo vibrar/tocar som mesmo se a tag for a mesma.

    data: {
      url: data.data.url || '/'
    }
  };

  const notificationPromise = self.registration.showNotification(title, options);

  // PASSO 14 e 15: Envia uma mensagem para a página/cliente ativo para tocar o som.
  const messagePromise = self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  }).then(clients => {
    if (clients && clients.length) {
      // Envia a mensagem para todos os clientes abertos.
      console.log('Service Worker: Enviando mensagem "play-sound" para os clientes.');
      clients.forEach(client => {
        client.postMessage({ type: 'play-sound' });
      });
    }
  });

  // Espera tanto a notificação ser mostrada quanto a mensagem ser enviada.
  event.waitUntil(Promise.all([notificationPromise, messagePromise]));
});