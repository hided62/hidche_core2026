const ALLOWED_NOTIFICATION_PATH = /^\/(?:gateway|che|hwe|kwe|pwe|twe|nya|pya)(?:\/|$)/u;

const safeNotificationUrl = (value) => {
    try {
        const url = new URL(typeof value === 'string' ? value : '/gateway/', self.location.origin);
        if (url.origin !== self.location.origin || !ALLOWED_NOTIFICATION_PATH.test(url.pathname)) {
            return '/gateway/';
        }
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return '/gateway/';
    }
};

self.addEventListener('push', (event) => {
    let payload;
    try {
        payload = event.data?.json() ?? {};
    } catch {
        payload = {};
    }
    const title = typeof payload.title === 'string' ? payload.title : '삼국지 모의전투';
    const body = typeof payload.body === 'string' ? payload.body : '새 알림이 있습니다.';
    const tag = typeof payload.tag === 'string' ? payload.tag : 'sammo-notification';
    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            tag,
            icon: './web-push-icon.svg',
            badge: './web-push-icon.svg',
            data: { url: safeNotificationUrl(payload.url) },
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetPath = safeNotificationUrl(event.notification.data?.url);
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
            const targetUrl = new URL(targetPath, self.location.origin).href;
            for (const client of clients) {
                if (new URL(client.url).origin !== self.location.origin) continue;
                await client.navigate(targetUrl);
                return client.focus();
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});
