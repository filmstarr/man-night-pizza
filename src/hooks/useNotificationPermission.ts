import { useState, useEffect, useCallback } from 'react'
import { requestNotificationToken } from '../lib/firebase'
import { saveFcmToken } from '../lib/firestore'
import type { User } from '../types'

type PermState = NotificationPermission | 'unsupported' | 'unknown'

export function useNotificationPermission(currentUser: User | undefined) {
  const [permissionState, setPermissionState] = useState<PermState>('unknown')
  const [enrolling, setEnrolling] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    if (!('Notification' in window)) {
      setPermissionState('unsupported')
      return
    }
    const perm = Notification.permission
    setPermissionState(perm)
    // Refresh token on every login when already granted
    if (perm === 'granted') {
      requestNotificationToken().then(token => {
        if (token) saveFcmToken(currentUser.id, token)
      })
    }
  }, [currentUser?.id])

  const requestPermission = useCallback(async () => {
    if (!currentUser || enrolling) return
    setEnrolling(true)
    try {
      const perm = await Notification.requestPermission()
      setPermissionState(perm)
      if (perm === 'granted') {
        const token = await requestNotificationToken()
        if (token) await saveFcmToken(currentUser.id, token)
      }
    } finally {
      setEnrolling(false)
    }
  }, [currentUser, enrolling])

  return { permissionState, requestPermission, enrolling }
}
