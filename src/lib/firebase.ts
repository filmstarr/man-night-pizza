import { initializeApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

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
