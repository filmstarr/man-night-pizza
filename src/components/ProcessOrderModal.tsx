import { useState } from 'react'
import type { User, OrderSnapshot } from '../types'
import { processOrder, formatCurrency } from '../lib/firestore'

interface Props {
  users: User[]
  nextOrdererId: string | null
  onClose: () => void
  onProcessed: (snapshot: OrderSnapshot) => void
}

export function ProcessOrderModal({ users, nextOrdererId, onClose, onProcessed }: Props) {
  const [totalAmount, setTotalAmount] = useState('')
  const [payerId, setPayerId] = useState(nextOrdererId ?? (users.find(u => u.isPresent && u.name)?.id ?? ''))
  const [processing, setProcessing] = useState(false)
  const [frozenUsers, setFrozenUsers] = useState<User[] | null>(null)
  const [error, setError] = useState('')

  const displayUsers = frozenUsers ?? users
  const presentUsers = displayUsers.filter(u => u.isPresent && u.name)
  const allUsers = displayUsers.filter(u => u.name)

  const total = parseFloat(totalAmount) || 0
  const individualAmount = presentUsers.length > 0 ? Math.round((total / presentUsers.length) * 100) / 100 : 0

  function previewBalance(user: User): number {
    let balance = user.balance
    if (user.isPresent) {
      balance = Math.round((balance - individualAmount) * 100) / 100
    }
    if (user.id === payerId) {
      const shortFall = Math.round((total - individualAmount * presentUsers.length) * 100) / 100
      balance = Math.round((balance + total - shortFall) * 100) / 100
    }
    return balance
  }

  async function handleConfirm() {
    if (total <= 0) {
      setError('Please enter a valid order total.')
      return
    }
    if (!payerId) {
      setError('Please select who paid.')
      return
    }
    if (presentUsers.length === 0) {
      setError('No one is marked as present.')
      return
    }
    setFrozenUsers(structuredClone(users))
    setProcessing(true)
    try {
      const snapshot = await processOrder(users, total, payerId)
      onProcessed(snapshot)
    } catch (e) {
      console.error('processOrder failed:', e)
      setError(e instanceof Error ? e.message : String(e))
      setFrozenUsers(null)
      setProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Process Order</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {presentUsers.length} {presentUsers.length === 1 ? 'person' : 'people'} present
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Total amount */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Order Total (£)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-lg font-mono focus:outline-none focus:border-blue-500"
              placeholder="0.00"
              value={totalAmount}
              onChange={e => setTotalAmount(e.target.value)}
              autoFocus
            />
          </div>

          {/* Per person */}
          {total > 0 && presentUsers.length > 0 && (
            <div className="text-sm text-gray-400">
              {formatCurrency(individualAmount)} each ({presentUsers.length} people)
            </div>
          )}

          {/* Who paid */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Paid by</label>
            <select
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              value={payerId}
              onChange={e => setPayerId(e.target.value)}
            >
              {allUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.id === nextOrdererId ? '(suggested)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Balance preview */}
          {total > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Balance changes</div>
              <div className="space-y-1">
                {allUsers.map(user => {
                  const newBalance = previewBalance(user)
                  const diff = Math.round((newBalance - user.balance) * 100) / 100
                  const diffStr = diff >= 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff)
                  const diffColor = diff >= 0 ? 'text-green-400' : 'text-red-400'
                  return (
                    <div key={user.id} className="flex items-center justify-between text-sm">
                      <span className={`text-gray-300 ${user.id === payerId ? 'font-medium' : ''}`}>
                        {user.name} {user.id === payerId ? '🏦' : ''}{user.isPresent ? '' : ' (absent)'}
                      </span>
                      <span className="font-mono text-gray-400">
                        {formatCurrency(user.balance)} → <span className={diffColor}>{formatCurrency(newBalance)}</span>
                        <span className={`text-xs ml-1 ${diffColor}`}>({diffStr})</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        <div className="p-5 border-t border-gray-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={processing}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-lg font-semibold transition-colors"
          >
            {processing ? 'Processing…' : 'Confirm Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
