import { useState } from 'react'
import type { User, PizzaOrder } from '../types'
import { addUser, updateUser, deleteUser, adjustBalance, formatCurrency } from '../lib/firestore'
import { EMPTY_PIZZA } from '../types'
import { PizzaEditor } from './PizzaEditor'

interface Props {
  user?: User | null
  viewerIsAdmin: boolean
  onClose: () => void
}

export function UserModal({ user, viewerIsAdmin, onClose }: Props) {
  const isNew = !user

  const [name, setName] = useState(user?.name ?? '')
  const [emails, setEmails] = useState<string[]>(
    user?.emails?.length ? user.emails : ['']
  )
  const [newEmail, setNewEmail] = useState('')
  const [isAdmin, setIsAdmin] = useState(user?.isAdmin ?? false)
  const [defaultPizza, setDefaultPizza] = useState<PizzaOrder>(user?.defaultPizza ?? { ...EMPTY_PIZZA })
  const [balanceAdjust, setBalanceAdjust] = useState('')
  const [previousBalance, setPreviousBalance] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState<'details' | 'balance'>('details')

  function handleAddEmail() {
    const trimmed = newEmail.trim()
    if (!trimmed) return
    if (emails.includes(trimmed)) return
    setEmails(prev => [...prev, trimmed])
    setNewEmail('')
  }

  function handleRemoveEmail(index: number) {
    setEmails(prev => prev.filter((_, i) => i !== index))
  }

  function handleUpdateEmail(index: number, value: string) {
    setEmails(prev => prev.map((e, i) => i === index ? value : e))
  }

  async function handleSave() {
    if (!name.trim() || !defaultPizza.name.trim()) { setShowErrors(true); return }
    const cleanEmails = emails.map(e => e.trim()).filter(Boolean)
    setSaving(true)
    try {
      if (isNew) {
        await addUser({
          name: name.trim(),
          emails: cleanEmails,
          balance: 0,
          defaultPizza,
          currentPizza: { ...defaultPizza },
          isPresent: true,
          isSharing: false,
          isAdmin: viewerIsAdmin ? isAdmin : false
        })
      } else {
        await updateUser(user!.id, {
          name: name.trim(),
          emails: cleanEmails,
          defaultPizza,
          currentPizza: user!.pizzaOverridden ? user!.currentPizza : defaultPizza,
          ...(viewerIsAdmin ? { isAdmin } : {})
        }, user!.emails)
      }
      onClose()
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  async function handleAdjustBalance() {
    const amount = parseFloat(balanceAdjust)
    if (isNaN(amount) || amount === 0) { setError('Enter a non-zero amount.'); return }
    setSaving(true)
    setPreviousBalance(user!.balance)
    try {
      await adjustBalance(user!.id, amount)
      setBalanceAdjust('')
      setSaving(false)
    } catch {
      setError('Failed to adjust balance.')
      setPreviousBalance(null)
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    await deleteUser(user!.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{isNew ? 'Add Person' : `Edit ${user!.name}`}</h2>
          {!isNew && (
            <div className="text-right">
              <div className="text-sm font-mono text-gray-300">{formatCurrency(user!.balance)}</div>
              {previousBalance !== null && previousBalance !== user!.balance && (
                <div className="text-xs text-gray-600">was {formatCurrency(previousBalance)}</div>
              )}
            </div>
          )}
        </div>

        {!isNew && (
          <div className="flex border-b border-gray-700">
            {(['details', 'balance'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  tab === t ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t === 'details' ? 'Details & Pizza' : 'Balance'}
              </button>
            ))}
          </div>
        )}

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {(isNew || tab === 'details') && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 ${showErrors && !name.trim() ? 'border-red-500' : 'border-gray-600'}`}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Name"
                  autoFocus={isNew}
                />
                {showErrors && !name.trim() && <p className="text-red-500 text-xs mt-0.5">Name is required.</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Email addresses</label>
                <div className="space-y-2">
                  {emails.map((email, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="email"
                        className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                        value={email}
                        onChange={e => handleUpdateEmail(i, e.target.value)}
                        placeholder="email@example.com"
                      />
                      {emails.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveEmail(i)}
                          className="text-gray-500 hover:text-red-400 transition-colors px-2"
                          title="Remove email"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      type="email"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddEmail())}
                      placeholder="Add another email…"
                    />
                    <button
                      type="button"
                      onClick={handleAddEmail}
                      className="text-sm text-blue-400 hover:text-blue-300 transition-colors px-2 shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              {viewerIsAdmin && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAdmin}
                      onChange={e => setIsAdmin(e.target.checked)}
                      className="w-4 h-4 accent-blue-500 cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-300">Admin</span>
                  </label>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Default Pizza Order</label>
                <PizzaEditor pizza={defaultPizza} onChange={setDefaultPizza} showErrors={showErrors} />
              </div>
            </>
          )}

          {!isNew && tab === 'balance' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Balance</div>
                <div className={`text-3xl font-bold font-mono ${user!.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(user!.balance)}
                </div>
                {previousBalance !== null && previousBalance !== user!.balance && (
                  <div className="text-xs text-gray-500 mt-1">
                    previously {formatCurrency(previousBalance)}
                  </div>
                )}
              </div>
              {viewerIsAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Adjust Balance (£)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                      placeholder="e.g. 10.00 or -5.50"
                      value={balanceAdjust}
                      onChange={e => setBalanceAdjust(e.target.value)}
                    />
                    <button
                      onClick={handleAdjustBalance}
                      disabled={saving}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 rounded-lg transition-colors font-medium"
                    >
                      Apply
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Positive to add credit, negative to deduct.</p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        <div className="p-5 border-t border-gray-700 space-y-2">
          {!isNew && tab === 'details' && viewerIsAdmin && (
            confirmDelete ? (
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  className="flex-1 bg-red-700 hover:bg-red-800 text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Yes, delete {user!.name}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-red-500 hover:text-red-400 text-sm py-1 transition-colors"
              >
                Remove {user!.name}
              </button>
            )
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors"
            >
              {tab === 'balance' ? 'Close' : 'Cancel'}
            </button>
            {(isNew || tab === 'details') && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg font-semibold transition-colors"
              >
                {saving ? 'Saving…' : isNew ? 'Add Person' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
