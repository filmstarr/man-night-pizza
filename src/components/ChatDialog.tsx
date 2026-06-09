import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import type { User, ChatMessage, QuotedMessage } from '../types'
import { sendMessage, loadMoreMessages, setChatNotificationsEnabled, markMessagesRead, addReaction, removeReaction, notifyReaction, deleteMessage, editMessage } from '../lib/firestore'

const EmojiPicker = lazy(() => import('emoji-picker-react'))
import { Theme as EmojiTheme } from 'emoji-picker-react'


function ReactionPills({ reactions, currentUserId, userMap }: {
  reactions: Record<string, string[]>
  currentUserId: string
  userMap: Record<string, string>
}) {
  const [showSummary, setShowSummary] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showSummary) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (!pillRef.current?.contains(e.target as Node)) setShowSummary(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [showSummary])

  const entries = Object.entries(reactions).filter(([, uids]) => uids.length > 0)
  if (entries.length === 0) return null

  const totalCount = entries.reduce((sum, [, uids]) => sum + uids.length, 0)
  const allEmojis = entries.map(([emoji]) => emoji).join('')
  const iOwn = entries.some(([, uids]) => uids.includes(currentUserId))

  const userReactions: Record<string, string[]> = {}
  for (const [emoji, uids] of entries) {
    for (const uid of uids) {
      if (!userReactions[uid]) userReactions[uid] = []
      userReactions[uid].push(emoji)
    }
  }

  return (
    <div ref={pillRef} className="relative mt-1 self-start">
      <button
        onClick={() => setShowSummary(s => !s)}
        className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
          iOwn
            ? 'bg-blue-600/30 border border-blue-500 text-white'
            : 'bg-gray-700 border border-gray-600 text-gray-200 hover:bg-gray-600'
        }`}
      >
        <span>{allEmojis}</span>
        <span className="text-gray-400">{totalCount}</span>
      </button>
      {showSummary && (
        <div className="absolute bottom-full mb-1 left-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 z-10 shadow-lg min-w-max">
          {Object.entries(userReactions).map(([uid, emojis]) => (
            <div key={uid} className="flex items-center gap-2 py-0.5">
              <span className="text-gray-400">{userMap[uid] ?? 'Someone'}</span>
              <span>{emojis.join(' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
  draft?: string
  onDraftChange?: (draft: string) => void
}

export function ChatDialog({ currentUser, users, messages, pinned, onPinChange, onClose, permissionState, requestPermission, onMessageSent, draft = '', onDraftChange }: Props) {
  const [text, setText] = useState(draft)
  const updateText = (value: string) => { setText(value); onDraftChange?.(value) }
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
  const [pickerMsgId, setPickerMsgId] = useState<string | null>(null)
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const [pressedMsgId, setPressedMsgId] = useState<string | null>(null)
  const [quotingMessage, setQuotingMessage] = useState<QuotedMessage | null>(null)
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<{ id: string; originalText: string } | null>(null)
  const pickerContainerRef = useRef<HTMLDivElement>(null)
  const chatPanelRef = useRef<HTMLDivElement>(null)
  const inputAreaRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Merge subscription updates into allMessages — add new messages and update
  // changed fields (e.g. reactions) on existing ones. Never remove messages.
  useEffect(() => {
    setAllMessages(prev => {
      const existingById = new Map(prev.map(m => [m.id, m]))
      let changed = false
      for (const m of messages) {
        const existing = existingById.get(m.id)
        if (!existing) {
          existingById.set(m.id, m)
          changed = true
        } else if (existing.reactions !== m.reactions || existing.deleted !== m.deleted || existing.text !== m.text || existing.edited !== m.edited) {
          existingById.set(m.id, { ...existing, reactions: m.reactions, deleted: m.deleted, text: m.text, edited: m.edited })
          changed = true
        }
      }
      if (!changed) return prev
      return [...existingById.values()].sort((a, b) => a.createdAt - b.createdAt)
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

  // Clear pressedMsgId when the user touches outside the reaction button container
  useEffect(() => {
    if (!pressedMsgId) return
    const handler = (e: TouchEvent) => {
      if (!(e.target as Element).closest('[data-reaction-btns]')) {
        setPressedMsgId(null)
      }
    }
    const id = setTimeout(() => document.addEventListener('touchstart', handler), 100)
    return () => { clearTimeout(id); document.removeEventListener('touchstart', handler) }
  }, [pressedMsgId])

  // Block touchmove on non-scrollable parts of the dialog (header, input area)
  // so they don't bleed through to the underlying page on iOS
  useEffect(() => {
    const el = containerRef.current
    if (!el || pinned) return
    const prevent = (e: TouchEvent) => {
      const scroll = scrollRef.current
      const insideScroll = scroll?.contains(e.target as Node)
      // Prevent if outside the scroll area, or inside it but nothing to scroll
      if (!insideScroll || (scroll && scroll.scrollHeight <= scroll.clientHeight)) {
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
      if (editingMessage) {
        await editMessage(editingMessage.id, trimmed)
        setAllMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: trimmed, edited: true } : m))
        setEditingMessage(null)
      } else {
        const quote = quotingMessage ?? undefined
        await sendMessage(currentUser.id, trimmed, quote)
        setQuotingMessage(null)
        onMessageSent(currentUser.name, trimmed)
      }
      updateText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
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

  async function handleToggleReaction(msgId: string, emoji: string) {
    const msg = allMessages.find(m => m.id === msgId)
    if (!msg) return
    const alreadyReacted = (msg.reactions?.[emoji] ?? []).includes(currentUser.id)
    if (alreadyReacted) {
      await removeReaction(msgId, emoji, currentUser.id)
    } else {
      await addReaction(msgId, emoji, currentUser.id)
      if (msg.userId !== currentUser.id) {
        notifyReaction(currentUser.id, currentUser.name, msg.userId, emoji).catch(() => {})
      }
    }
  }

  async function handleDeleteMessage(msgId: string) {
    setPressedMsgId(null)
    await deleteMessage(msgId)
    setAllMessages(prev => prev.map(m => m.id === msgId ? { ...m, deleted: true } : m))
  }

  async function handleClearReactions(msgId: string) {
    const msg = allMessages.find(m => m.id === msgId)
    if (!msg?.reactions) return
    await Promise.all(
      Object.entries(msg.reactions)
        .filter(([, uids]) => uids.includes(currentUser.id))
        .map(([emoji]) => removeReaction(msgId, emoji, currentUser.id))
    )
  }

  function openPicker(msgId: string, rect: DOMRect) {
    setPickerMsgId(msgId)
    setPickerAnchor(rect)
  }

  function closePicker() {
    setPickerMsgId(null)
    setPickerAnchor(null)
  }

  function getPickerStyle(): React.CSSProperties {
    if (!pickerAnchor) return {}
    const chatRect = chatPanelRef.current?.getBoundingClientRect()
    const left = (chatRect?.left ?? 0) + 12
    const width = chatRect ? chatRect.width - 24 : undefined
    const spaceBelow = window.innerHeight - pickerAnchor.bottom
    if (spaceBelow >= 360) {
      return { position: 'fixed', left, width, top: pickerAnchor.bottom + 4 }
    }
    return { position: 'fixed', left, width, bottom: window.innerHeight - pickerAnchor.top + 4 }
  }

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
    <>
      {!pinned && <div className="fixed inset-0 z-40 bg-gray-950 lg:hidden" aria-hidden="true" />}
      <div ref={containerRef} className={pinned ? 'fixed right-0 top-0 z-40 flex' : 'fixed inset-x-0 top-0 z-50 lg:flex'} style={pinned ? { height: '100dvh' } : undefined}>
      {!pinned && <div className="hidden lg:block flex-1 bg-black/30 cursor-pointer" onClick={onClose} />}
      <div ref={chatPanelRef} className="flex flex-col h-full w-full lg:w-96 bg-gray-950 lg:border-l lg:border-gray-800">
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-y-contain px-3 select-none">
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
              const hasOwnReaction = !!(msg.reactions && Object.values(msg.reactions).some(uids => uids.includes(currentUser.id)))

              return (
                <div
                  key={msg.id}
                  className={`flex ${groupEnd ? 'mb-3' : 'mb-0.5'} ${isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                    {showName && (
                      <span className="text-xs text-gray-400 mb-1 px-1">{senderName}</span>
                    )}
                    <div
                      className="relative group"
                      data-bubble
                      onTouchStart={e => {
                        const el = e.currentTarget
                        longPressTimerRef.current = setTimeout(() => {
                          longPressTimerRef.current = null
                          if (!isOwn) openPicker(msg.id, el.getBoundingClientRect())
                        }, 500)
                      }}
                      onTouchEnd={e => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current)
                          longPressTimerRef.current = null
                          if (!(e.target as Element).closest('[data-reaction-btns]')) {
                            setPressedMsgId(prev => prev === msg.id ? null : msg.id)
                          }
                        }
                      }}
                      onTouchMove={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null } }}
                    >
                      <div className={`px-3 py-1.5 rounded-[17px] ${isOwn ? `bg-blue-600 text-white ${groupEnd ? 'rounded-br-none' : ''}` : `bg-gray-800 text-white ${groupEnd ? 'rounded-bl-none' : ''}`}`}>
                        {msg.deleted ? (
                          <p className="text-sm italic opacity-50">Message deleted</p>
                        ) : (
                          <>
                            {msg.quotedMessage && (
                              <div className={`mb-1.5 pl-2 border-l-2 rounded-lg text-xs ${isOwn ? 'border-white/70 bg-black/30' : 'border-blue-400 bg-black/40'} px-2 py-1.5`}>
                                <div className={`font-semibold mb-0.5 ${isOwn ? 'text-white/90' : 'text-blue-300'}`}>{userMap[msg.quotedMessage.userId] ?? 'Unknown'}</div>
                                <div className={`truncate ${isOwn ? 'text-white/80' : 'text-gray-300'}`}>{msg.quotedMessage.text}</div>
                              </div>
                            )}
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                            {msg.edited && <p className="text-[10px] italic opacity-50 text-right">edited</p>}
                          </>
                        )}
                      </div>
                      {!msg.deleted && <div
                        data-reaction-btns
                        className={`absolute top-1/2 -translate-y-1/2 transition-opacity flex-col items-center gap-1 ${isOwn ? 'right-full mr-1' : 'left-full ml-1'} ${pressedMsgId === msg.id ? 'flex opacity-100' : 'hidden sm:flex opacity-0 group-hover:opacity-100'}`}
                      >
                        {/* React/delete + clear — merged pill (top) */}
                        <div className="flex items-center rounded-full bg-gray-700 overflow-hidden">
                          {isOwn ? (
                            confirmDeleteMsgId === msg.id ? (
                              <>
                                <button
                                  onClick={() => { setConfirmDeleteMsgId(null); handleDeleteMessage(msg.id) }}
                                  className="flex items-center justify-center w-9 h-9 sm:w-6 sm:h-6 hover:bg-green-700 leading-none"
                                  title="Confirm delete"
                                >
                                  <svg className="w-4 h-4 sm:w-3 sm:h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1.5 6.5 4.5 9.5 10.5 2.5"/>
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteMsgId(null)}
                                  className="flex items-center justify-center w-9 h-9 sm:w-6 sm:h-6 hover:bg-gray-600 leading-none"
                                  title="Cancel"
                                >
                                  <svg className="w-4 h-4 sm:w-3 sm:h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                    <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => setConfirmDeleteMsgId(msg.id)}
                                  className="flex items-center justify-center w-9 h-9 sm:w-6 sm:h-6 hover:bg-red-700 leading-none"
                                  title="Delete message"
                                >
                                  <svg className="w-4 h-4 sm:w-3 sm:h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1 3 11 3"/><path d="M2 3l.7 7.3A1 1 0 0 0 3.7 11h4.6a1 1 0 0 0 1-.7L10 3"/><path d="M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1"/>
                                  </svg>
                                </button>
                                <button
                                  onClick={() => {
                                    setPressedMsgId(null)
                                    setQuotingMessage(null)
                                    setEditingMessage({ id: msg.id, originalText: msg.text })
                                    updateText(msg.text)
                                    const ta = textareaRef.current
                                    if (ta) {
                                      ta.focus()
                                      requestAnimationFrame(() => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px` })
                                    }
                                  }}
                                  className="flex items-center justify-center w-9 h-9 sm:w-6 sm:h-6 hover:bg-gray-600 leading-none"
                                  title="Edit message"
                                >
                                  <svg className="w-4 h-4 sm:w-3 sm:h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8.5 1.5a1.2 1.2 0 0 1 1.7 1.7L3.5 9.9l-2.5.6.6-2.5Z"/>
                                  </svg>
                                </button>
                              </>
                            )
                          ) : (
                            <button
                              onClick={e => {
                                setPressedMsgId(null)
                                const bubble = (e.currentTarget.closest('[data-bubble]') ?? e.currentTarget) as Element
                                openPicker(msg.id, bubble.getBoundingClientRect())
                              }}
                              className="flex items-center justify-center w-9 h-9 sm:w-6 sm:h-6 hover:bg-gray-600 text-base sm:text-sm leading-none"
                              title="Add reaction"
                            >😊</button>
                          )}
                          {hasOwnReaction && (
                            <button
                              onClick={() => { setPressedMsgId(null); handleClearReactions(msg.id) }}
                              className="flex items-center justify-center w-9 h-9 sm:w-6 sm:h-6 hover:bg-gray-600 leading-none"
                              title="Clear your reactions"
                            >
                              <svg className="w-4 h-4 sm:w-3 sm:h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                              </svg>
                            </button>
                          )}
                        </div>
                        {/* Reply — separate pill (bottom) */}
                        <button
                          onClick={() => {
                            setPressedMsgId(null)
                            if (editingMessage) {
                              setEditingMessage(null)
                              updateText('')
                              if (textareaRef.current) textareaRef.current.style.height = 'auto'
                            }
                            setQuotingMessage({ id: msg.id, userId: msg.userId, text: msg.text })
                            textareaRef.current?.focus()
                          }}
                          className="flex items-center justify-center w-9 h-9 sm:w-6 sm:h-6 rounded-full bg-gray-700 hover:bg-gray-600 leading-none"
                          title="Quote"
                        >
                          <svg className="w-4 h-4 sm:w-3 sm:h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="4.5 8.5 2 6 4.5 3.5"/><path d="M10 9v-1a2 2 0 0 0-2-2H2"/>
                          </svg>
                        </button>
                      </div>}
                    </div>
                    {!msg.deleted && msg.reactions && (
                      <ReactionPills
                        reactions={msg.reactions}
                        currentUserId={currentUser.id}
                        userMap={userMap}
                      />
                    )}
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

      {/* Editing preview */}
      {editingMessage && (
        <div className="border-t border-gray-800 px-4 py-2 flex items-center gap-2 bg-gray-900 shrink-0">
          <div className="flex-1 border-l-2 border-yellow-500 pl-2 min-w-0">
            <div className="text-xs text-yellow-400 font-medium">Editing message</div>
            <div className="text-xs text-gray-400 truncate">{editingMessage.originalText}</div>
          </div>
          <button onClick={() => { setEditingMessage(null); updateText(''); if (textareaRef.current) textareaRef.current.style.height = 'auto' }} className="text-gray-500 hover:text-gray-300 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
            </svg>
          </button>
        </div>
      )}

      {/* Quote preview */}
      {quotingMessage && (
        <div className="border-t border-gray-800 px-4 py-2 flex items-center gap-2 bg-gray-900 shrink-0">
          <div className="flex-1 border-l-2 border-blue-500 pl-2 min-w-0">
            <div className="text-xs text-blue-400 font-medium">{userMap[quotingMessage.userId] ?? 'Unknown'}</div>
            <div className="text-xs text-gray-400 truncate">{quotingMessage.text}</div>
          </div>
          <button onClick={() => setQuotingMessage(null)} className="text-gray-500 hover:text-gray-300 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
            </svg>
          </button>
        </div>
      )}

      {/* Input */}
      <div ref={inputAreaRef} className="border-t border-gray-800 px-4 pt-3 flex gap-2 items-end shrink-0" style={{ paddingBottom: keyboardVisible ? '0.75rem' : 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <textarea
          rows={1}
          value={text}
          onChange={e => {
            updateText(e.target.value)
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
    </div>
    {pickerMsgId && pickerAnchor && (
      <Suspense fallback={null}>
        <div className="fixed inset-0 z-[9999]" onClick={closePicker}>
          <div ref={pickerContainerRef} style={getPickerStyle()} onClick={e => e.stopPropagation()}>
            <EmojiPicker
              theme={EmojiTheme.DARK}
              reactionsDefaultOpen={true}
              autoFocusSearch={false}
              allowExpandReactions={true}
              previewConfig={{showPreview: false}}
              width="100%"
              height={350}
              onEmojiClick={({ emoji }) => {
                handleToggleReaction(pickerMsgId, emoji)
                closePicker()
              }}
            />
          </div>
        </div>
      </Suspense>
    )}
    </>,
    document.body
  )
}
