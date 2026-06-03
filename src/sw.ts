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

  const existing = await self.registration.getNotifications()
  if ('setAppBadge' in navigator) navigator.setAppBadge(existing.length + 1).catch(() => {})

  return self.registration.showNotification(title, {
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    data: { link: 'https://mannightpizza.web.app/' }
  })
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {})
  const link: string = (event.notification.data?.link as string) ?? 'https://mannightpizza.web.app/'
  event.waitUntil(
    Promise.all([
      self.registration.getNotifications().then(ns => ns.forEach(n => n.close())),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
        const existing = windowClients.find(c => c.url.startsWith('https://mannightpizza.web.app'))
        if (existing && 'focus' in existing) return (existing as WindowClient).focus()
        return clients.openWindow(link)
      })
    ])
  )
})
