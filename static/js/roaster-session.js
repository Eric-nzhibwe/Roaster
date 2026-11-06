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

  const TokenStore = {
    KEY: 'rs_refresh_token',
    get() { try { return localStorage.getItem(this.KEY) || '' } catch { return '' } },
    set(value) { try { if (value) localStorage.setItem(this.KEY, value); else localStorage.removeItem(this.KEY) } catch { /* quota */ } },
    clear() { try { localStorage.removeItem(this.KEY) } catch { /* ignore */ } },
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

  function _hasRefreshCookie() {
    return document.cookie.split(';').some(part => part.trim().startsWith('refresh_token='))
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
          const hasRefresh = _hasRefreshCookie() || !!TokenStore.get()
          if (!hasRefresh) {
            Store.clear()
            return null
          }

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
      const refreshToken = TokenStore.get()
      const headers = { 'X-CSRFToken': csrf }
      const payload = refreshToken ? { refresh: refreshToken } : null

      if (!refreshToken && !_hasRefreshCookie()) {
        return false
      }

      const res = await fetch(EP.REFRESH, {
        method:      'POST',
        credentials: 'include',
        headers:     payload ? { ...headers, 'Content-Type': 'application/json' } : headers,
        body:        payload ? JSON.stringify(payload) : undefined,
      })

      if (!res.ok) return false
      try {
        const data = await res.json()
        if (data && data.access && data.refresh) {
          TokenStore.set(data.refresh)
        }
      } catch {
        // ignore non-JSON responses
      }
      return true
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

    if (data.refresh) TokenStore.set(data.refresh)
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

    async signOut() {
      Store.clear()
      TokenStore.clear()
      try {
        const csrf = await _csrf()
        await fetch(EP.LOGOUT, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRFToken': csrf },
        })
      } catch {
        // ignore logout errors
      }
      window.location.href = ROUTES.HOME
    },

    async currentUser() {
      const cached = Store.get()
      const serverCheck = (async () => {
        try {
          const res = await fetch(EP.ME, { credentials: 'include' })
          if (res.status === 401) {
            Store.clear()
            return null
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
          return cached || null
        }
      })()

      if (cached) {
        serverCheck.then(fresh => {
          if (!fresh) Store.clear()
        })
        return cached
      }
      return serverCheck
    },

    async signInWithEmail(email, password) {
      if (!email || !password) return { ok: false, error: 'Email and password are required.' }

      const csrf = await _csrf()
      const res = await fetch('/api/auth/login/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf,
        },
        body: JSON.stringify({ email: email.trim(), password }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, error: data.error || data.detail || 'Login failed. Please try again.' }
      }

      if (data.user) Store.set(data.user)
      return { ok: true, user: data.user }
    },

    async createAccount(name, email, password) {
      if (!name || !email || !password) return { ok: false, error: 'All fields are required.' }
      if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters long.' }

      const csrf = await _csrf()
      const res = await fetch('/api/auth/signup/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf,
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, error: data.error || data.detail || 'Signup failed. Please try again.' }
      }

      if (data.user) Store.set(data.user)
      return { ok: true, user: data.user }
    },

    async sendPasswordReset(email) {
      return { ok: false, error: 'Password reset is currently disabled while using Django auth.' }
    },

    async signInWithGoogle() {
      return { ok: false, error: 'Google sign-in is temporarily disabled while auth is handled by Django.' }
    },

    guardPage() {
      this.currentUser().then(user => {
        if (!user) window.location.href = ROUTES.LOGIN
      })
    },

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
