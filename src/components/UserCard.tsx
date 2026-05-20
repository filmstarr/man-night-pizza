import { useState } from 'react'
import type { User, PizzaOrder } from '../types'
import { setUserPresent, setUserSharing, setUserCurrentPizza, formatCurrency } from '../lib/firestore'
import { PizzaEditor } from './PizzaEditor'

interface Props {
  user: User
  isNextOrderer: boolean
  onEdit: (user: User) => void
}

export function UserCard({ user, isNextOrderer, onEdit }: Props) {
  const [editingPizza, setEditingPizza] = useState(false)
  const [pizza, setPizza] = useState<PizzaOrder>(user.currentPizza)

  const balanceColor = user.balance >= 0 ? 'text-green-400' : 'text-red-400'

  async function handlePresentToggle(checked: boolean) {
    await setUserPresent(user.id, checked)
  }

  async function handleSharingToggle(checked: boolean) {
    await setUserSharing(user.id, checked)
  }

  async function handleSavePizza() {
    await setUserCurrentPizza(user.id, pizza)
    setEditingPizza(false)
  }

  function handleCancelPizza() {
    setPizza(user.currentPizza)
    setEditingPizza(false)
  }

  const pizzaSummary = [
    user.currentPizza.name,
    user.currentPizza.size,
    user.currentPizza.base
  ].filter(Boolean).join(' · ')

  return (
    <div className={`rounded-lg border py-2 px-3 transition-all ${
      isNextOrderer
        ? 'border-pink-500 bg-pink-950/40 shadow-lg shadow-pink-500/20'
        : 'border-gray-700 bg-gray-800'
    }`}>
      <div className="flex items-start gap-2">
        {/* Present checkbox */}
        <div className="pt-0.5">
          <input
            type="checkbox"
            checked={user.isPresent}
            onChange={e => handlePresentToggle(e.target.checked)}
            className="w-5 h-5 accent-blue-500 cursor-pointer"
            title="Present tonight"
          />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold ${isNextOrderer ? 'text-pink-300' : 'text-white'}`}>
              {user.name}
            </span>
            {isNextOrderer && (
              <span className="text-xs bg-pink-600 text-white px-2 py-0.5 rounded-full font-medium">
                🍕 Up to order
              </span>
            )}
            <span className={`ml-auto font-mono font-bold ${balanceColor}`}>
              {formatCurrency(user.balance)}
            </span>
            <button
              onClick={() => onEdit(user)}
              className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors text-lg leading-none"
              title="Edit user"
            >
              ⚙️
            </button>
          </div>

          {/* Pizza order / sharing */}
          {user.isSharing ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-gray-500 italic flex-1">Sharing</span>
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={true}
                  onChange={e => handleSharingToggle(e.target.checked)}
                  className="accent-blue-500 cursor-pointer"
                />
                <span>Sharing</span>
              </label>
            </div>
          ) : !editingPizza ? (
            <div className="mt-1 flex items-start gap-2">
              <div className="flex-1 min-w-0 break-words text-sm text-gray-300">
                {pizzaSummary || <span className="italic text-gray-500">No pizza set</span>}
                {user.currentPizza.modifications && (
                  <span className="text-xs text-gray-500 ml-1">({user.currentPizza.modifications})</span>
                )}
              </div>
              <div className="flex flex-col items-start gap-1 shrink-0">
                <button
                  onClick={() => { setPizza(user.currentPizza); setEditingPizza(true) }}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors leading-none"
                >
                  ✏️ Edit
                </button>
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={e => handleSharingToggle(e.target.checked)}
                    className="accent-blue-500 cursor-pointer"
                  />
                  <span>Sharing</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <PizzaEditor pizza={pizza} onChange={setPizza} compact />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSavePizza}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setPizza(user.defaultPizza)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs py-1.5 rounded transition-colors"
                  title="Reset to default pizza"
                >
                  Reset
                </button>
                <button
                  onClick={handleCancelPizza}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs py-1.5 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!user.isSharing && user.currentPizza.sides && !editingPizza && (
            <div className="mt-1 text-xs text-gray-500">Dip: {user.currentPizza.sides}</div>
          )}
        </div>
      </div>
    </div>
  )
}
