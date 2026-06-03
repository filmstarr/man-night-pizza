interface Props {
  onEnable: () => void
  onDismiss: () => void
  loading: boolean
}

export function NotificationBanner({ onEnable, onDismiss, loading }: Props) {
  return (
    <div className="rounded-lg border border-blue-700/50 bg-blue-950/30 p-3 flex items-center gap-3 mb-4">
      <div className="flex-1 text-sm text-blue-300">
        Enable push notifications to get reminded when it's your turn to order.
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onEnable}
          disabled={loading}
          className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 rounded transition-colors"
        >
          {loading ? '…' : 'Enable'}
        </button>
        <button
          onClick={onDismiss}
          className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 transition-colors"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
