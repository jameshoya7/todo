// TaskFlow Service Worker
const CACHE_NAME = 'taskflow-v1.0.0';
const DATA_CACHE_NAME = 'taskflow-data-v1.0.0';

// Files to cache for offline functionality
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json',
  '/favicon.ico',
  // Add any other static assets your app uses
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching app shell');
        return cache.addAll(FILES_TO_CACHE);
      })
      .then(() => {
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  // Claim all clients immediately
  return self.clients.claim();
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', (event) => {
  // Handle API requests (if you add any backend APIs later)
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      caches.open(DATA_CACHE_NAME).then((cache) => {
        return fetch(event.request)
          .then((response) => {
            // If the request was successful, clone and cache the response
            if (response.status === 200) {
              cache.put(event.request.url, response.clone());
            }
            return response;
          })
          .catch(() => {
            // If fetch fails, try to get from cache
            return cache.match(event.request);
          });
      })
    );
    return;
  }

  // Handle app shell requests
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached version or fetch from network
      return response || fetch(event.request).catch(() => {
        // If both cache and network fail, return the cached index.html for SPA routing
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Background sync for offline task management (optional advanced feature)
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync-tasks') {
    console.log('[ServiceWorker] Background sync triggered');
    event.waitUntil(syncTasks());
  }
});

// Function to sync tasks when back online
async function syncTasks() {
  try {
    // Get any pending tasks from IndexedDB or localStorage
    // This would sync with a backend if you add one later
    console.log('[ServiceWorker] Syncing tasks...');
    
    // Notify all clients that sync is complete
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        message: 'Tasks synchronized successfully'
      });
    });
  } catch (error) {
    console.error('[ServiceWorker] Sync failed:', error);
  }
}

// Push notification support (for future task reminders)
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received');
  
  const options = {
    body: event.data ? event.data.text() : 'You have tasks due soon!',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'view-tasks',
        title: 'View Tasks',
        icon: '/favicon.ico'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('TaskFlow Reminder', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification clicked');
  
  event.notification.close();

  if (event.action === 'view-tasks') {
    // Open the app to view tasks
    event.waitUntil(
      clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      }).then((clientList) => {
        // If app is already open, focus it
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        
        // If app is not open, open it
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_TASK_DATA') {
    // Cache task data for offline access
    caches.open(DATA_CACHE_NAME).then((cache) => {
      cache.put('/tasks-data', new Response(JSON.stringify(event.data.tasks)));
    });
  }
});

// Periodic background sync for task reminders (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'task-reminders') {
    event.waitUntil(checkTaskReminders());
  }
});

// Check for overdue tasks and send notifications
async function checkTaskReminders() {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = await cache.match('/tasks-data');
    
    if (response) {
      const tasks = await response.json();
      const now = new Date();
      
      // Check for overdue or due-today tasks
      Object.values(tasks).flat().forEach(task => {
        if (task.dueDate) {
          const dueDate = new Date(task.dueDate);
          const timeDiff = dueDate.getTime() - now.getTime();
          const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
          
          if (daysDiff <= 0 && !task.completed) {
            // Task is overdue or due today
            self.registration.showNotification('TaskFlow - Task Due!', {
              body: `"${task.text}" is ${daysDiff === 0 ? 'due today' : 'overdue'}`,
              icon: '/favicon.ico',
              tag: `task-${task.id}`,
              requireInteraction: true
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('[ServiceWorker] Task reminder check failed:', error);
  }
}

// Error handling
self.addEventListener('error', (event) => {
  console.error('[ServiceWorker] Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[ServiceWorker] Unhandled promise rejection:', event.reason);
});
