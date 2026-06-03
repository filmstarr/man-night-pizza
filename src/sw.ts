/// <reference lib="WebWorker" />
/// <reference types="vite/client" />

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

const messaging = getMessaging(firebaseApp)

onBackgroundMessage(messaging, async payload => {
  const title = payload.data?.['title'] ?? 'Man Night Pizza'
  const body = payload.data?.['body'] ?? ''
  const type = payload.data?.['type'] ?? ''

  const existing = await self.registration.getNotifications()
  if ('setAppBadge' in navigator) navigator.setAppBadge(existing.length + 1).catch(() => {})

  return self.registration.showNotification(title, {
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    data: { type }
  })
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {})
  event.notification.close()
  const type: string = (event.notification.data?.type as string) ?? ''
  const link = type === 'chat'
    ? `${self.location.origin}/?chat=1`
    : `${self.location.origin}/`

  event.waitUntil((async () => {
    // Write a Cache API flag so the app can detect the notification on resume
    // even if the page was frozen/suspended and missed the BroadcastChannel.
    if (type === 'chat') {
      try {
        const cache = await caches.open('sw-flags')
        await cache.put('/pending-notification', new Response(
          JSON.stringify({ type, ts: Date.now() }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
      } catch {}

      // Fast path: broadcast to any active page instances.
      const bc = new BroadcastChannel('sw-notifications')
      bc.postMessage({ notificationType: type })
      bc.close()
    }

    await self.registration.getNotifications().then(ns => ns.forEach(n => n.close()))

    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windowClients.find(c => c.url.startsWith(self.location.origin))
    if (existing && 'focus' in existing) {
      return (existing as WindowClient).focus()
    }
    return clients.openWindow(link)
  })())
})
