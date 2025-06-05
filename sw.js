const CACHE_NAME = 'fluxodriver-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com'
];

// Install service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Activate service worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch from cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;

  if (action === 'register' || action === 'open') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === '/' && 'focus' in client) {
            client.focus();
            client.postMessage({ action: 'navigate', section: 'records' });
            return;
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  } else if (action === 'later') {
    scheduleDelayedReminder();
  }
});

// Push message handler
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'Nova atualização disponível!',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'open',
        title: 'Abrir App',
        icon: '/icon-192x192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('FLUXODRIVER', options)
  );
});

// Schedule delayed reminder
function scheduleDelayedReminder() {
  setTimeout(() => {
    self.registration.showNotification('FLUXODRIVER - Lembrete', {
      body: 'Não se esqueça de registrar seus ganhos hoje!',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      vibrate: [200, 100, 200],
      tag: 'delayed-reminder',
      requireInteraction: true,
      actions: [
        {
          action: 'register',
          title: 'Registrar Agora',
          icon: '/icon-192x192.png'
        }
      ]
    });
  }, 2 * 60 * 60 * 1000); // 2 hours
}

// Background sync for offline data
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  try {
    const records = await getStoredRecords();
    if (records.length > 0) {
      await uploadRecords(records);
      await clearStoredRecords();
    }
  } catch (error) {
    console.log('Sync failed:', error);
  }
}

// IndexedDB operations for offline storage
async function getStoredRecords() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fluxodriver-offline', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['records'], 'readonly');
      const store = transaction.objectStore('records');
      const getAll = store.getAll();
      
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    };
    
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function uploadRecords(records) {
  const clients = await self.clients.matchAll();
  if (clients.length === 0) return;

  for (const record of records) {
    try {
      clients[0].postMessage({
        action: 'uploadOfflineRecord',
        record: record
      });
    } catch (error) {
      console.log('Upload failed for record:', record.id);
    }
  }
}

async function clearStoredRecords() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fluxodriver-offline', 1);
    
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['records'], 'readwrite');
      const store = transaction.objectStore('records');
      const clear = store.clear();
      
      clear.onsuccess = () => resolve();
      clear.onerror = () => reject(clear.error);
    };
  });
}

console.log('SW registered: Service Worker loaded successfully');