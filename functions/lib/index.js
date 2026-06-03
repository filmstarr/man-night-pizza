"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOrderProcessedNotification = exports.sendOrderNotification = exports.sendTestNotification = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
exports.sendTestNotification = (0, https_1.onCall)({ region: 'europe-west1', cors: true, invoker: 'public' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'You must be signed in to send notifications.');
    }
    // Verify caller is an admin
    const callerEmail = request.auth.token.email;
    if (!callerEmail) {
        throw new https_1.HttpsError('permission-denied', 'No email on auth token.');
    }
    const usersSnap = await db.collection('users').get();
    const callerDoc = usersSnap.docs.find(d => {
        const emails = Array.isArray(d.data().emails) ? d.data().emails : [];
        return emails.some(e => e.toLowerCase() === callerEmail.toLowerCase());
    });
    if (!callerDoc?.data().isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Only admins can send test notifications.');
    }
    // Collect FCM tokens from admin users only
    const tokenUserMap = new Map();
    const adminTokens = [];
    for (const userDoc of usersSnap.docs) {
        if (!userDoc.data().isAdmin)
            continue;
        const tokens = Array.isArray(userDoc.data().fcmTokens) ? userDoc.data().fcmTokens : [];
        for (const token of tokens) {
            tokenUserMap.set(token, userDoc.id);
            adminTokens.push(token);
        }
    }
    if (adminTokens.length === 0) {
        return { success: false, ordererHasNoTokens: true };
    }
    const message = {
        tokens: adminTokens,
        data: {
            title: 'Man Night Pizza',
            body: 'Push notifications are working! ✓'
        },
        webpush: {
            fcmOptions: { link: 'https://mannightpizza.web.app/' }
        }
    };
    const response = await admin.messaging().sendEachForMulticast(message);
    // Clean up stale tokens
    const staleByUser = new Map();
    response.responses.forEach((resp, idx) => {
        if (!resp.success) {
            const code = resp.error?.code;
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                const token = adminTokens[idx];
                const uid = tokenUserMap.get(token);
                if (!staleByUser.has(uid))
                    staleByUser.set(uid, []);
                staleByUser.get(uid).push(token);
            }
        }
    });
    if (staleByUser.size > 0) {
        await Promise.all([...staleByUser.entries()].map(([uid, tokens]) => db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens)
        })));
    }
    return { success: response.successCount > 0, ordererHasNoTokens: false };
});
exports.sendOrderNotification = (0, https_1.onCall)({ region: 'europe-west1', cors: true, invoker: 'public' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'You must be signed in to send notifications.');
    }
    const { userId, senderName, absentUserId } = request.data;
    if (!userId || typeof userId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'userId is required.');
    }
    const usersSnap = await db.collection('users').get();
    // Build token → userId map and collect all tokens
    const tokenUserMap = new Map();
    const allTokens = [];
    let ordererHasNoTokens = true;
    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
        if (userDoc.id === userId && tokens.length > 0)
            ordererHasNoTokens = false;
        for (const token of tokens) {
            tokenUserMap.set(token, userDoc.id);
            allTokens.push(token);
        }
    }
    if (allTokens.length === 0) {
        return { success: false, ordererHasNoTokens: true };
    }
    const ordererDoc = usersSnap.docs.find(d => d.id === userId);
    const ordererName = ordererDoc?.data().name ?? 'Someone';
    let title;
    let body;
    if (absentUserId && senderName) {
        const absentName = usersSnap.docs.find(d => d.id === absentUserId)?.data().name ?? 'Someone';
        title = 'Man Night Pizza';
        body = `${senderName} says that ${absentName} isn't attending. It's now ${ordererName}'s turn to order. 🍕`;
    }
    else {
        title = 'Man Night Pizza';
        body = `It's ${ordererName}'s turn to order next 🍕`;
    }
    const message = {
        tokens: allTokens,
        data: { title, body },
        webpush: {
            fcmOptions: {
                link: 'https://mannightpizza.web.app/'
            }
        }
    };
    const response = await admin.messaging().sendEachForMulticast(message);
    // Clean up stale tokens grouped by user
    const staleByUser = new Map();
    response.responses.forEach((resp, idx) => {
        if (!resp.success) {
            const code = resp.error?.code;
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                const token = allTokens[idx];
                const uid = tokenUserMap.get(token);
                if (!staleByUser.has(uid))
                    staleByUser.set(uid, []);
                staleByUser.get(uid).push(token);
            }
        }
    });
    if (staleByUser.size > 0) {
        await Promise.all([...staleByUser.entries()].map(([uid, tokens]) => db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens)
        })));
    }
    return { success: response.successCount > 0, ordererHasNoTokens };
});
exports.sendOrderProcessedNotification = (0, https_1.onCall)({ region: 'europe-west1', cors: true, invoker: 'public' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'You must be signed in to send notifications.');
    }
    const { payerId, totalAmount } = request.data;
    const [usersSnap, appStateSnap] = await Promise.all([
        db.collection('users').get(),
        db.doc('appState/main').get()
    ]);
    const payerName = usersSnap.docs.find(d => d.id === payerId)?.data().name ?? 'Someone';
    const nextOrdererId = appStateSnap.exists ? appStateSnap.data()?.nextOrdererId ?? null : null;
    const nextOrdererName = usersSnap.docs.find(d => d.id === nextOrdererId)?.data().name ?? 'Someone';
    const formattedTotal = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(totalAmount);
    const tokenUserMap = new Map();
    const allTokens = [];
    for (const userDoc of usersSnap.docs) {
        const tokens = Array.isArray(userDoc.data().fcmTokens) ? userDoc.data().fcmTokens : [];
        for (const token of tokens) {
            tokenUserMap.set(token, userDoc.id);
            allTokens.push(token);
        }
    }
    if (allTokens.length === 0)
        return { success: false };
    const message = {
        tokens: allTokens,
        data: {
            title: 'Man Night Pizza',
            body: `${payerName} processed an order for: ${formattedTotal} 💸. It's ${nextOrdererName}'s turn next. 🍕`
        },
        webpush: { fcmOptions: { link: 'https://mannightpizza.web.app/' } }
    };
    const response = await admin.messaging().sendEachForMulticast(message);
    const staleByUser = new Map();
    response.responses.forEach((resp, idx) => {
        if (!resp.success) {
            const code = resp.error?.code;
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                const token = allTokens[idx];
                const uid = tokenUserMap.get(token);
                if (!staleByUser.has(uid))
                    staleByUser.set(uid, []);
                staleByUser.get(uid).push(token);
            }
        }
    });
    if (staleByUser.size > 0) {
        await Promise.all([...staleByUser.entries()].map(([uid, tokens]) => db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens)
        })));
    }
    return { success: response.successCount > 0 };
});
//# sourceMappingURL=index.js.map