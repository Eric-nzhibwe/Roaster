; (function (window) {
  'use strict'

  const API = {
    CSRF: '/api/auth/csrf/',
    SESSION: '/api/auth/firebase-session/',
    REFRESH: '/api/auth/token/refresh/',
    LOGOUT: '/api/auth/logout/',
    ME: '/api/auth/me/',
  }

  const REDIRECT = {
    HOME: '/',
    AFTER_AUTH: '/chat/',
    AUTH_PAGE: '/auth/',
  }

  const USER_KEY = 'roaster_user'

  // ─── User cache (sessionStorage) ────────────────────────────────────────
  // Survives page navigation within the same browser tab/session.
  // Cleared on logout and when the server says the session is invalid.

  function _cacheUser(user) {
    try { sessionStorage.setItem(USER_KEY, JSON.stringify(user)) } catch { /* quota */ }
  }

  function _getCachedUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY)) } catch { return null }
  }

  function _clearCache() {
    try { sessionStorage.removeItem(USER_KEY) } catch { /* ignore */ }
  }

  // ─── CSRF ────────────────────────────────────────────────────────────────

  function _readCsrfCookie() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)
    return m ? decodeURIComponent(m[1]) : ''
  }

  async function getCSRF() {
    let token = _readCsrfCookie()
    if (!token) {
      try { await fetch(API.CSRF, { credentials: 'include' }) } catch { /* offline */ }
      token = _readCsrfCookie()
    }
    return token || ''
  }

  // ─── Firebase error map ──────────────────────────────────────────────────

  const FIREBASE_ERRORS = {
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email': "That email address doesn't look right.",
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
    'auth/user-disabled': 'This account has been disabled. Contact support.',
    'auth/network-request-failed': 'Network error — check your connection and try again.',
    'auth/popup-blocked': 'Popup was blocked. Allow popups for this site and retry.',
    'auth/popup-closed-by-user': null,
    'auth/cancelled-popup-request': null,
    'auth/operation-not-allowed': 'This sign-in method is not enabled. Contact support.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    'auth/requires-recent-login': 'Please sign out and sign back in to continue.',
    'auth/credential-already-in-use': 'These credentials are already linked to another account.',
  }

  function _mapFirebaseError(err) {
    const mapped = FIREBASE_ERRORS[err.code]
    if (mapped === null) return null
    if (mapped) return mapped
    return (err.message || 'Authentication failed.')
      .replace(/^Firebase: /i, '')
      .replace(/\s*\(auth\/[\w-]+\)\s*\.?$/, '')
      .trim()
  }

  // ─── Token exchange ──────────────────────────────────────────────────────

  async function _exchangeToken(idToken, name = '') {
    const csrf = await getCSRF().catch(() => '')

    let res, body
    try {
      res = await fetch(API.SESSION, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ idToken, name }),
      })
      body = await res.text()
    } catch {
      return { error: 'Network error — check your connection and try again.' }
    }

    if (!res.ok) {
      let msg = `Authentication failed (${res.status}). Please try again.`
      try {
        const p = JSON.parse(body)
        msg = p.error || p.detail || msg
      } catch { /* non-JSON */ }
      console.error('[Auth] firebase-session failed:', res.status, body)
      return { error: msg }
    }

    try {
      const data = JSON.parse(body)
      if (!data.success) return { error: data.error || 'Unexpected server response.' }
      // Cache the user so the next page load doesn't need a round-trip
      if (data.user) _cacheUser(data.user)
      return data
    } catch {
      return { error: 'Unexpected server response. Please try again.' }
    }
  }

  // ─── Silent refresh ──────────────────────────────────────────────────────

  async function _tryRefresh() {
    try {
      const csrf = await getCSRF()
      const res = await fetch(API.REFRESH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRFToken': csrf },
      })
      return res.ok
    } catch {
      return false
    }
  }

  // ─── Public Auth API ─────────────────────────────────────────────────────

  const Auth = {

    async loginWithGoogle() {
      const { GoogleAuthProvider, signInWithPopup } = window.firebaseAuth
      const provider = new GoogleAuthProvider()
      provider.addScope('email')
      provider.addScope('profile')
      provider.setCustomParameters({ prompt: 'select_account' })

      let cred
      try {
        cred = await signInWithPopup(window._firebaseAuth, provider)
      } catch (err) {
        const msg = _mapFirebaseError(err)
        return msg === null ? { cancelled: true } : { error: msg }
      }

      let idToken
      try {
        idToken = await cred.user.getIdToken(true)
      } catch {
        return { error: 'Failed to verify Google credentials. Please try again.' }
      }

      return _exchangeToken(idToken, cred.user.displayName || '')
    },

    async loginWithEmail(email, password) {
      if (!email || !password) return { error: 'Email and password are required.' }

      const { signInWithEmailAndPassword } = window.firebaseAuth
      let cred
      try {
        cred = await signInWithEmailAndPassword(window._firebaseAuth, email.trim(), password)
      } catch (err) {
        return { error: _mapFirebaseError(err) || 'Sign-in failed. Please try again.' }
      }

      let idToken
      try {
        idToken = await cred.user.getIdToken(true)
      } catch {
        return { error: 'Failed to verify credentials. Please try again.' }
      }

      return _exchangeToken(idToken)
    },

    async signupWithEmail(name, email, password) {
      if (!name || !email || !password) return { error: 'All fields are required.' }

      const { createUserWithEmailAndPassword, updateProfile, deleteUser } = window.firebaseAuth
      let cred

      try {
        cred = await createUserWithEmailAndPassword(window._firebaseAuth, email.trim(), password)
      } catch (err) {
        return { error: _mapFirebaseError(err) || 'Could not create account. Please try again.' }
      }

      try { await updateProfile(cred.user, { displayName: name.trim() }) } catch { /* non-fatal */ }

      let idToken
      try {
        idToken = await cred.user.getIdToken(true)
      } catch {
        try { await deleteUser(cred.user) } catch { /* best-effort */ }
        return { error: 'Failed to verify new account. Please try again.' }
      }

      const result = await _exchangeToken(idToken, name.trim())

      if (!result.success) {
        try { await deleteUser(cred.user) } catch { /* best-effort */ }
      }

      return result
    },

    async logout() {
      _clearCache()
      await Promise.allSettled([
        window._firebaseAuth.signOut(),
        (async () => {
          const csrf = await getCSRF()
          return fetch(API.LOGOUT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRFToken': csrf },
          })
        })(),
      ])
      window.location.href = REDIRECT.HOME
    },

    /**
     * Returns the user object. Serves from cache instantly on the first
     * call after login, then validates with the server in the background.
     * On subsequent page loads the cache is the first source of truth —
     * a background revalidation keeps it fresh.
     */
    async getUser() {
      const cached = _getCachedUser()

      // Kick off server validation in the background regardless
      const serverCheck = fetch(API.ME, { credentials: 'include' })
        .then(async res => {
          if (res.status === 401) {
            const refreshed = await _tryRefresh()
            if (refreshed) {
              const retry = await fetch(API.ME, { credentials: 'include' })
              if (retry.ok) {
                const d = await retry.json()
                const u = d.user || null
                if (u) _cacheUser(u); else _clearCache()
                return u
              }
            }
            _clearCache()
            return null
          }
          if (!res.ok) return cached // non-401 error — trust cache
          const d = await res.json()
          const u = d.user || null
          if (u) _cacheUser(u); else _clearCache()
          return u
        })
        .catch(() => cached)

      // If we have a cached user return it immediately (no wait for network).
      // The background check will update the cache for the next call.
      if (cached) return cached

      // No cache — we must wait for the server
      return serverCheck
    },

    requireAuth(redirectTo = REDIRECT.AUTH_PAGE) {
      this.getUser().then(user => {
        if (!user) window.location.href = redirectTo
      })
    },

    redirectIfAuthed(destination = REDIRECT.AFTER_AUTH) {
      this.getUser().then(user => {
        if (user) window.location.href = destination
      })
    },
  }

  // ─── Toast ───────────────────────────────────────────────────────────────

  function showToast(message, type = 'info') {
    document.querySelector('.toast')?.remove()
    const COLORS = { success: '#00D4AA', error: '#FF4757', info: '#8B949E' }
    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.textContent = message
    toast.style.cssText = `border-left: 3px solid ${COLORS[type] || COLORS.info}`
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transition = 'opacity .3s'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  // ─── Theme toggle ────────────────────────────────────────────────────────

  function _initTheme() {
    const isLight = (localStorage.getItem('theme') || 'dark') === 'light'
    if (isLight) document.documentElement.classList.add('light')
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>'
      btn.addEventListener('click', () => {
        const nowLight = !document.documentElement.classList.contains('light')
        document.documentElement.classList.toggle('light', nowLight)
        localStorage.setItem('theme', nowLight ? 'light' : 'dark')
        btn.innerHTML = nowLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>'
      })
    })
  }

  // ─── Nav scroll ──────────────────────────────────────────────────────────

  function _initNavScroll() {
    const nav = document.querySelector('nav')
    if (!nav) return
    window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 20), { passive: true })
  }

  // ─── Expose ──────────────────────────────────────────────────────────────

  window.Auth = Auth
  window.getCSRF = getCSRF
  window.showToast = showToast

  document.addEventListener('DOMContentLoaded', () => {
    _initTheme()
    _initNavScroll()
  })

}(window))
