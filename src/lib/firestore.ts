import { httpsCallable } from 'firebase/functions'
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDoc,
  getDocs,
  addDoc,
  query,
  orderBy,
  limitToLast,
  endBefore,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore'
import { db, fns, createAuthAccount } from './firebase'
import type { User, AppState, PizzaOrder, OrderSnapshot, ChatMessage, QuotedMessage } from '../types'
import { EMPTY_PIZZA } from '../types'

const USERS_COLLECTION = 'users'
const ALLOWED_EMAILS_COLLECTION = 'allowedEmails'
const APP_STATE_DOC = 'appState/main'
const MESSAGES_COLLECTION = 'messages'

// ─── Users ───────────────────────────────────────────────────────────────────

export function subscribeToUsers(callback: (users: User[]) => void) {
  return onSnapshot(collection(db, USERS_COLLECTION), snapshot => {
    const users = snapshot.docs.map(d => {
      const data = d.data() as Record<string, unknown>
      // Normalize legacy single-email field to emails array
      if (typeof data.email === 'string') {
        data.emails = data.email ? [data.email] : []
        delete data.email
      }
      if (!Array.isArray(data.emails)) data.emails = []
      return { id: d.id, ...data } as User
    })
    users.sort((a, b) => a.name.localeCompare(b.name))
    callback(users)
  })
}

export async function addUser(data: Omit<User, 'id' | 'createdAt'>) {
  const ref = doc(collection(db, USERS_COLLECTION))
  const emails = data.emails.map(e => e.toLowerCase().trim()).filter(Boolean)
  await Promise.all([
    setDoc(ref, { ...data, emails, createdAt: Date.now() }),
    ...emails.map(e => setDoc(doc(db, ALLOWED_EMAILS_COLLECTION, e), {}))
  ])
  await Promise.all(emails.map(e => createAuthAccount(e)))
  return ref.id
}

export async function updateUser(id: string, data: Partial<User>, previousEmails?: string[]) {
  const firestoreOps: Promise<unknown>[] = [
    updateDoc(doc(db, USERS_COLLECTION, id), data as Record<string, unknown>)
  ]
  const newAuthEmails: string[] = []
  if (data.emails !== undefined) {
    const newEmails = data.emails.map(e => e.toLowerCase().trim()).filter(Boolean)
    const oldEmails = (previousEmails ?? []).map(e => e.toLowerCase().trim()).filter(Boolean)
    const added = newEmails.filter(e => !oldEmails.includes(e))
    const removed = oldEmails.filter(e => !newEmails.includes(e))
    for (const e of added) {
      firestoreOps.push(setDoc(doc(db, ALLOWED_EMAILS_COLLECTION, e), {}))
      newAuthEmails.push(e)
    }
    for (const e of removed) {
      firestoreOps.push(deleteDoc(doc(db, ALLOWED_EMAILS_COLLECTION, e)))
    }
  }
  await Promise.all(firestoreOps)
  await Promise.all(newAuthEmails.map(e => createAuthAccount(e)))
}

export async function deleteUser(id: string) {
  const snap = await getDoc(doc(db, USERS_COLLECTION, id))
  const data = snap.exists() ? snap.data() : null
  const emails: string[] = data
    ? Array.isArray(data.emails) ? data.emails : (data.email ? [data.email] : [])
    : []
  await Promise.all([
    deleteDoc(doc(db, USERS_COLLECTION, id)),
    ...emails.map(e => deleteDoc(doc(db, ALLOWED_EMAILS_COLLECTION, e)))
  ])
}

export async function setUserPresent(id: string, isPresent: boolean) {
  await updateDoc(doc(db, USERS_COLLECTION, id), { isPresent })
}

export async function setUserSharing(id: string, isSharing: boolean) {
  await updateDoc(doc(db, USERS_COLLECTION, id), { isSharing })
}

export async function setUserCurrentPizza(id: string, pizza: PizzaOrder, overridden = true) {
  await updateDoc(doc(db, USERS_COLLECTION, id), { currentPizza: pizza, pizzaOverridden: overridden })
}

export async function adjustBalance(id: string, amount: number) {
  const snap = await getDoc(doc(db, USERS_COLLECTION, id))
  if (!snap.exists()) return
  const user = snap.data() as User
  await updateDoc(doc(db, USERS_COLLECTION, id), {
    balance: Math.round((user.balance + amount) * 100) / 100
  })
}

export async function saveFcmToken(userId: string, token: string): Promise<void> {
  await updateDoc(doc(db, USERS_COLLECTION, userId), { fcmTokens: arrayUnion(token) })
}

export async function removeFcmToken(userId: string, token: string): Promise<void> {
  await updateDoc(doc(db, USERS_COLLECTION, userId), { fcmTokens: arrayRemove(token) })
}

export async function setChatNotificationsEnabled(userId: string, enabled: boolean): Promise<void> {
  await updateDoc(doc(db, USERS_COLLECTION, userId), { chatNotificationsEnabled: enabled })
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  const snap = await getDoc(doc(db, ALLOWED_EMAILS_COLLECTION, email.toLowerCase().trim()))
  return snap.exists()
}

// Ensures every user in the users collection has an allowedEmails entry.
// Runs once on login to backfill any users added before this sync existed.
export async function syncAllowedEmails() {
  const snap = await getDocs(collection(db, USERS_COLLECTION))
  await Promise.all(
    snap.docs.flatMap(d => {
      const data = d.data()
      const emails: string[] = Array.isArray(data.emails)
        ? data.emails
        : (data.email ? [data.email] : [])
      return emails
        .map(e => e?.toLowerCase().trim())
        .filter(Boolean)
        .map(e => setDoc(doc(db, ALLOWED_EMAILS_COLLECTION, e), {}, { merge: true }))
    })
  )
}

// ─── App State ────────────────────────────────────────────────────────────────

export function subscribeToAppState(callback: (state: AppState) => void) {
  return onSnapshot(doc(db, APP_STATE_DOC), snapshot => {
    if (snapshot.exists()) {
      callback(snapshot.data() as AppState)
    } else {
      callback({ nextOrdererId: null })
    }
  })
}

export async function updateAppState(data: Partial<AppState>) {
  await setDoc(doc(db, APP_STATE_DOC), data, { merge: true })
}

// ─── Order Processing ─────────────────────────────────────────────────────────

export async function processOrder(
  users: User[],
  totalAmount: number,
  payerId: string
): Promise<OrderSnapshot> {
  const presentUsers = users.filter(u => u.isPresent)
  if (presentUsers.length === 0) throw new Error('No users present')

  const individualAmount = Math.round((totalAmount / presentUsers.length) * 100) / 100
  const shortFall = Math.round((totalAmount - individualAmount * presentUsers.length) * 100) / 100

  const snapshot: OrderSnapshot = {
    timestamp: Date.now(),
    totalAmount,
    payerId,
    userSnapshots: users
      .filter(u => u.name)
      .map(u => ({
        userId: u.id,
        balanceBefore: u.balance,
        pizzaBefore: u.currentPizza,
        wasPresentBefore: u.isPresent
      }))
  }

  const updates = users
    .filter(u => u.name)
    .map(async u => {
      let newBalance = u.balance
      if (u.isPresent) {
        newBalance = Math.round((newBalance - individualAmount) * 100) / 100
      }
      if (u.id === payerId) {
        newBalance = Math.round((newBalance + totalAmount - shortFall) * 100) / 100
      }
      await updateDoc(doc(db, USERS_COLLECTION, u.id), {
        balance: newBalance,
        currentPizza: u.defaultPizza,
        isPresent: true,
        isSharing: false,
        pizzaOverridden: false
      })
    })

  await Promise.all(updates)

  const updatedUsers = await Promise.all(
    users.filter(u => u.name).map(async u => {
      const snap = await getDoc(doc(db, USERS_COLLECTION, u.id))
      return { id: snap.id, ...snap.data() } as User
    })
  )

  await updateAppState({ nextOrdererId: getNextOrderer(updatedUsers) })

  return snapshot
}

export async function undoLastOrder(snapshot: OrderSnapshot) {
  await Promise.all(
    snapshot.userSnapshots.map(s =>
      updateDoc(doc(db, USERS_COLLECTION, s.userId), {
        balance: s.balanceBefore,
        currentPizza: s.pizzaBefore,
        isPresent: s.wasPresentBefore
      })
    )
  )
}

export async function resetAllBalances(users: User[]) {
  await Promise.all(
    users.filter(u => u.name).map(u =>
      updateDoc(doc(db, USERS_COLLECTION, u.id), { balance: 0 })
    )
  )
}

export async function resetAllOrders(users: User[]) {
  await Promise.all(
    users.filter(u => u.name).map(u =>
      updateDoc(doc(db, USERS_COLLECTION, u.id), {
        currentPizza: u.defaultPizza,
        pizzaOverridden: false,
        isSharing: false
      })
    )
  )
}

// ─── Next Orderer Logic ───────────────────────────────────────────────────────

export function getNextOrderer(users: User[]): string | null {
  const present = users.filter(u => u.isPresent && u.name)
  if (present.length === 0) return null
  return [...present].sort((a, b) => a.balance - b.balance)[0].id
}

export async function recomputeNextOrderer(users: User[]) {
  await updateAppState({ nextOrdererId: getNextOrderer(users) })
}



// ─── Chat Messages ───────────────────────────────────────────────────────────

export function subscribeToMessages(callback: (messages: ChatMessage[]) => void) {
  return onSnapshot(
    query(collection(db, MESSAGES_COLLECTION), orderBy('createdAt', 'asc'), limitToLast(100)),
    snapshot => {
      callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)))
    }
  )
}

export async function loadMoreMessages(beforeTimestamp: number): Promise<ChatMessage[]> {
  const snap = await getDocs(
    query(
      collection(db, MESSAGES_COLLECTION),
      orderBy('createdAt', 'asc'),
      endBefore(beforeTimestamp),
      limitToLast(100)
    )
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage))
}

export async function sendMessage(userId: string, text: string, quotedMessage?: QuotedMessage): Promise<void> {
  const data: Record<string, unknown> = { userId, text, createdAt: Date.now() }
  if (quotedMessage) data.quotedMessage = quotedMessage
  await addDoc(collection(db, MESSAGES_COLLECTION), data)
}

export async function notifyReaction(reactorUserId: string, reactorName: string, messageAuthorUserId: string, emoji: string): Promise<void> {
  await httpsCallable(fns, 'sendReactionNotification')({ reactorUserId, reactorName, messageAuthorUserId, emoji })
}

export async function addReaction(messageId: string, emoji: string, userId: string): Promise<void> {
  await updateDoc(doc(db, MESSAGES_COLLECTION, messageId), {
    [`reactions.${emoji}`]: arrayUnion(userId)
  })
}

export async function removeReaction(messageId: string, emoji: string, userId: string): Promise<void> {
  await updateDoc(doc(db, MESSAGES_COLLECTION, messageId), {
    [`reactions.${emoji}`]: arrayRemove(userId)
  })
}

export async function deleteMessage(messageId: string): Promise<void> {
  await updateDoc(doc(db, MESSAGES_COLLECTION, messageId), { deleted: true })
}

export async function editMessage(messageId: string, text: string): Promise<void> {
  await updateDoc(doc(db, MESSAGES_COLLECTION, messageId), { text, edited: true })
}

export async function markMessagesRead(userId: string): Promise<void> {
  await updateDoc(doc(db, USERS_COLLECTION, userId), { lastReadAt: Date.now() })
}

export async function clearMessages(): Promise<void> {
  const snap = await getDocs(collection(db, MESSAGES_COLLECTION))
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

export { EMPTY_PIZZA }
