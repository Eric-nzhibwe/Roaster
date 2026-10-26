/**
 * auth.js
 * Firebase client-side auth + Django session exchange.
 * Firebase handles email/password and Google sign-in.
 * On success, we POST the Firebase ID token to Django which
 * verifies it and sets httpOnly JWT cookies for API calls.
 */

// ── Wait for Firebase module script to finish ──
function _waitForFirebase() {
  return new Promise((resolve) => {
    if (window._firebaseReady) return resolve()
    window.addEventListener('firebase-ready', () => resolve(), { once: true })
  })
}

const Auth = {
  /**
   * Exchange a Firebase ID token for Django session cookies.
   * @param {string} idToken - Firebase ID token
   * @param {string} [name]  - Display name (signup only)
   */
  async _createSession(idToken, name = '') {
    try {
      // Ensure CSRF cookie exists — fetch it and wait, then re-read
      let csrf = getCsrfToken()
      if (!csrf) {
        await fetch('/api/auth/csrf/', { credentials: 'include' })
        // Small delay to let the browser commit the Set-Cookie header
        await new Promise(r => setTimeout(r, 50))
        csrf = getCsrfToken()
      }
      const res = await fetch('/api/auth/firebase-session/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        credentials: 'include',
        body: JSON.stringify({ idToken, name }),
      })
      console.log('[Auth] firebase-session status:', res.status)
      const text = await res.text()
      console.log('[Auth] firebase-session response:', text)
      if (!res.ok) {
        let msg = 'Authentication failed.'
        try { msg = JSON.parse(text).error || msg } catch { }
        return { error: msg }
      }
      try {
        return JSON.parse(text)
      } catch {
        return { error: 'Unexpected server response.' }
      }
    } catch (err) {
      console.error('[Auth] _createSession network error:', err)
      return { error: 'Network error. Check your connection.' }
    }
  },

  async signupWithEmail(name, email, password) {
    await _waitForFirebase()
    const { createUserWithEmailAndPassword, updateProfile } = window.firebaseAuth
    try {
      const cred = await createUserWithEmailAndPassword(window._firebaseAuth, email, password)
      await updateProfile(cred.user, { displayName: name })
      const idToken = await cred.user.getIdToken()
      const result = await this._createSession(idToken, name)
      if (result.success) {
        setTimeout(() => { window.location.href = '/chat/' }, 1500)
      }
      return result
    } catch (err) {
      return { error: _firebaseError(err) }
    }
  },

  async loginWithEmail(email, password) {
    await _waitForFirebase()
    const { signInWithEmailAndPassword } = window.firebaseAuth
    try {
      const cred = await signInWithEmailAndPassword(window._firebaseAuth, email, password)
      const idToken = await cred.user.getIdToken()
      return this._createSession(idToken)
    } catch (err) {
      return { error: _firebaseError(err) }
    }
  },

  async loginWithGoogle() {
    await _waitForFirebase()
    const { GoogleAuthProvider, signInWithPopup } = window.firebaseAuth
    try {
      const provider = new GoogleAuthProvider()
      const cred = await signInWithPopup(window._firebaseAuth, provider)
      console.log('[Auth] Google sign-in OK, getting ID token...')
      const idToken = await cred.user.getIdToken()
      console.log('[Auth] Exchanging token with Django...')
      const result = await this._createSession(idToken, cred.user.displayName || '')
      console.log('[Auth] Session result:', result)
      return result
    } catch (err) {
      console.error('[Auth] Google sign-in error:', err.code, err.message, err)
      if (err.code === 'auth/popup-closed-by-user') return { error: null }
      return { error: _firebaseError(err) }
    }
  },

  async logout() {
    try { await window._firebaseAuth.signOut() } catch { }
    await fetch('/api/auth/logout/', {
      method: 'POST',
      headers: { 'X-CSRFToken': getCsrfToken() },
      credentials: 'include',
    })
    window.location.href = '/'
  },

  async getUser() {
    try {
      const res = await fetch('/api/auth/me/', { credentials: 'include' })
      if (!res.ok) return null
      const data = await res.json()
      return data.user || null
    } catch { return null }
  },

  requireAuth(redirectTo = '/login/') {
    this.getUser().then(user => {
      if (!user) window.location.href = redirectTo
    })
  },
}

// ── Firebase error → human-readable message ──
function _firebaseError(err) {
  const map = {
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/popup-blocked': 'Popup blocked. Allow popups for this site.',
  }
  return map[err.code] || err.message || 'Authentication failed.'
}

// ── CSRF ──
function getCsrfToken() {
  return document.cookie.split('; ').find(r => r.startsWith('csrftoken='))?.split('=')[1] || ''
}

// ── Toast ──
function showToast(msg, type = 'info') {
  const existing = document.querySelector('.toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.className = 'toast'
  const colors = { error: '#FF4757', success: '#00D4AA', info: '#8B949E' }
  toast.style.borderLeftColor = colors[type] || colors.info
  toast.style.borderLeftWidth = '3px'
  toast.textContent = msg
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity .3s'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

// ── Theme ──
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark'
  if (saved === 'light') document.documentElement.classList.add('light')
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.innerHTML = saved === 'dark'
      ? '<i class="fa-solid fa-sun"></i>'
      : '<i class="fa-solid fa-moon"></i>'
    btn.addEventListener('click', () => {
      const isDark = !document.documentElement.classList.contains('light')
      document.documentElement.classList.toggle('light', isDark)
      localStorage.setItem('theme', isDark ? 'light' : 'dark')
      btn.innerHTML = isDark
        ? '<i class="fa-solid fa-moon"></i>'
        : '<i class="fa-solid fa-sun"></i>'
    })
  })
}

// ── Nav scroll ──
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
