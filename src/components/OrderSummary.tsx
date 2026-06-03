import { useState, Fragment } from 'react'
import type { User } from '../types'

function buildNotifyHref(orderer: User): string {
  const to = orderer.emails.join(',')
  const subject = encodeURIComponent('Man Night Pizza - Your turn to order!')
  const body = encodeURIComponent(
    `Hi ${orderer.name},\n\nIt's your turn to order pizza next 🍕.\n\nCheers`
  )
  return `mailto:${to}?subject=${subject}&body=${body}`
}

function pizzaLine(user: User): string {
  return [user.currentPizza.name, user.currentPizza.size, user.currentPizza.base]
    .filter(Boolean).join(' · ')
}

interface Props {
  users: User[]
  nextOrdererId: string | null
  onNotify?: (orderer: User) => Promise<void>
  onTestNotify?: () => Promise<void>
}

export function OrderSummary({ users, nextOrdererId, onNotify, onTestNotify }: Props) {
  const [notifying, setNotifying] = useState(false)
  const [notified, setNotified] = useState(false)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  const [showFullscreen, setShowFullscreen] = useState(false)

  const presentUsers = users.filter(u => u.isPresent && u.name)

  if (presentUsers.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Order Summary</h2>
        <p className="text-sm text-gray-500 italic">No one is marked as present yet.</p>
      </div>
    )
  }

  const nextOrderer = presentUsers.find(u => u.id === nextOrdererId)

  async function handleTestNotify() {
    if (!onTestNotify || testing) return
    setTesting(true)
    try {
      await onTestNotify()
      setTested(true)
      setTimeout(() => setTested(false), 2000)
    } finally {
      setTesting(false)
    }
  }

  async function handleNotify() {
    if (!nextOrderer || notifying) return
    if (!onNotify) {
      if (nextOrderer.emails.length > 0) window.location.href = buildNotifyHref(nextOrderer)
      return
    }
    setNotifying(true)
    try {
      await onNotify(nextOrderer)
      setNotified(true)
      setTimeout(() => setNotified(false), 2000)
    } catch (err) {
      if (err instanceof Error && err.message === 'no_tokens' && nextOrderer.emails.length > 0) {
        window.location.href = buildNotifyHref(nextOrderer)
      }
    } finally {
      setNotifying(false)
    }
  }

  return (
    <>
      <div
        className="rounded-lg border border-gray-700 bg-gray-800 p-4 cursor-pointer select-none"
        onClick={() => setShowFullscreen(true)}
      >
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Order Summary · {presentUsers.length} {presentUsers.length === 1 ? 'person' : 'people'}
        </h2>

        {nextOrderer && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm text-pink-300 font-medium">
              🍕 {nextOrderer.name} is ordering next
            </span>
            <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
              <button
                onClick={handleNotify}
                disabled={notifying}
                className="text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 px-2 py-1 rounded transition-colors disabled:opacity-50"
                title={`Notify ${nextOrderer.name}`}
              >
                {notified ? '✓' : notifying ? '…' : 'Notify 📬'}
              </button>
              {onTestNotify && (
                <button
                  onClick={handleTestNotify}
                  disabled={testing}
                  className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-500 px-2 py-1 rounded transition-colors disabled:opacity-50"
                  title="Send test notification to admins"
                >
                  {tested ? '✓' : testing ? '…' : 'Test 🔔'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {presentUsers.map((user, i) => {
            const line = pizzaLine(user)
            const extras = [
              !user.isSharing && user.currentPizza.modifications,
              user.currentPizza.sides && `Dip: ${user.currentPizza.sides}`,
            ].filter(Boolean).join(' · ')

            return (
              <Fragment key={user.id}>
                <span className={`text-sm font-medium ${i > 0 ? 'mt-2' : ''} ${user.id === nextOrdererId ? 'text-pink-300' : 'text-white'}`}>
                  {user.name}
                </span>
                {user.isSharing ? (
                  <span className={`text-xs italic text-gray-500 ${i > 0 ? 'mt-2' : ''}`}>Sharing</span>
                ) : (
                  <span className={`text-xs text-gray-300 ${i > 0 ? 'mt-2' : ''}`}>{line || <span className="italic text-gray-500">No pizza set</span>}</span>
                )}
                {extras && (
                  <div className="col-span-2 text-xs text-gray-500 -mt-0.5 mb-0.5">{extras}</div>
                )}
              </Fragment>
            )
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500">
          + sides, cookies, etc.
        </div>
      </div>

      {showFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-gray-950 overflow-y-auto !mt-0"
          onClick={() => setShowFullscreen(false)}
        >
          <div className="max-w-lg mx-auto px-6 py-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-base sm:text-sm font-semibold text-gray-400 uppercase tracking-wider">Order Summary</h2>
              <button
                onClick={() => setShowFullscreen(false)}
                className="text-gray-500 hover:text-white transition-colors text-3xl sm:text-xl leading-none p-1 -mr-1"
              >
                ✕
              </button>
            </div>

            {nextOrderer && (
              <div className="mb-8 p-4 rounded-xl bg-pink-950/30 border border-pink-700/50">
                <p className="text-pink-300 text-2xl font-bold">🍕 {nextOrderer.name} is ordering</p>
              </div>
            )}

            <div className="space-y-6">
              {presentUsers.map(user => {
                const line = pizzaLine(user)
                const mods = !user.isSharing ? user.currentPizza.modifications : ''
                const sides = user.currentPizza.sides

                return (
                  <div key={user.id} className="pb-6 border-b border-gray-800 last:border-0">
                    <p className={`text-2xl font-bold mb-1 ${user.id === nextOrdererId ? 'text-pink-300' : 'text-white'}`}>
                      {user.name}
                    </p>
                    {user.isSharing ? (
                      <p className="text-gray-400 text-lg">Sharing</p>
                    ) : (
                      <>
                        <p className="text-xl text-gray-200">{line || <span className="italic text-gray-500">No pizza set</span>}</p>
                        {mods && <p className="text-lg text-gray-400 mt-1">{mods}</p>}
                        {sides && <p className="text-lg text-gray-400">{sides}</p>}
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="mt-6 text-gray-500 text-lg">+ sides, cookies, etc.</p>
          </div>
        </div>
      )}
    </>
  )
}
