import { initializeApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging, getToken } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

async function getFcmToken(): Promise<string | null> {
  const messaging = getMessaging(app)
  const swReg = await navigator.serviceWorker.ready
  return await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: swReg
  }) ?? null
}

export async function requestNotificationToken(): Promise<string | null> {
  if (!('Notification' in window)) return null
  try {
    return await getFcmToken()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // "push service error" = OS/browser blocking push, not fixable by retrying
      if (err.message.toLowerCase().includes('push service')) return null
      // Otherwise assume stale subscription from a previous VAPID key — clear and retry once
      try {
        const swReg = await navigator.serviceWorker.ready
        const sub = await swReg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
        return await getFcmToken()
      } catch {
        return null
      }
    }
    console.error('[FCM] getToken failed:', err)
    return null
  }
}

// Secondary app instance used to create Auth accounts without signing out
// the currently logged-in admin.
const secondaryApp = initializeApp(firebaseConfig, 'secondary')
const secondaryAuth = getAuth(secondaryApp)

// Creates a Firebase Auth account for the given email (if one doesn't already
// exist) and sends a password-setup email so the user can set their own password.
export async function createAuthAccount(email: string): Promise<void> {
  const tempPassword = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  try {
    await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword)
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'auth/email-already-in-use') throw err
  } finally {
    await secondaryAuth.signOut()
  }

  try {
    await sendPasswordResetEmail(auth, email, {
      url: window.location.origin,
      handleCodeInApp: false
    })
  } catch {
    // Non-fatal: password reset email failed but Auth account was created.
    // User can request a reset manually.
  }
}
