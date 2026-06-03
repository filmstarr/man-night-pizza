import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import type { User as FirebaseUser } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, app } from './lib/firebase'
import {
  subscribeToUsers,
  subscribeToAppState,
  recomputeNextOrderer,
  syncAllowedEmails,
  undoLastOrder,
  resetAllBalances,
  resetAllOrders,
  formatCurrency
} from './lib/firestore'
import type { User, AppState, OrderSnapshot } from './types'
import { LoginPage } from './components/LoginPage'
import { UserCard } from './components/UserCard'
import { OrderSummary } from './components/OrderSummary'
import { ProcessOrderModal } from './components/ProcessOrderModal'
import { UserModal } from './components/UserModal'
import { NotificationBanner } from './components/NotificationBanner'
import { useNotificationPermission } from './hooks/useNotificationPermission'
import { useSwUpdate } from './hooks/useSwUpdate'

export default function App() {
  const [authUser, setAuthUser] = useState<FirebaseUser | null | undefined>(undefined)
  const [users, setUsers] = useState<User[]>([])
  const [appState, setAppState] = useState<AppState>({ nextOrdererId: null })
  const [pendingUndo, setPendingUndo] = useState<OrderSnapshot | null>(null)
  const [showProcessOrder, setShowProcessOrder] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null | undefined>(undefined)
  const [undoConfirm, setUndoConfirm] = useState(false)
  const [resetBalancesConfirm, setResetBalancesConfirm] = useState(false)
  const [resetOrdersConfirm, setResetOrdersConfirm] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'single'>(() => {
    const saved = localStorage.getItem('viewMode') as 'list' | 'grid' | 'single' | null
    if (saved) return saved
    return window.matchMedia('(min-width: 1280px)').matches ? 'grid' : 'list'
  })
  const appUpdated = useSwUpdate()
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem('notifBannerDismissed') === 'true'
  )

  // Clear app badge when app is visible
  useEffect(() => {
    const clear = () => { if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {}) }
    clear()
    document.addEventListener('visibilitychange', clear)
    return () => document.removeEventListener('visibilitychange', clear)
  }, [])

  // Auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, u => setAuthUser(u))
  }, [])

  // Firestore listeners
  useEffect(() => {
    if (!authUser) return
    const unsub1 = subscribeToUsers(incoming => {
      setUsers(incoming)
    })
    const unsub2 = subscribeToAppState(setAppState)
    syncAllowedEmails()
    return () => { unsub1(); unsub2() }
  }, [authUser])

  // Recompute next orderer whenever present users change
  useEffect(() => {
    if (!authUser || users.length === 0) return
    recomputeNextOrderer(users)
  }, [users.map(u => `${u.id}:${u.isPresent}:${u.balance}`).join(',')])

  const currentUser = authUser
    ? users.find(u => u.emails.some(e => e.toLowerCase() === authUser.email?.toLowerCase()))
    : undefined

  const { permissionState, requestPermission, enrolling } = useNotificationPermission(currentUser)

  const usersRef = useRef(users)
  useEffect(() => { usersRef.current = users }, [users])

  const prevNextOrdererIdRef = useRef<string | null | undefined>(undefined)
  const [absentOrderer, setAbsentOrderer] = useState<User | null>(null)

  useEffect(() => {
    const current = appState.nextOrdererId
    const prev = prevNextOrdererIdRef.current
    if (prev !== undefined && prev !== null && prev !== current) {
      const prevUser = usersRef.current.find(u => u.id === prev)
      if (prevUser && !prevUser.isPresent) setAbsentOrderer(prevUser)
      else setAbsentOrderer(null)
    }
    prevNextOrdererIdRef.current = current
  }, [appState.nextOrdererId])

  const fns = useMemo(() => getFunctions(app, 'europe-west1'), [])
  const handleNotify = useCallback(async (orderer: User) => {
    const sendNotification = httpsCallable<
      { userId: string; senderName?: string; absentUserId?: string },
      { success: boolean; ordererHasNoTokens: boolean }
    >(fns, 'sendOrderNotification')
    const result = await sendNotification({
      userId: orderer.id,
      senderName: currentUser?.name,
      absentUserId: absentOrderer?.id
    })
    setAbsentOrderer(null)
    if (result.data.ordererHasNoTokens) throw new Error('no_tokens')
  }, [fns, currentUser, absentOrderer])

  const handleTestNotify = useCallback(async () => {
    const sendTest = httpsCallable(fns, 'sendTestNotification')
    await sendTest({})
  }, [fns])

  const handleProcessed = useCallback((snapshot: OrderSnapshot) => {
    setPendingUndo(snapshot)
    setShowProcessOrder(false)
    httpsCallable(fns, 'sendOrderProcessedNotification')({
      payerId: snapshot.payerId,
      totalAmount: snapshot.totalAmount
    }).catch(() => {})
  }, [fns])

  if (authUser === undefined) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-500 text-sm">Loading…</div>
    </div>
  }

  if (!authUser) return <LoginPage />

  const presentCount = users.filter(u => u.isPresent && u.name).length
  const viewerIsAdmin = currentUser?.isAdmin ?? false

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className={`${viewMode === 'grid' ? 'max-w-5xl xl:max-w-[1408px]' : viewMode === 'list' ? 'max-w-2xl xl:max-w-[1408px]' : 'max-w-2xl'} mx-auto px-4 py-3 flex items-center gap-3`}>
          <img src="/logo.png" alt="Man Night Pizza" className="h-8 w-8 rounded-md" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white leading-tight">Man Night Pizza</h1>
          </div>
          <button
            onClick={() => signOut(auth)}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className={`${viewMode === 'grid' ? 'max-w-5xl xl:max-w-[1408px]' : viewMode === 'list' ? 'max-w-2xl xl:max-w-[1408px]' : 'max-w-2xl'} mx-auto px-4 py-5`}>
        {/* App update banner */}
        {appUpdated && (
          <div className="rounded-lg border border-green-700/50 bg-green-950/30 p-3 flex items-center gap-3 mb-4">
            <span className="text-sm text-green-300">App updated to the latest version ✓</span>
          </div>
        )}

        {/* Notification permission banner */}
        {permissionState === 'default' && !bannerDismissed && (
          <NotificationBanner
            onEnable={requestPermission}
            onDismiss={() => { setBannerDismissed(true); localStorage.setItem('notifBannerDismissed', 'true') }}
            loading={enrolling}
          />
        )}

        {/* Undo banner */}
        {pendingUndo && (
          <div className="rounded-lg border border-yellow-600/50 bg-yellow-950/30 p-3 flex items-center gap-3 mb-4">
            <div className="flex-1 text-sm text-yellow-300">
              Order of {formatCurrency(pendingUndo.totalAmount)} processed.
            </div>
            {undoConfirm ? (
              <div className="flex gap-2">
                <button
                  onClick={async () => { await undoLastOrder(pendingUndo); setPendingUndo(null); setUndoConfirm(false) }}
                  className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded transition-colors"
                >
                  Yes, undo
                </button>
                <button
                  onClick={() => setUndoConfirm(false)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setUndoConfirm(true)}
                  className="text-xs bg-yellow-700/50 hover:bg-yellow-700 text-yellow-200 px-3 py-1 rounded transition-colors"
                >
                  Undo
                </button>
                <button
                  onClick={() => setPendingUndo(null)}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 transition-colors"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        <div className={`${viewMode !== 'single' ? 'xl:flex xl:gap-6 xl:items-start xl:justify-center xl:space-y-0' : ''} space-y-4`}>
          {/* Left column: order summary + process button */}
          <div className={`${viewMode === 'grid' ? 'xl:w-96 xl:shrink-0' : viewMode === 'list' ? 'xl:flex-1 xl:max-w-[540px]' : ''} space-y-4`}>
            <OrderSummary users={users} nextOrdererId={appState.nextOrdererId} onNotify={handleNotify} onTestNotify={viewerIsAdmin ? handleTestNotify : undefined} />
            {presentCount > 0 && (
              <div>
                <button
                  onClick={() => setShowProcessOrder(true)}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-3.5 rounded-xl font-bold text-base transition-colors shadow-lg shadow-blue-900/30 mt-2 mb-4"
                >
                  Process Tonight's Order
                </button>
              </div>
            )}
          </div>

          {/* Right column: people + admin */}
          <div className={`${viewMode !== 'single' ? 'flex-1' : ''} min-w-0 space-y-4${viewMode === 'list' ? ' xl:max-w-[640px]' : ''}`}>

        {/* Users list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              People · {presentCount} present
            </h2>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1 bg-gray-800 rounded-lg p-1">
                <button
                  onClick={() => { setViewMode('single'); localStorage.setItem('viewMode', 'single') }}
                  className={`hidden xl:block px-2 py-1 rounded text-xs transition-colors ${viewMode === 'single' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  title="Single column"
                >
                  ☰
                </button>
                <button
                  onClick={() => { setViewMode('list'); localStorage.setItem('viewMode', 'list') }}
                  className={`px-2 py-1 rounded text-xs transition-colors ${viewMode === 'list' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  title="Two column"
                >
                  ◫
                </button>
                <button
                  onClick={() => { setViewMode('grid'); localStorage.setItem('viewMode', 'grid') }}
                  className={`px-2 py-1 rounded text-xs transition-colors ${viewMode === 'grid' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  title="Grid view"
                >
                  ⊞
                </button>
              </div>
              {viewerIsAdmin && (
                <button
                  onClick={() => setEditingUserId(null)}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium"
                >
                  + Add person
                </button>
              )}
            </div>
          </div>

          {users.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-700 p-8 text-center">
              <p className="text-gray-500 text-sm">No people added yet.</p>
              <button
                onClick={() => setEditingUserId(null)}
                className="mt-3 text-blue-400 hover:text-blue-300 text-sm transition-colors"
              >
                Add the first person →
              </button>
            </div>
          ) : (() => {
            const sorted = [...users].sort((a, b) => {
              if (a.id === currentUser?.id) return -1
              if (b.id === currentUser?.id) return 1
              return 0
            })
            return (
              <>
                {/* Desktop: respects view mode toggle */}
                <div className={viewMode === 'grid' ? 'hidden sm:grid sm:grid-cols-2 md:grid-cols-3 gap-3 items-stretch' : 'space-y-3'}>
                  {sorted.map(user => (
                    <UserCard
                      key={user.id}
                      user={user}
                      isNextOrderer={user.id === appState.nextOrdererId}
                      canEdit={viewerIsAdmin || user.id === currentUser?.id}
                      compact={viewMode === 'grid'}
                      onEdit={u => setEditingUserId(u.id)}
                    />
                  ))}
                </div>
                {/* Mobile: always list view */}
                {viewMode === 'grid' && (
                  <div className="sm:hidden space-y-3">
                    {sorted.map(user => (
                      <UserCard
                        key={user.id}
                        user={user}
                        isNextOrderer={user.id === appState.nextOrdererId}
                        canEdit={viewerIsAdmin || user.id === currentUser?.id}
                        onEdit={u => setEditingUserId(u.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Admin actions */}
        {viewerIsAdmin && (
          <div className="flex gap-3 pt-2">
            {resetBalancesConfirm ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-red-300 flex-1">Reset all balances to £0?</span>
                <button
                  onClick={async () => { await resetAllBalances(users); setResetBalancesConfirm(false) }}
                  className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded transition-colors"
                >
                  Yes, reset
                </button>
                <button
                  onClick={() => setResetBalancesConfirm(false)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : resetOrdersConfirm ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-red-300 flex-1">Reset all orders to defaults?</span>
                <button
                  onClick={async () => { await resetAllOrders(users); setResetOrdersConfirm(false) }}
                  className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded transition-colors"
                >
                  Yes, reset
                </button>
                <button
                  onClick={() => setResetOrdersConfirm(false)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setResetBalancesConfirm(true)}
                  className="flex-1 text-xs bg-gray-800 hover:bg-red-900/50 border border-gray-700 hover:border-red-700 text-gray-400 hover:text-red-300 py-2 rounded-lg transition-colors"
                >
                  Reset All Balances
                </button>
                <button
                  onClick={() => setResetOrdersConfirm(true)}
                  className="flex-1 text-xs bg-gray-800 hover:bg-red-900/50 border border-gray-700 hover:border-red-700 text-gray-400 hover:text-red-300 py-2 rounded-lg transition-colors"
                >
                  Reset All Orders
                </button>
              </>
            )}
          </div>
        )}
          </div>{/* end right column */}
        </div>{/* end lg:flex */}
      </main>

      {/* Modals */}
      {showProcessOrder && (
        <ProcessOrderModal
          users={users}
          nextOrdererId={appState.nextOrdererId}
          onClose={() => setShowProcessOrder(false)}
          onProcessed={handleProcessed}
        />
      )}
      {editingUserId !== undefined && (
        <UserModal
          user={editingUserId === null ? null : (users.find(u => u.id === editingUserId) ?? null)}
          viewerIsAdmin={viewerIsAdmin}
          onClose={() => setEditingUserId(undefined)}
        />
      )}
    </div>
  )
}
