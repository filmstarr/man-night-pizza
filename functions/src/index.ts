import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()

interface NotifyRequest {
  userId: string
  senderName?: string
  absentUserId?: string
}

interface NotifyResponse {
  success: boolean
  ordererHasNoTokens: boolean
}

export const sendTestNotification = onCall(
  { region: 'europe-west1', cors: true, invoker: 'public' },
  async (request): Promise<NotifyResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to send notifications.')
    }

    // Verify caller is an admin
    const callerEmail = request.auth.token.email
    if (!callerEmail) {
      throw new HttpsError('permission-denied', 'No email on auth token.')
    }
    const usersSnap = await db.collection('users').get()
    const callerDoc = usersSnap.docs.find(d => {
      const emails: string[] = Array.isArray(d.data().emails) ? d.data().emails : []
      return emails.some(e => e.toLowerCase() === callerEmail.toLowerCase())
    })
    if (!callerDoc?.data().isAdmin) {
      throw new HttpsError('permission-denied', 'Only admins can send test notifications.')
    }

    // Collect FCM tokens from admin users only
    const tokenUserMap = new Map<string, string>()
    const adminTokens: string[] = []
    for (const userDoc of usersSnap.docs) {
      if (!userDoc.data().isAdmin) continue
      const tokens: string[] = Array.isArray(userDoc.data().fcmTokens) ? userDoc.data().fcmTokens : []
      for (const token of tokens) {
        tokenUserMap.set(token, userDoc.id)
        adminTokens.push(token)
      }
    }

    if (adminTokens.length === 0) {
      return { success: false, ordererHasNoTokens: true }
    }

    const message: admin.messaging.MulticastMessage = {
      tokens: adminTokens,
      data: {
        title: 'Notification Test',
        body: 'Push notifications are working! ✓'
      },
      webpush: {
        fcmOptions: { link: 'https://mannightpizza.web.app/' }
      }
    }

    const response = await admin.messaging().sendEachForMulticast(message)

    // Clean up stale tokens
    const staleByUser = new Map<string, string[]>()
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const token = adminTokens[idx]
          const uid = tokenUserMap.get(token)!
          if (!staleByUser.has(uid)) staleByUser.set(uid, [])
          staleByUser.get(uid)!.push(token)
        }
      }
    })

    if (staleByUser.size > 0) {
      await Promise.all(
        [...staleByUser.entries()].map(([uid, tokens]) =>
          db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens)
          })
        )
      )
    }

    return { success: response.successCount > 0, ordererHasNoTokens: false }
  }
)

export const sendOrderNotification = onCall(
  { region: 'europe-west1', cors: true, invoker: 'public' },
  async (request): Promise<NotifyResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to send notifications.')
    }

    const { userId, senderName, absentUserId } = request.data as NotifyRequest
    if (!userId || typeof userId !== 'string') {
      throw new HttpsError('invalid-argument', 'userId is required.')
    }

    const usersSnap = await db.collection('users').get()

    // Build token → userId map and collect all tokens
    const tokenUserMap = new Map<string, string>()
    const allTokens: string[] = []
    let ordererHasNoTokens = true

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data()
      const tokens: string[] = Array.isArray(data.fcmTokens) ? data.fcmTokens : []
      if (userDoc.id === userId && tokens.length > 0) ordererHasNoTokens = false
      for (const token of tokens) {
        tokenUserMap.set(token, userDoc.id)
        allTokens.push(token)
      }
    }

    if (allTokens.length === 0) {
      return { success: false, ordererHasNoTokens: true }
    }

    const ordererDoc = usersSnap.docs.find(d => d.id === userId)
    const ordererName: string = ordererDoc?.data().name ?? 'Someone'

    let title: string
    let body: string
    if (absentUserId && senderName) {
      const absentName: string = usersSnap.docs.find(d => d.id === absentUserId)?.data().name ?? 'Someone'
      title = 'Pizza Imagineer Updated'
      body = `${senderName} says that ${absentName} isn't attending. It's now ${ordererName}'s turn to order. 🍕`
    } else {
      title = 'New Pizza Solution Architect'
      body = `It's ${ordererName}'s turn to order next 🍕`
    }

    const message: admin.messaging.MulticastMessage = {
      tokens: allTokens,
      data: { title, body },
      webpush: {
        fcmOptions: {
          link: 'https://mannightpizza.web.app/'
        }
      }
    }

    const response = await admin.messaging().sendEachForMulticast(message)

    // Clean up stale tokens grouped by user
    const staleByUser = new Map<string, string[]>()
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const token = allTokens[idx]
          const uid = tokenUserMap.get(token)!
          if (!staleByUser.has(uid)) staleByUser.set(uid, [])
          staleByUser.get(uid)!.push(token)
        }
      }
    })

    if (staleByUser.size > 0) {
      await Promise.all(
        [...staleByUser.entries()].map(([uid, tokens]) =>
          db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens)
          })
        )
      )
    }

    return { success: response.successCount > 0, ordererHasNoTokens }
  }
)

interface OrderProcessedRequest {
  payerId: string
  totalAmount: number
}

export const sendOrderProcessedNotification = onCall(
  { region: 'europe-west1', cors: true, invoker: 'public' },
  async (request): Promise<{ success: boolean }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to send notifications.')
    }

    const { payerId, totalAmount } = request.data as OrderProcessedRequest

    const [usersSnap, appStateSnap] = await Promise.all([
      db.collection('users').get(),
      db.doc('appState/main').get()
    ])

    const payerName: string = usersSnap.docs.find(d => d.id === payerId)?.data().name ?? 'Someone'
    const nextOrdererId: string | null = appStateSnap.exists ? appStateSnap.data()?.nextOrdererId ?? null : null
    const nextOrdererName: string = usersSnap.docs.find(d => d.id === nextOrdererId)?.data().name ?? 'Someone'
    const formattedTotal = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(totalAmount)

    const tokenUserMap = new Map<string, string>()
    const allTokens: string[] = []
    for (const userDoc of usersSnap.docs) {
      const tokens: string[] = Array.isArray(userDoc.data().fcmTokens) ? userDoc.data().fcmTokens : []
      for (const token of tokens) {
        tokenUserMap.set(token, userDoc.id)
        allTokens.push(token)
      }
    }

    if (allTokens.length === 0) return { success: false }

    const message: admin.messaging.MulticastMessage = {
      tokens: allTokens,
      data: {
        title: 'Order Processed',
        body: `${payerName} paid an order for: ${formattedTotal} 💸. It's ${nextOrdererName}'s turn next. 🍕`
      },
      webpush: { fcmOptions: { link: 'https://mannightpizza.web.app/' } }
    }

    const response = await admin.messaging().sendEachForMulticast(message)

    const staleByUser = new Map<string, string[]>()
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const token = allTokens[idx]
          const uid = tokenUserMap.get(token)!
          if (!staleByUser.has(uid)) staleByUser.set(uid, [])
          staleByUser.get(uid)!.push(token)
        }
      }
    })

    if (staleByUser.size > 0) {
      await Promise.all(
        [...staleByUser.entries()].map(([uid, tokens]) =>
          db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens)
          })
        )
      )
    }

    return { success: response.successCount > 0 }
  }
)

export const sendChatNotification = onCall(
  { region: 'europe-west1', cors: true, invoker: 'public' },
  async (request): Promise<{ success: boolean }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const { senderUserId, senderName, messageText } = request.data as {
      senderUserId: string
      senderName: string
      messageText: string
    }

    const usersSnap = await db.collection('users').get()
    const tokenUserMap = new Map<string, string>()
    const tokens: string[] = []

    for (const userDoc of usersSnap.docs) {
      if (userDoc.id === senderUserId) continue
      const data = userDoc.data()
      if (data.chatNotificationsEnabled === false) continue
      const fcmTokens: string[] = Array.isArray(data.fcmTokens) ? data.fcmTokens : []
      for (const token of fcmTokens) {
        tokenUserMap.set(token, userDoc.id)
        tokens.push(token)
      }
    }

    if (tokens.length === 0) return { success: false }

    const message: admin.messaging.MulticastMessage = {
      tokens,
      data: { title: `${senderName} in Pizza Chat 🍕`, body: messageText, type: 'chat' },
      webpush: { fcmOptions: { link: 'https://mannightpizza.web.app/?chat=1' } }
    }

    const response = await admin.messaging().sendEachForMulticast(message)

    const staleByUser = new Map<string, string[]>()
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const token = tokens[idx]
          const uid = tokenUserMap.get(token)!
          if (!staleByUser.has(uid)) staleByUser.set(uid, [])
          staleByUser.get(uid)!.push(token)
        }
      }
    })

    if (staleByUser.size > 0) {
      await Promise.all(
        [...staleByUser.entries()].map(([uid, t]) =>
          db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...t)
          })
        )
      )
    }

    return { success: response.successCount > 0 }
  }
)

export const sendReactionNotification = onCall(
  { region: 'europe-west1', cors: true, invoker: 'public' },
  async (request): Promise<{ success: boolean }> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.')
    const { reactorUserId, reactorName, messageAuthorUserId, emoji } = request.data as {
      reactorUserId: string
      reactorName: string
      messageAuthorUserId: string
      emoji: string
    }
    if (reactorUserId === messageAuthorUserId) return { success: false }

    const authorDoc = await db.collection('users').doc(messageAuthorUserId).get()
    if (!authorDoc.exists) return { success: false }
    const data = authorDoc.data()!
    if (data.chatNotificationsEnabled === false) return { success: false }
    const tokens: string[] = Array.isArray(data.fcmTokens) ? data.fcmTokens : []
    if (tokens.length === 0) return { success: false }

    const message: admin.messaging.MulticastMessage = {
      tokens,
      data: { title: `${reactorName} reacted ${emoji}`, body: 'Tap to open chat', type: 'chat' },
      webpush: { fcmOptions: { link: 'https://mannightpizza.web.app/?chat=1' } }
    }
    const response = await admin.messaging().sendEachForMulticast(message)

    const staleTokens = tokens.filter((_, i) => {
      const code = response.responses[i]?.error?.code
      return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'
    })
    if (staleTokens.length > 0) {
      await db.collection('users').doc(messageAuthorUserId).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...staleTokens)
      })
    }

    return { success: response.successCount > 0 }
  }
)

export const cleanupOldMessages = onSchedule(
  { schedule: '0 3 * * 0', region: 'europe-west1', timeZone: 'Europe/London' },
  async () => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    const snap = await db.collection('messages').where('createdAt', '<', cutoff).get()
    if (snap.empty) return
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db.batch()
      snap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref))
      await batch.commit()
    }
  }
)
