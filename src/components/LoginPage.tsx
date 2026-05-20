import { useState, useEffect } from 'react'
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { isEmailAllowed } from '../lib/firestore'

const googleProvider = new GoogleAuthProvider()

type Step = 'email' | 'password' | 'reset-sent' | 'reset-password'

export function LoginPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [oobCode, setOobCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Detect in-app password reset link (?mode=resetPassword&oobCode=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    const code = params.get('oobCode')
    if (mode === 'resetPassword' && code) {
      verifyPasswordResetCode(auth, code)
        .then(verifiedEmail => {
          setEmail(verifiedEmail)
          setOobCode(code)
          setStep('reset-password')
          window.history.replaceState(null, '', window.location.pathname)
        })
        .catch(() => {
          setError('This reset link is invalid or has expired.')
        })
    }
  }, [])

  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const allowed = await isEmailAllowed(email)
      if (!allowed) {
        setError('This email address is not authorised.')
        return
      }
      setStep('password')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? ''
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setError('Incorrect password.')
      } else {
        const msg = err instanceof Error ? err.message : 'Sign-in failed'
        setError(msg.replace('Firebase: ', '').replace(/\(auth\/[^)]+\)/, '').trim())
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword() {
    setError('')
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, email, { url: window.location.origin, handleCodeInApp: false })
      setStep('reset-sent')
    } catch {
      setError('Failed to send reset email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    try {
      await confirmPasswordReset(auth, oobCode, newPassword)
      await signInWithEmailAndPassword(auth, email, newPassword)
    } catch {
      setError('Failed to set password. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSignIn() {
    setError('')
    setLoading(true)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const userEmail = result.user.email ?? ''
      const allowed = await isEmailAllowed(userEmail)
      if (!allowed) {
        await signOut(auth)
        setError('This Google account is not authorised.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed'
      if (!msg.includes('popup-closed-by-user') && !msg.includes('cancelled-popup-request')) {
        setError(msg.replace('Firebase: ', '').replace(/\(auth\/[^)]+\)/, '').trim())
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Man Night Pizza" className="h-24 w-24 rounded-2xl mx-auto mb-1" />
          <h1 className="text-2xl font-bold text-white">Man Night Pizza</h1>
          <p className="text-gray-500 text-sm mt-1">Because you cannot live on snacks alone… just pizza.</p>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-700 p-6">

          {/* ── In-app password reset ── */}
          {step === 'reset-password' && (
            <form onSubmit={handleConfirmReset} className="space-y-4">
              <div>
                <p className="text-sm text-gray-400 mb-4">
                  Setting a new password for <span className="text-white">{email}</span>.
                </p>
                <label className="block text-sm font-medium text-gray-300 mb-1">New password</label>
                <input
                  type="password"
                  required
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Confirm password</label>
                <input
                  type="password"
                  required
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold transition-colors"
              >
                {loading ? '…' : 'Set password & sign in'}
              </button>
            </form>
          )}

          {/* ── Reset email sent ── */}
          {step === 'reset-sent' && (
            <div className="text-center space-y-3">
              <div className="text-3xl">📬</div>
              <p className="text-white font-medium">Check your email</p>
              <p className="text-gray-400 text-sm">
                A password reset link has been sent to <span className="text-white">{email}</span>.
              </p>
              <button
                onClick={() => { setStep('password'); setError('') }}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* ── Email step ── */}
          {step === 'email' && (
            <div className="space-y-4">
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 disabled:opacity-50 text-gray-800 py-2.5 rounded-lg font-semibold transition-colors"
              >
                <GoogleIcon />
                Sign in with Google
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-700" />
                <span className="text-xs text-gray-500">or</span>
                <div className="flex-1 h-px bg-gray-700" />
              </div>

              <form onSubmit={handleEmailContinue} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Email address</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold transition-colors"
                >
                  {loading ? '…' : 'Continue'}
                </button>
              </form>
            </div>
          )}

          {/* ── Password step ── */}
          {step === 'password' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setStep('email'); setError(''); setPassword('') }}
                  className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
                >
                  ←
                </button>
                <span className="text-sm text-gray-400 truncate">{email}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold transition-colors"
              >
                {loading ? '…' : 'Sign in'}
              </button>
              <div className="text-right">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}
