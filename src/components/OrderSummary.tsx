import { useState } from 'react'
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
    .filter(Boolean).join(' | ')
}

function parseModifications(mods: string): { plain: string[], removals: string[], additions: string[] } {
  const plain: string[] = [], removals: string[] = [], additions: string[] = []
  const tokens = mods.match(/[+-][^,+-]*|[^,+-]+/g) || []
  for (const token of tokens.map(s => s.trim()).filter(Boolean)) {
    if (token.startsWith('+')) additions.push(token.slice(1).trim())
    else if (token.startsWith('-')) removals.push(token.slice(1).trim())
    else plain.push(token)
  }
  return { plain, removals, additions }
}

function aggregateSides(users: User[]): { name: string, count: number }[] {
  const counts = new Map<string, { display: string, count: number }>()
  for (const u of users) {
    const side = u.currentPizza.sides?.trim().replace(/\s*dip\s*$/i, '').trim()
    if (!side || u.isSharing) continue
    const key = side.toLowerCase()
    const existing = counts.get(key)
    counts.set(key, { display: existing?.display ?? side, count: (existing?.count ?? 0) + 1 })
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count).map(({ display, count }) => ({ name: display, count }))
}

function PersonCard({ user, nextOrdererId, compact }: { user: User, nextOrdererId: string | null, compact?: boolean }) {
  const line = pizzaLine(user)
  const mods = !user.isSharing ? (user.currentPizza.modifications || '') : ''
  const { plain, removals, additions } = parseModifications(mods)
  const isOrderer = user.id === nextOrdererId

  return (
    <div className="flex gap-0 items-stretch rounded-lg bg-gray-700/40">
      <div className={`flex items-start rounded-l-lg ${isOrderer ? 'bg-pink-800' : 'bg-blue-600'} p-2.5`} style={{ width: '3.5rem' }}>
        <span className={`font-bold text-white text-center leading-tight ${compact ? 'text-xs' : 'text-sm'}`} style={{ writingMode: 'horizontal-tb' }}>
          {user.name}
        </span>
      </div>
      <div className={`flex-1 min-w-0 p-2.5`}>
        {user.isSharing ? (
          <p className={`italic text-gray-500 ${compact ? 'text-xs' : 'text-sm'}`}>Sharing</p>
        ) : compact ? (
          <>
            <p className="text-xs text-gray-300">
              {line || <span className="italic text-gray-500">No pizza set</span>}
            </p>
            {(plain.length > 0 || removals.length > 0 || additions.length > 0) && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs">
                {plain.length > 0 && (
                  <span className="text-gray-400">{plain.join(', ')}</span>
                )}
                {removals.length > 0 && (
                  <span className="flex items-center gap-1 text-gray-400">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="7" cy="7" r="7" fill="#ef4444"/>
                      <line x1="4" y1="7" x2="10" y2="7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    {removals.join(', ')}
                  </span>
                )}
                {additions.length > 0 && (
                  <span className="flex items-center gap-1 text-gray-400">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="7" cy="7" r="7" fill="#16a34a"/>
                      <line x1="7" y1="4" x2="7" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="4" y1="7" x2="10" y2="7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    {additions.join(', ')}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-0.5 text-sm">
            {user.currentPizza.name && <p className="text-gray-200 font-bold">{user.currentPizza.name}</p>}
            {user.currentPizza.size && <p className="text-gray-300">{user.currentPizza.size}</p>}
            {user.currentPizza.base && <p className="text-gray-300">{user.currentPizza.base}</p>}
            {plain.length > 0 && <p className="text-gray-300">{plain.join(', ')}</p>}
            {removals.length > 0 && (
              <span className="flex items-center gap-1 text-gray-300">
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="7" cy="7" r="7" fill="#ef4444"/>
                  <line x1="4" y1="7" x2="10" y2="7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {removals.join(', ')}
              </span>
            )}
            {additions.length > 0 && (
              <span className="flex items-center gap-1 text-gray-300">
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="7" cy="7" r="7" fill="#16a34a"/>
                  <line x1="7" y1="4" x2="7" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="4" y1="7" x2="10" y2="7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {additions.join(', ')}
              </span>
            )}
            {!user.currentPizza.name && <p className="italic text-gray-500">No pizza set</p>}
          </div>
        )}
      </div>
    </div>
  )
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
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Order Summary</h2>
        <p className="text-sm text-gray-500 italic">No one is marked as present yet.</p>
      </div>
    )
  }

  const nextOrderer = presentUsers.find(u => u.id === nextOrdererId)
  const sides = aggregateSides(presentUsers)

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

  const NotifyButtons = ({ stopProp }: { stopProp?: boolean }) => (
    <div
      className="flex gap-1 shrink-0"
      onClick={stopProp ? e => e.stopPropagation() : undefined}
    >
      {nextOrderer && (
        <button
          onClick={handleNotify}
          disabled={notifying}
          className="text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 px-2 py-1 rounded transition-colors disabled:opacity-50"
          title="Notify who's ordering next"
        >
          {notified ? '✓' : notifying ? '…' : 'Notify 📬'}
        </button>
      )}
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
  )

  return (
    <>
      <div
        className="cursor-pointer select-none"
        onClick={() => setShowFullscreen(true)}
      >
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Order Summary</h2>
            <NotifyButtons stopProp />
          </div>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-gray-400">
              Attendance: <span className="text-white font-medium">{presentUsers.length} {presentUsers.length === 1 ? 'Person' : 'People'}</span>
            </span>
            {nextOrderer && (
              <>
                <span className="text-gray-600">|</span>
                <span className="text-gray-400">
                  Orderer: <span className="text-pink-300 font-medium">{nextOrderer.name}</span>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {presentUsers.map(user => (
            <PersonCard key={user.id} user={user} nextOrdererId={nextOrdererId} compact />
          ))}
        </div>

        {sides.length > 0 && (
          <div className="flex gap-3 items-start rounded-lg border border-blue-600 p-2.5 mt-2">
            <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-gray-300">Sides</span>
            </div>
            <div>
              <p className="text-xs text-gray-300">
                {sides.map(s => `${s.count} x ${s.name} dip`).join(', ')}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">+ wedges, cookies, etc.</p>
            </div>
          </div>
        )}
      </div>

      {showFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-gray-950 overflow-y-auto !mt-0"
          onClick={() => setShowFullscreen(false)}
        >
          <div className="max-w-lg mx-auto px-6 py-8" onClick={e => e.stopPropagation()}>
            <div className="mb-6">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-base font-semibold text-gray-400 uppercase tracking-wider">Order Summary</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <NotifyButtons />
                  <button
                    onClick={() => setShowFullscreen(false)}
                    className="text-gray-500 hover:text-white transition-colors text-3xl sm:text-xl leading-none p-1 -mr-1"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-400">
                  Attendance: <span className="text-white font-medium">{presentUsers.length} {presentUsers.length === 1 ? 'Person' : 'People'}</span>
                </span>
                {nextOrderer && (
                  <>
                    <span className="text-gray-600">|</span>
                    <span className="text-gray-400">
                      Orderer: <span className="text-pink-300 font-medium">{nextOrderer.name}</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {presentUsers.map(user => (
                <PersonCard key={user.id} user={user} nextOrdererId={nextOrdererId} />
              ))}
            </div>

            {sides.length > 0 && (
              <div className="flex gap-3 items-start rounded-lg border border-blue-600 p-4 mt-3">
                <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-gray-300">Sides</span>
                </div>
                <div>
                  <p className="text-sm text-gray-300">
                    {sides.map(s => `${s.count} x ${s.name} dip`).join(', ')}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">+ wedges, cookies, etc.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
