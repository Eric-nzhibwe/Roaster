;(function (window) {
  'use strict'

  // ─── Endpoints ────────────────────────────────────────────────────────────

  const EP = {
    CSRF:    '/api/auth/csrf/',
    SESSION: '/api/auth/firebase-session/',
    REFRESH: '/api/auth/token/refresh/',
    LOGOUT:  '/api/auth/logout/',
    ME:      '/api/auth/me/',
  }

  const ROUTES = {
    HOME:  '/',
    CHAT:  '/chat/',
    LOGIN: '/auth/',
  }

  // ─── Session store ────────────────────────────────────────────────────────
  // Persists the user object across page navigations in the same tab.
  // Intentionally sessionStorage (not localStorage) — clears when the tab closes.

  const Store = {
    KEY: 'rs_user',
    get()      { try { return JSON.parse(sessionStorage.getItem(this.KEY)) } catch { return null } },
    set(user)  { try { sessionStorage.setItem(this.KEY, JSON.stringify(user)) } catch { /* quota */ } },
    clear()    { try { sessionStorage.removeItem(this.KEY) } catch { /* ignore */ } },
  }

  // ─── In-flight deduplication ──────────────────────────────────────────────
  // If two calls to verifySession() fire at the same time, we only want one
  // network request. The second caller shares the same Promise.

  let _verifyPromise = null

  // ─── CSRF ─────────────────────────────────────────────────────────────────

  function _csrfFromCookie() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)
    return m ? decodeURIComponent(m[1]) : ''
  }

  async function _csrf() {
    let token = _csrfFromCookie()
    if (!token) {
      try { await fetch(EP.CSRF, { credentials: 'include' }) } catch { /* offline */ }
      token = _csrfFromCookie()
    }
    return token || ''
  }

  // ─── Core: verify session with server ────────────────────────────────────
  // Single source of truth. Deduplicates concurrent calls.
  // Returns the user object or null.

  async function _verifySession() {
    if (_verifyPromise) return _verifyPromise

    _verifyPromise = (async () => {
      try {
        let res = await fetch(EP.ME, { credentials: 'include' })

        if (res.status === 401) {
          // Try refreshing the access token once
          const refreshed = await _refreshToken()
          if (refreshed) {
            res = await fetch(EP.ME, { credentials: 'include' })
          }
        }

        if (!res.ok) {
          Store.clear()
          return null
        }

        const { user } = await res.json()
        if (user) Store.set(user)
        else Store.clear()
        return user || null
      } catch {
        // Network failure — trust the cache rather than kicking the user out
        return Store.get()
      } finally {
        _verifyPromise = null
      }
    })()

    return _verifyPromise
  }

  // ─── Token refresh ────────────────────────────────────────────────────────

  async function _refreshToken() {
    try {
      const csrf = await _csrf()
      const res  = await fetch(EP.REFRESH, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'X-CSRFToken': csrf },
      })
      return res.ok
    } catch {
      return false
    }
  }

  // ─── Firebase token → Django session ─────────────────────────────────────

  async function _createSession(idToken, displayName) {
    const csrf = await _csrf()

    let res, text
    try {
      res  = await fetch(EP.SESSION, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body:        JSON.stringify({ idToken, name: displayName || '' }),
      })
      text = await res.text()
    } catch {
      return { ok: false, error: 'Network error — check your connection and try again.' }
    }

    let data
    try   { data = JSON.parse(text) }
    catch { return { ok: false, error: 'Unexpected server response. Please try again.' } }

    if (!res.ok) {
      console.error('[Session] firebase-session', res.status, text)
      return { ok: false, error: data.error || data.detail || `Authentication failed (${res.status}).` }
    }

    if (!data.success) {
      return { ok: false, error: data.error || 'Unexpected server response.' }
    }

    // Cache immediately — the next page load reads this before hitting the server
    if (data.user) Store.set(data.user)
    return { ok: true, user: data.user, created: data.created }
  }

  // ─── Firebase error messages ──────────────────────────────────────────────

  const FB_ERRORS = {
    'auth/email-already-in-use':                     'An account with this email already exists.',
    'auth/invalid-email':                            "That email address doesn't look right.",
    'auth/user-not-found':                           'No account found with this email.',
    'auth/wrong-password':                           'Incorrect password.',
    'auth/invalid-credential':                       'Incorrect email or password.',
    'auth/weak-password':                            'Password must be at least 6 characters.',
    'auth/too-many-requests':                        'Too many attempts — please try again in a moment.',
    'auth/user-disabled':                            'This account has been disabled.',
    'auth/network-request-failed':                   'Network error — check your connection.',
    'auth/popup-blocked':                            'Popup was blocked. Allow popups for this site and retry.',
    'auth/popup-closed-by-user':                     null,
    'auth/cancelled-popup-request':                  null,
    'auth/operation-not-allowed':                    'This sign-in method is not enabled.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    'auth/requires-recent-login':                    'Please sign out and sign back in to continue.',
    'auth/credential-already-in-use':                'These credentials are already linked to another account.',
  }

  function _fbError(err) {
    const msg = FB_ERRORS[err.code]
    if (msg === null) return null  // silent (user closed popup etc.)
    if (msg) return msg
    return (err.message || 'Authentication failed.')
      .replace(/^Firebase:\s*/i, '')
      .replace(/\s*\(auth\/[\w-]+\)\.?\s*$/, '')
      .trim()
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  const Session = {

    /**
     * Returns the current user.
     * - Serves from cache immediately if available (zero latency on page load after login)
     * - Always revalidates in background; updates cache for next call
     * - Concurrent calls share one network request
     */
    async currentUser() {
      const cached = Store.get()

      // Fire background revalidation — don't await it when we have a cache hit
      const serverCheck = _verifySession()

      if (cached) {
        // Return cache now; background check will refresh it silently
        serverCheck.then(fresh => {
          if (!fresh) Store.clear() // session expired — cleared for next navigation
        })
        return cached
      }

      // No cache — must wait for server
      return serverCheck
    },

    /**
     * Sign in with Google popup.
     * Returns { ok: true, user } or { ok: false, error } or { ok: false, cancelled: true }
     */
    async signInWithGoogle() {
      const { GoogleAuthProvider, signInWithPopup } = window.firebaseAuth
      const provider = new GoogleAuthProvider()
      provider.addScope('email')
      provider.addScope('profile')
      provider.setCustomParameters({ prompt: 'select_account' })

      let cred
      try {
        cred = await signInWithPopup(window._firebaseAuth, provider)
      } catch (err) {
        const msg = _fbError(err)
        return msg === null ? { ok: false, cancelled: true } : { ok: false, error: msg }
      }

      let idToken
      try { idToken = await cred.user.getIdToken(true) }
      catch { return { ok: false, error: 'Could not verify Google credentials. Please try again.' } }

      return _createSession(idToken, cred.user.displayName || '')
    },

    /**
     * Sign in with email + password.
     * Returns { ok: true, user } or { ok: false, error }
     */
    async signInWithEmail(email, password) {
      if (!email || !password) return { ok: false, error: 'Email and password are required.' }

      const { signInWithEmailAndPassword } = window.firebaseAuth
      let cred
      try {
        cred = await signInWithEmailAndPassword(window._firebaseAuth, email.trim(), password)
      } catch (err) {
        return { ok: false, error: _fbError(err) || 'Sign-in failed. Please try again.' }
      }

      let idToken
      try { idToken = await cred.user.getIdToken(true) }
      catch { return { ok: false, error: 'Could not verify credentials. Please try again.' } }

      return _createSession(idToken)
    },

    /**
     * Create a new account with email + password.
     * Rolls back the Firebase account if Django rejects the token.
     * Returns { ok: true, user, created: true } or { ok: false, error }
     */
    async createAccount(name, email, password) {
      if (!name || !email || !password) return { ok: false, error: 'All fields are required.' }

      const { createUserWithEmailAndPassword, updateProfile, deleteUser } = window.firebaseAuth
      let cred

      try {
        cred = await createUserWithEmailAndPassword(window._firebaseAuth, email.trim(), password)
      } catch (err) {
        return { ok: false, error: _fbError(err) || 'Could not create account. Please try again.' }
      }

      try { await updateProfile(cred.user, { displayName: name.trim() }) } catch { /* non-fatal */ }

      let idToken
      try { idToken = await cred.user.getIdToken(true) }
      catch {
        try { await deleteUser(cred.user) } catch { /* best-effort rollback */ }
        return { ok: false, error: 'Could not verify new account. Please try again.' }
      }

      const result = await _createSession(idToken, name.trim())

      if (!result.ok) {
        // Django rejected it — clean up Firebase so the user can retry
        try { await deleteUser(cred.user) } catch { /* best-effort */ }
      }

      return result
    },

    /**
     * Sign out from both Firebase and Django.
     */
    async signOut() {
      Store.clear()
      await Promise.allSettled([
        window._firebaseAuth.signOut(),
        (async () => {
          const csrf = await _csrf()
          return fetch(EP.LOGOUT, {
            method:      'POST',
            credentials: 'include',
            headers:     { 'X-CSRFToken': csrf },
          })
        })(),
      ])
      window.location.href = ROUTES.HOME
    },

    /**
     * Send a password reset email.
     * Returns { ok: true } or { ok: false, error }
     */
    async sendPasswordReset(email) {
      if (!email) return { ok: false, error: 'Email is required.' }
      try {
        const { sendPasswordResetEmail } = window.firebaseAuth
        await sendPasswordResetEmail(window._firebaseAuth, email.trim())
        return { ok: true }
      } catch (err) {
        return { ok: false, error: _fbError(err) || 'Failed to send reset email. Try again.' }
      }
    },

    /**
     * Redirect to login if not authenticated. Call on any protected page.
     */
    guardPage() {
      this.currentUser().then(user => {
        if (!user) window.location.href = ROUTES.LOGIN
      })
    },

    /**
     * Redirect to chat if already authenticated. Call on the login page.
     */
    redirectIfLoggedIn() {
      this.currentUser().then(user => {
        if (user) window.location.href = ROUTES.CHAT
      })
    },
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  function showToast(message, type = 'info') {
    document.querySelector('.toast')?.remove()
    const colors = { success: '#00D4AA', error: '#FF4757', info: '#8B949E' }
    const toast  = document.createElement('div')
    toast.className   = 'toast'
    toast.textContent = message
    toast.style.cssText = `border-left:3px solid ${colors[type] || colors.info}`
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.cssText += ';opacity:0;transition:opacity .3s'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  // ─── Theme ────────────────────────────────────────────────────────────────

  function _initTheme() {
    const light = localStorage.getItem('theme') === 'light'
    if (light) document.documentElement.classList.add('light')
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.innerHTML = light ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>'
      btn.addEventListener('click', () => {
        const nowLight = !document.documentElement.classList.contains('light')
        document.documentElement.classList.toggle('light', nowLight)
        localStorage.setItem('theme', nowLight ? 'light' : 'dark')
        btn.innerHTML = nowLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>'
      })
    })
  }

  // ─── Nav scroll ───────────────────────────────────────────────────────────

  function _initNavScroll() {
    const nav = document.querySelector('nav')
    if (!nav) return
    window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 20), { passive: true })
  }

  // ─── Expose ───────────────────────────────────────────────────────────────

  window.Session   = Session
  window.showToast = showToast

  // Legacy alias so any existing code calling Auth.* still works
  window.Auth = {
    getUser:        () => Session.currentUser(),
    logout:         () => Session.signOut(),
    requireAuth:    () => Session.guardPage(),
    redirectIfAuthed: () => Session.redirectIfLoggedIn(),
    loginWithGoogle: () => Session.signInWithGoogle(),
    loginWithEmail:  (e, p) => Session.signInWithEmail(e, p).then(r => r.ok ? { success: true, user: r.user } : { error: r.error }),
    signupWithEmail: (n, e, p) => Session.createAccount(n, e, p).then(r => r.ok ? { success: true, user: r.user } : { error: r.error }),
  }

  document.addEventListener('DOMContentLoaded', () => {
    _initTheme()
    _initNavScroll()
  })

}(window))
