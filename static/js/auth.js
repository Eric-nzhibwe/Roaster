/**
 * auth.js — loaded only after Firebase is initialised (injected by base.html)
 * so window._firebaseAuth and window.firebaseAuth are always available.
 */

// ─────────────────────────────────────────────
// CSRF helper — fetches the cookie if missing
// ─────────────────────────────────────────────
async function getCSRF() {
  let token = _readCsrfCookie()
  if (!token) {
    await fetch('/api/auth/csrf/', { credentials: 'include' })
    token = _readCsrfCookie()
  }
  return token || ''
}

function _readCsrfCookie() {
  const match = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ''
}

// ─────────────────────────────────────────────
// Core session exchange — Firebase ID token → Django JWT cookies
// ─────────────────────────────────────────────
async function _createSession(idToken, name = '') {
  const csrf = await getCSRF()
  let res, text
  try {
    res  = await fetch('/api/auth/firebase-session/', {
      method:      'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken':  csrf,
      },
      body: JSON.stringify({ idToken, name }),
    })
    text = await res.text()
  } catch {
    return { error: 'Network error. Check your connection.' }
  }

  if (!res.ok) {
    let msg = 'Authentication failed.'
    try { msg = JSON.parse(text).error || msg } catch { /* non-JSON error body */ }
    return { error: msg }
  }

  try {
    return JSON.parse(text)          // { success: true, user: {...}, created: bool }
  } catch {
    return { error: 'Unexpected server response.' }
  }
}

// ─────────────────────────────────────────────
// Public Auth API
// ─────────────────────────────────────────────
const Auth = {

  async loginWithGoogle() {
    const { GoogleAuthProvider, signInWithPopup } = window.firebaseAuth
    try {
      const provider = new GoogleAuthProvider()
      provider.addScope('email')
      provider.addScope('profile')
      const cred    = await signInWithPopup(window._firebaseAuth, provider)
      const idToken = await cred.user.getIdToken(/* forceRefresh */ true)
      return _createSession(idToken, cred.user.displayName || '')
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request') {
        return { cancelled: true }
      }
      return { error: _firebaseError(err) }
    }
  },

  async loginWithEmail(email, password) {
    const { signInWithEmailAndPassword } = window.firebaseAuth
    try {
      const cred    = await signInWithEmailAndPassword(window._firebaseAuth, email, password)
      const idToken = await cred.user.getIdToken(true)
      return _createSession(idToken)
    } catch (err) {
      return { error: _firebaseError(err) }
    }
  },

  async signupWithEmail(name, email, password) {
    const { createUserWithEmailAndPassword, updateProfile, deleteUser } = window.firebaseAuth
    let cred = null
    try {
      cred = await createUserWithEmailAndPassword(window._firebaseAuth, email, password)
      await updateProfile(cred.user, { displayName: name })
      // Force-refresh so the token carries the updated displayName
      const idToken = await cred.user.getIdToken(true)
      const result = await _createSession(idToken, name)
      if (!result.success) {
        // Django rejected the token — clean up the Firebase account so the
        // user isn't stuck with a half-created account and can retry cleanly.
        try { await deleteUser(cred.user) } catch { /* best-effort cleanup */ }
      }
      return result
    } catch (err) {
      // If Firebase account was created but something else threw, clean it up
      if (cred) {
        try { await deleteUser(cred.user) } catch { /* best-effort cleanup */ }
      }
      return { error: _firebaseError(err) }
    }
  },

  async logout() {
    try { await window._firebaseAuth.signOut() } catch { /* best-effort */ }
    try {
      await fetch('/api/auth/logout/', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'X-CSRFToken': await getCSRF() },
      })
    } catch { /* best-effort */ }
    // Always redirect regardless of whether sign-out calls succeeded
    window.location.href = '/'
  },

  /** Returns the current user object or null. */
  async getUser() {
    try {
      const res = await fetch('/api/auth/me/', { credentials: 'include' })
      if (!res.ok) return null
      const data = await res.json()
      return data.user || null
    } catch {
      return null
    }
  },

  /** Redirect to login if no valid session. */
  requireAuth(redirectTo = '/login/') {
    this.getUser().then(user => {
      if (!user) window.location.href = redirectTo
    })
  },
}

// ─────────────────────────────────────────────
// Firebase error codes → user-facing messages
// ─────────────────────────────────────────────
function _firebaseError(err) {
  const map = {
    'auth/email-already-in-use':   'An account with this email already exists.',
    'auth/invalid-email':          'Invalid email address.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/too-many-requests':      'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/popup-blocked':          'Popup blocked — allow popups for this site.',
    'auth/user-disabled':          'This account has been disabled.',
  }
  return map[err.code] || err.message || 'Authentication failed.'
}

// ─────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────
function showToast(msg, type = 'info') {
  document.querySelector('.toast')?.remove()
  const toast = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg })
  const colors = { error: '#FF4757', success: '#00D4AA', info: '#8B949E' }
  toast.style.cssText = `border-left: 3px solid ${colors[type] || colors.info}`
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity .3s'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark'
  if (saved === 'light') document.documentElement.classList.add('light')
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.innerHTML = saved === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>'
    btn.addEventListener('click', () => {
      const goLight = !document.documentElement.classList.contains('light')
      document.documentElement.classList.toggle('light', goLight)
      localStorage.setItem('theme', goLight ? 'light' : 'dark')
      btn.innerHTML = goLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>'
    })
  })
}

// ─────────────────────────────────────────────
// Nav scroll
// ─────────────────────────────────────────────
function initNavScroll() {
  const nav = document.querySelector('nav')
  if (!nav) return
  const update = () => nav.classList.toggle('scrolled', window.scrollY > 20)
  window.addEventListener('scroll', update, { passive: true })
  update()
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  initNavScroll()
})
