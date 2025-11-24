// Aumentei para v8 para forçar a atualização imediata e limpar o cache antigo
const CACHE_NAME = 'fila-alinhamento-cache-v8';

const urlsToCache = [
  '/',
  'index.html',
  'style.css',
  'script.js',
  'auth.js',
  'push.js',
  'auth.html',
  'manifest.json',
  'icons/icon01.png',
  'icons/icon02.png',
  'sounds/notify.mp3'
];

// =========================================================================
// INSTALAÇÃO: Cacheia os arquivos iniciais
// =========================================================================
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando...');
  self.skipWaiting(); // Força a instalação imediata
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache aberto.');
        return cache.addAll(urlsToCache);
      })
  );
});

// =========================================================================
// ATIVAÇÃO E LIMPEZA (IGUAL AOS MECÂNICOS)
// =========================================================================
self.addEventListener('activate', event => {
  console.log('Service Worker: Ativando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          // Se o cache não for o da versão atual (v8), deleta!
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Limpando cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Assume o controle das páginas imediatamente
});

// =========================================================================
// INTERCEPTAÇÃO DE REDE (Cache First)
// =========================================================================
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Retorna do cache se existir, senão busca na rede
        return response || fetch(event.request);
      })
  );
});

// =========================================================================
// PUSH NOTIFICATION (COM SOM ALTO)
// =========================================================================
self.addEventListener('push', event => {
  console.log('Service Worker: Push recebido.');
  
  let data = {};
  if (event.data) {
    try {
      const json = event.data.json();
      data = json.notification || json; 
    } catch (e) {
      console.error('Erro ao ler JSON do push:', e);
      data = { title: 'Alinhamento', body: event.data.text() };
    }
  }

  const title = data.title || 'Nova Notificação';
  const options = {
    body: data.body,
    icon: 'icons/icon-192x192.png',
    badge: 'icons/icon01.png',
    vibrate: [200, 100, 200, 100, 200, 100, 500], // Vibração bem longa para chamar atenção
    tag: 'alinhamento-notification',
    renotify: true,
    data: { url: '/' },
    sound: 'sounds/notify.mp3' // Fallback
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
    .then(() => {
        // Manda o sinal para a página tocar o áudio via HTML5 (Ouvido pelo script.js)
        return self.clients.matchAll({type: 'window', includeUncontrolled: true});
    })
    .then(clients => {
        if (clients && clients.length) {
            clients.forEach(client => client.postMessage({ type: 'PLAY_SOUND' }));
        }
    })
  );
});

self.addEventListener('notificationclick', event => {
  console.log('Service Worker: Notificação clicada.');
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});