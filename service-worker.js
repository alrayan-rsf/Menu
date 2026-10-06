// ============================================
// Service Worker - مطعم الريان
// ============================================
const CACHE_NAME = 'rayyan-menu-v1.0.0';
const RUNTIME_CACHE = 'rayyan-runtime-v1.0.0';

// الملفات الأساسية التي سيتم تخزينها مسبقاً
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './menu.json',
    './logo.jpg',
    './QR Code.jpg'
];

// ====== التثبيت ======
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Pre-caching app shell');
                // نستخدم addAll مع تجاهل الأخطاء للملفات غير الموجودة
                return Promise.allSettled(
                    PRECACHE_URLS.map(url => 
                        cache.add(url).catch(err => 
                            console.warn(`[SW] Failed to cache ${url}:`, err)
                        )
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ====== التنشيط ======
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// ====== استراتيجية الجلب ======
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // تجاهل الطلبات غير GET
    if (request.method !== 'GET') return;

    // تجاهل الطلبات الخارجية (مثل واتساب، خطوط Google)
    if (url.origin !== self.location.origin) {
        // استراتيجية: الشبكة أولاً مع fallback للتخزين
        event.respondWith(
            fetch(request).catch(() => caches.match(request))
        );
        return;
    }

    // ملف menu.json - الشبكة أولاً (لأنه يتغير باستمرار)
    if (url.pathname.endsWith('menu.json')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const responseClone = response.clone();
                    caches.open(RUNTIME_CACHE).then(cache => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // باقي الطلبات - Cache First مع تحديث في الخلفية
    event.respondWith(
        caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
                // تحديث في الخلفية
                fetch(request).then(response => {
                    if (response && response.status === 200) {
                        caches.open(RUNTIME_CACHE).then(cache => {
                            cache.put(request, response);
                        });
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            // غير موجود في الكاش - نجلبه من الشبكة ونخزنه
            return fetch(request).then(response => {
                if (!response || response.status !== 200 || response.type === 'opaque') {
                    return response;
                }
                const responseClone = response.clone();
                caches.open(RUNTIME_CACHE).then(cache => {
                    cache.put(request, responseClone);
                });
                return response;
            }).catch(() => {
                // fallback لصفحة index إن كان الطلب صفحة
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});

// ====== رسائل من الصفحة ======
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});