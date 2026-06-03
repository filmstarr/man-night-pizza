import { useState, useEffect } from 'react'

export function useSwUpdate() {
  const [updated, setUpdated] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Only show banner if a SW was already in control (i.e. this is an update, not first install)
    const hadController = Boolean(navigator.serviceWorker.controller)
    const handleControllerChange = () => {
      if (hadController) setUpdated(true)
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
  }, [])

  useEffect(() => {
    if (!updated) return
    const t = setTimeout(() => setUpdated(false), 4000)
    return () => clearTimeout(t)
  }, [updated])

  return updated
}
