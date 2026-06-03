import { useState, useEffect } from 'react'

export function useSwUpdate() {
  const [updated, setUpdated] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const hadController = Boolean(navigator.serviceWorker.controller)
    const handleControllerChange = () => {
      if (hadController) setUpdated(true)
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
  }, [])

  function reload() {
    window.location.reload()
  }

  return { updated, reload }
}
