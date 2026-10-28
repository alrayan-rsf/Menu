// ============================================
// Service Worker - مطعم الريان
// ============================================
const CACHE_NAME = 'rayyan-menu-v1.2.0';
const RUNTIME_CACHE = 'rayyan-runtime-v1.2.0';

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
            // احذف النسخ القديمة التابعة لهذا الموقع فقط، ولا تلمس مخازن
            // التخزين المؤقت التي قد تستخدمها تطبيقات أخرى على النطاق نفسه.
            return Promise.all(
                cacheNames
                    .filter(name =>
                        (name.startsWith('rayyan-menu-') || name.startsWith('rayyan-runtime-')) &&
                        name !== CACHE_NAME &&
                        name !== RUNTIME_CACHE
                    )
                    .map(name => {
                        console.log('[SW] Deleting old Rayyan cache:', name);
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

    // صفحة الموقع: الشبكة أولاً لضمان وصول إصلاحات index.html المنشورة.
    // عند انقطاع الإنترنت فقط، نستخدم النسخة المخزنة كحل احتياطي.
    if (request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/index.html') {
        event.respondWith(
            fetch(request, { cache: 'no-store' }).then(response => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
                }
                return response;
            }).catch(async () => {
                const cached = await caches.match('./index.html');
                if (cached) return cached;
                throw new Error('تعذر تحميل صفحة الموقع');
            })
        );
        return;
    }

    // ملف menu.json - الشبكة أولاً، مع نسخة احتياطية للتصفح عند انقطاع الإنترنت.
    // طلبات التحقق قبل إرسال الطلب تحمل X-Require-Fresh: 1 ولا يُسمح لها باستخدام نسخة قديمة.
    if (url.pathname.endsWith('menu.json')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (!response || !response.ok) return response;
                    const responseClone = response.clone();
                    const canonicalMenuUrl = new URL('./menu.json', self.registration.scope).href;
                    caches.open(RUNTIME_CACHE).then(cache => cache.put(canonicalMenuUrl, responseClone));
                    return response;
                })
                .catch(async error => {
                    if (request.headers.get('X-Require-Fresh') === '1') throw error;
                    const canonicalMenuUrl = new URL('./menu.json', self.registration.scope).href;
                    const cached = await caches.match(canonicalMenuUrl);
                    if (cached) return cached;
                    throw error;
                })
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