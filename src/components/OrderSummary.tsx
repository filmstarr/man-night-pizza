import type { User } from '../types'

function buildNotifyHref(orderer: User): string {
  const to = orderer.emails.join(',')
  const subject = encodeURIComponent('Man Night Pizza - Your turn to order!')
  const body = encodeURIComponent(
    `Hi ${orderer.name},\n\nIt's your turn to order pizza next 🍕.\n\nCheers`
  )
  return `mailto:${to}?subject=${subject}&body=${body}`
}

interface Props {
  users: User[]
  nextOrdererId: string | null
}

export function OrderSummary({ users, nextOrdererId }: Props) {
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

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Order Summary · {presentUsers.length} {presentUsers.length === 1 ? 'person' : 'people'}
      </h2>

      {nextOrderer && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm text-pink-300 font-medium">
            🍕 {nextOrderer.name} is ordering next
          </span>
          {nextOrderer.emails.length > 0 && (
            <a
              href={buildNotifyHref(nextOrderer)}
              className="text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 px-2 py-1 rounded transition-colors shrink-0"
              title={`Email ${nextOrderer.name}`}
            >
              Notify 📬
            </a>
          )}
        </div>
      )}

      <div className="space-y-2">
        {presentUsers.map(user => {
          const pizzaLine = [user.currentPizza.name, user.currentPizza.size, user.currentPizza.base]
            .filter(Boolean)
            .join(' · ')

          return (
            <div key={user.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className={`font-medium ${user.id === nextOrdererId ? 'text-pink-300' : 'text-white'}`}>
                  {user.name}:
                </span>
                {user.isSharing ? (
                  <span className="italic text-gray-500">Sharing</span>
                ) : (
                  <span className="text-gray-300 flex-1">{pizzaLine || <span className="italic text-gray-500">No pizza set</span>}</span>
                )}
              </div>
              {(user.currentPizza.modifications || user.currentPizza.sides) && (!user.isSharing || user.currentPizza.sides) && (
                <div className="text-xs text-gray-500 mt-0.5">
                  {[!user.isSharing && user.currentPizza.modifications, user.currentPizza.sides && `Dip: ${user.currentPizza.sides}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500">
        + sides, cookies, etc.
      </div>
    </div>
  )
}
