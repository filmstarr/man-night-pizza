import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { User, ChatMessage } from '../types'
import { sendMessage, loadMoreMessages, setChatNotificationsEnabled, markMessagesRead } from '../lib/firestore'

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

interface Props {
  currentUser: User
  users: User[]
  messages: ChatMessage[]
  pinned: boolean
  onPinChange: (pinned: boolean) => void
  onClose: () => void
  permissionState: NotificationPermission | 'unsupported' | 'unknown'
  requestPermission: () => Promise<void>
  onMessageSent: (senderName: string, text: string) => void
}

export function ChatDialog({ currentUser, users, messages, pinned, onPinChange, onClose, permissionState, requestPermission, onMessageSent }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // Single accumulator — messages only ever get added, never removed
  const [allMessages, setAllMessages] = useState<ChatMessage[]>(() => [...messages])
  const [hasMore, setHasMore] = useState(() => messages.length >= 100)
  const [loadingMore, setLoadingMore] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isFirstRender = useRef(true)
  const initialLastReadAt = useRef(currentUser.lastReadAt ?? 0)
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevLastMessageIdRef = useRef<string | null>(messages[messages.length - 1]?.id ?? null)
  const lastLoadedBeforeRef = useRef<number | null>(null)

  function scheduleMarkRead() {
    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current)
    markReadTimerRef.current = setTimeout(() => {
      const el = scrollRef.current
      if (!el) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
        markMessagesRead(currentUser.id).catch(() => {})
      }
    }, 1000)
  }

  // Merge new messages from the subscription into allMessages.
  // We only add — never remove — so messages can never disappear as the
  // subscription window slides forward.
  useEffect(() => {
    setAllMessages(prev => {
      const existingIds = new Set(prev.map(m => m.id))
      const toAdd = messages.filter(m => !existingIds.has(m.id))
      if (toAdd.length === 0) return prev
      return [...prev, ...toAdd].sort((a, b) => a.createdAt - b.createdAt)
    })
  }, [messages])

  // Lock body scroll when open fullscreen (not pinned)
  // Uses position:fixed trick because overflow:hidden alone doesn't work on iOS Safari
  useEffect(() => {
    if (pinned) return
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [pinned])

  // Mark messages as read when user scrolls to (or near) the bottom
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = () => scheduleMarkRead()
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current)
    }
  }, [])

  // Block touchmove on non-scrollable parts of the dialog (header, input area)
  // so they don't bleed through to the underlying page on iOS
  useEffect(() => {
    const el = containerRef.current
    if (!el || pinned) return
    const prevent = (e: TouchEvent) => {
      if (!scrollRef.current?.contains(e.target as Node)) {
        e.preventDefault()
      }
    }
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => el.removeEventListener('touchmove', prevent)
  }, [pinned])

  // iOS keyboard fix: resize container to match the visual viewport.
  // Scroll compensation: sample scrollTop/clientHeight synchronously BEFORE the height
  // change, then apply the diff in a rAF. rAF fires after React microtasks, so the
  // safe-area padding re-render has already happened and newClientHeight is the true
  // final value — covering both keyboard height and safe-area changes in one step.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !containerRef.current) return
    let maxHeight = vv.height
    const update = () => {
      const el = containerRef.current
      const scroll = scrollRef.current
      if (!el) return

      // When pinned, React's style prop (height:100dvh) handles sizing — don't touch it
      if (pinned) return

      // 1. Sample before layout changes
      const prevScrollTop = scroll?.scrollTop ?? 0
      const prevClientHeight = scroll?.clientHeight ?? 0
      const prevScrollHeight = scroll?.scrollHeight ?? 0

      // 2. Resize container + update keyboard state (schedules React re-render)
      const newHeight = vv.height
      el.style.height = `${newHeight}px`
      el.style.top = `${vv.offsetTop}px`
      maxHeight = Math.max(maxHeight, newHeight)
      setKeyboardVisible(newHeight < maxHeight - 100)

      // 3. After rAF (React re-render already flushed), apply total scroll diff.
      //    If already at the bottom, snap to the new bottom so this doesn't race
      //    with a concurrent scroll-to-bottom from a new message arriving.
      if (scroll && prevClientHeight > 0) {
        requestAnimationFrame(() => {
          const diff = prevClientHeight - scroll.clientHeight
          if (diff === 0) return
          const wasAtBottom = prevScrollTop >= prevScrollHeight - prevClientHeight - 10
          scroll.scrollTop = wasAtBottom
            ? scroll.scrollHeight - scroll.clientHeight
            : prevScrollTop + diff
        })
      }
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [pinned])

  // Scroll to bottom on first render, and when a new message arrives if own or near bottom.
  useEffect(() => {
    if (isFirstRender.current) {
      bottomRef.current?.scrollIntoView()
      isFirstRender.current = false
      scheduleMarkRead()
      return
    }
    const latest = allMessages[allMessages.length - 1]
    if (!latest || latest.id === prevLastMessageIdRef.current) return
    prevLastMessageIdRef.current = latest.id

    const el = scrollRef.current
    const isOwn = latest.userId === currentUser.id
    const isNearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 150 : false
    if (isOwn || isNearBottom) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        scheduleMarkRead()
      })
    }
  }, [allMessages])

  // Auto-load more when sentinel scrolls into view
  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleLoadMore() },
      { root: scrollRef.current, threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  })

  async function handleLoadMore() {
    if (!hasMore || loadingMore) return
    const oldest = allMessages[0]?.createdAt
    if (oldest == null || oldest === lastLoadedBeforeRef.current) return
    lastLoadedBeforeRef.current = oldest
    setLoadingMore(true)
    const container = scrollRef.current
    const prevHeight = container?.scrollHeight ?? 0
    try {
      const more = await loadMoreMessages(oldest)
      if (more.length === 0) { setHasMore(false); return }
      if (more.length < 100) setHasMore(false)
      setAllMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id))
        const toAdd = more.filter(m => !existingIds.has(m.id))
        if (toAdd.length === 0) return prev
        return [...toAdd, ...prev]
      })
      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - prevHeight
      })
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleSend() {
    if (!text.trim() || sending) return
    setSending(true)
    const trimmed = text.trim()
    try {
      await sendMessage(currentUser.id, trimmed)
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      onMessageSent(currentUser.name, trimmed)
    } finally {
      setSending(false)
    }
  }

  async function handleNotifToggle() {
    if (permissionState === 'denied' || permissionState === 'unsupported') return
    if (permissionState !== 'granted') {
      await requestPermission()
      // After granting, enable — the updated permissionState will be reflected next render,
      // but we optimistically enable if permission was just granted.
      if (Notification.permission === 'granted') {
        await setChatNotificationsEnabled(currentUser.id, true)
      }
      return
    }
    await setChatNotificationsEnabled(currentUser.id, currentUser.chatNotificationsEnabled === false)
  }

  const notifEnabled = permissionState === 'granted' && currentUser.chatNotificationsEnabled !== false
  const notifDisabled = permissionState === 'denied' || permissionState === 'unsupported'

  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]))

  // Build flat list with date separators + new-messages divider, annotated with group boundaries
  type MsgItem = { type: 'msg'; msg: ChatMessage; showName: boolean; showTime: boolean; groupEnd: boolean }
  type Item = { type: 'date'; label: string; key: string } | { type: 'new'; key: string } | MsgItem
  const items: Item[] = []
  let lastDate = ''
  for (const msg of allMessages) {
    const dateStr = formatDate(msg.createdAt)
    if (dateStr !== lastDate) {
      items.push({ type: 'date', label: dateStr, key: `date-${msg.id}` })
      lastDate = dateStr
    }
    items.push({ type: 'msg', msg, showName: false, showTime: false, groupEnd: false })
  }
  // Insert "New messages" divider before the first unread message from others
  if (initialLastReadAt.current > 0) {
    const dividerIdx = items.findIndex(
      item => item.type === 'msg' &&
      item.msg.userId !== currentUser.id &&
      item.msg.createdAt > initialLastReadAt.current
    )
    if (dividerIdx !== -1) {
      items.splice(dividerIdx, 0, { type: 'new', key: 'new-divider' })
    }
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type !== 'msg') continue
    const prev = items[i - 1]
    const next = items[i + 1]
    const prevMsg = prev?.type === 'msg' ? prev : undefined
    const nextMsg = next?.type === 'msg' ? next : undefined
    const startsGroup =
      !prevMsg ||
      prev?.type === 'date' ||
      prev?.type === 'new' ||
      prevMsg.msg.userId !== item.msg.userId ||
      item.msg.createdAt - prevMsg.msg.createdAt >= 60_000
    const endsGroup =
      !nextMsg ||
      next?.type === 'date' ||
      next?.type === 'new' ||
      nextMsg.msg.userId !== item.msg.userId ||
      nextMsg.msg.createdAt - item.msg.createdAt >= 60_000
    item.showName = startsGroup && item.msg.userId !== currentUser.id
    item.showTime = endsGroup
    item.groupEnd = endsGroup
  }

  return createPortal(
    <div ref={containerRef} className={pinned ? 'fixed right-0 top-0 z-40 flex' : 'fixed inset-x-0 top-0 z-50 lg:flex'} style={pinned ? { height: '100dvh' } : undefined}>
      {!pinned && <div className="hidden lg:block flex-1 bg-black/30 cursor-pointer" onClick={onClose} />}
      <div className="flex flex-col h-full w-full lg:w-96 bg-gray-950 lg:border-l lg:border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 border-b border-gray-800 shrink-0 h-[57px]">
        <h2 className="text-base font-semibold text-white">Pizza Chat 🍕</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNotifToggle}
            disabled={notifDisabled}
            title={
              notifDisabled
                ? 'Notifications blocked by browser'
                : notifEnabled
                  ? 'Mute chat notifications'
                  : 'Enable chat notifications'
            }
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 ${
              notifEnabled
                ? 'text-pink-600 hover:text-pink-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={notifEnabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              {!notifEnabled && <line x1="2" y1="2" x2="22" y2="22"/>}
            </svg>
          </button>
          <button
            onClick={() => onPinChange(!pinned)}
            className={`hidden lg:flex items-center transition-colors p-1 ${pinned ? 'text-white' : 'text-gray-500 hover:text-white'}`}
            title={pinned ? 'Unpin' : 'Pin to sidebar'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="17" x2="12" y2="22"/>
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" fill={pinned ? 'currentColor' : 'none'}/>
            </svg>
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-3xl sm:text-xl leading-none p-1 -mr-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-y-contain px-3">
        {allMessages.length === 0 ? (
          <p className="text-center text-gray-500 text-sm mt-8 italic">No messages yet. Say hello! 👋</p>
        ) : (
          <div>
            {hasMore && (
              <div ref={topSentinelRef} className="flex justify-center py-3">
                {loadingMore && <span className="text-xs text-gray-500">Loading…</span>}
              </div>
            )}
            {items.map(item => {
              if (item.type === 'date') {
                return (
                  <div key={item.key} className="flex items-center gap-3 py-4">
                    <div className="flex-1 h-px bg-gray-800" />
                    <span className="text-xs text-gray-500 shrink-0">{item.label}</span>
                    <div className="flex-1 h-px bg-gray-800" />
                  </div>
                )
              }

              if (item.type === 'new') {
                return (
                  <div key={item.key} className="flex items-center gap-3 py-3">
                    <div className="flex-1 h-px bg-pink-600/50" />
                    <span className="text-xs text-pink-500 shrink-0 font-medium">New messages</span>
                    <div className="flex-1 h-px bg-pink-600/50" />
                  </div>
                )
              }

              const { msg, showName, showTime, groupEnd } = item
              const isOwn = msg.userId === currentUser.id
              const senderName = userMap[msg.userId] ?? 'Unknown'

              return (
                <div key={msg.id} className={`flex ${groupEnd ? 'mb-3' : 'mb-0.5'} ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                    {showName && (
                      <span className="text-xs text-gray-400 mb-1 px-1">{senderName}</span>
                    )}
                    <div className={`px-3 py-1.5 rounded-[17px] ${isOwn ? `bg-blue-600 text-white ${groupEnd ? 'rounded-br-none' : ''}` : `bg-gray-800 text-white ${groupEnd ? 'rounded-bl-none' : ''}`}`}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                    </div>
                    {showTime && (
                      <span className="text-[10px] text-gray-500 mt-1 px-1">{formatTime(msg.createdAt)}</span>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 px-4 pt-3 flex gap-2 items-end shrink-0" style={{ paddingBottom: keyboardVisible ? '0.75rem' : 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <textarea
          rows={1}
          value={text}
          onChange={e => {
            setText(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${e.target.scrollHeight}px`
          }}
          onKeyDown={e => {
            const isMobile = navigator.maxTouchPoints > 0
            if (e.key === 'Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); handleSend() }
          }}
          placeholder="Message…"
          ref={textareaRef}
          className="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-600 text-white placeholder-gray-500 rounded-xl px-3 py-2 text-sm outline-none transition-colors resize-none overflow-hidden"
          style={{ maxHeight: '8rem' }}
        />
        <button
          onClick={handleSend}
          onMouseDown={e => e.preventDefault()}
          disabled={!text.trim() || sending}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl px-3 py-2 transition-colors shrink-0 flex items-center justify-center"
          title="Send"
        >
          {sending ? (
            <span className="text-sm">…</span>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          )}
        </button>
      </div>
      </div>
    </div>,
    document.body
  )
}
