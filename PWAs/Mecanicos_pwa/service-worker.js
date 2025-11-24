const CACHE_NAME = 'mecanicos-pwa-cache-v2'; // Atualizei a versão para garantir a recarga

// Separa os recursos locais dos externos
const localUrlsToCache = [
  '/',
  'index.html',
  'auth.html',
  'style.css',
  'script.js',
  'auth.js',
  'push.js',
  'manifest.json',
  'icons/icon01.png',
  'icons/icon02.png',
  'sounds/notify.mp3'
];

const externalUrlsToCache = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap'
];

// Evento de Instalação: Salva os arquivos estáticos no cache.
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache aberto.');
        
        // 1. Cacheia os recursos locais
        const localCachePromise = cache.addAll(localUrlsToCache);

        // 2. Cacheia os recursos externos com o modo 'no-cors'
        const externalCachePromises = externalUrlsToCache.map(url => {
          const request = new Request(url, { mode: 'no-cors' });
          return fetch(request).then(response => cache.put(request, response));
        });

        // Aguarda todas as operações de cache terminarem
        return Promise.all([localCachePromise, ...externalCachePromises]);
      })
      .then(() => self.skipWaiting()) // Força o novo service worker a se tornar ativo imediatamente.
  );
});

// Evento de Ativação: Limpa caches antigos.
self.addEventListener('activate', event => {
  console.log('Service Worker: Ativando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Limpando cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Torna-se o controlador para todos os clientes no escopo.
});

// Evento de Fetch: Responde com os dados do cache ou busca na rede.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Se o recurso estiver no cache, retorna ele. Senão, busca na rede.
        return response || fetch(event.request);
      })
  );
});

// Evento de Push: Recebe a notificação do servidor e a exibe.
self.addEventListener('push', event => {
  console.log('Service Worker: Notificação push recebida.');

  let notificationData = {};
  try {
    // O backend envia { notification: { ... } } ou direto { title: ... }
    const json = event.data.json();
    notificationData = json.notification || json;
  } catch (e) {
    console.error('Erro ao parsear dados da notificação:', e);
    notificationData = {
      title: 'Nova Notificação',
      body: 'Você tem uma nova mensagem.',
      icon: 'icons/icon01.png'
    };
  }

  const title = notificationData.title;
  const options = {
    body: notificationData.body,
    icon: notificationData.icon || 'icons/icon01.png',
    badge: 'icons/icon02.png',
    data: notificationData.data,
    // Mantemos 'sound' como fallback para navegadores que suportam
    sound: 'sounds/notify.mp3',  
    vibrate: [200, 100, 200],
    requireInteraction: true,
    tag: 'mechanic-notification', // Evita pilhas de notificações repetidas
    renotify: true
  };

  // AQUI ESTÁ A CORREÇÃO DO SOM:
  event.waitUntil(
    self.registration.showNotification(title, options)
    .then(() => {
        // Tenta encontrar as janelas abertas deste PWA
        return self.clients.matchAll({type: 'window', includeUncontrolled: true});
    })
    .then(clients => {
        // Se houver janelas abertas, manda ordem para tocar o som via JS
        if (clients && clients.length) {
            clients.forEach(client => client.postMessage({ type: 'PLAY_SOUND' }));
        }
    })
    .catch(err => console.error('Erro ao exibir notificação:', err))
  );
});

// Evento de Clique na Notificação: Abre o PWA quando o usuário clica.
self.addEventListener('notificationclick', event => {
  console.log('Service Worker: Clique na notificação recebido.');

  // Fecha a notificação
  event.notification.close();

  // Abre a janela do aplicativo
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Se uma janela do PWA já estiver aberta, foca nela.
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Se nenhuma janela estiver aberta, abre uma nova.
      if (clients.openWindow) {
        const urlToOpen = event.notification.data?.url || '/';
        return clients.openWindow(urlToOpen);
      }
    })
  );
});