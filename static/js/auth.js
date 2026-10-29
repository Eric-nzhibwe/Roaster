/**
 * auth.js
 *
 * Injected by base.html AFTER the Firebase Web SDK module has fully
 * initialised, so window._firebaseAuth and window.firebaseAuth are
 * guaranteed to exist before any line here runs.
 *
 * Responsibilities
 * ─────────────────
 * 1. CSRF         — read or lazily fetch the Django CSRF cookie
 * 2. Session      — exchange a Firebase ID token for Django JWT cookies
 * 3. Auth API     — loginWithGoogle / loginWithEmail / signupWithEmail /
 *                   logout / getUser / requireAuth
 * 4. Token refresh — silently refresh the JWT when the server returns 401
 * 5. UI utilities — showToast / theme toggle / nav scroll
 */

;(function (window) {
  'use strict'

  // ─── Constants ───────────────────────────────────────────────────────────

  const API = {
    CSRF:    '/api/auth/csrf/',
    SESSION: '/api/auth/firebase-session/',
    REFRESH: '/api/auth/token/refresh/',
    LOGOUT:  '/api/auth/logout/',
    ME:      '/api/auth/me/',
  }

  const REDIRECT = {
    HOME:      '/',
    AFTER_AUTH: '/chat/',
    AUTH_PAGE:  '/auth/',
  }

  // ─── CSRF ─────────────────────────────────────────────────────────────────

  function _readCsrfCookie() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)
    return m ? decodeURIComponent(m[1]) : ''
  }

  /**
   * Returns the CSRF token, fetching a fresh one from the server if the
   * cookie is absent (first page load before any Django response).
   */
  async function getCSRF() {
    let token = _readCsrfCookie()
    if (!token) {
      try {
        await fetch(API.CSRF, { credentials: 'include' })
      } catch {
        // Offline — return empty string; Django will reject mutating requests
        // but we still want the rest of the flow to proceed and show a sensible error
      }
      token = _readCsrfCookie()
    }
    return token || ''
  }

  // ─── Firebase error map ───────────────────────────────────────────────────

  const FIREBASE_ERRORS = {
    'auth/email-already-in-use':        'An account with this email already exists.',
    'auth/invalid-email':               'That email address doesn\'t look right.',
    'auth/user-not-found':              'No account found with this email.',
    'auth/wrong-password':              'Incorrect password.',
    'auth/invalid-credential':          'Incorrect email or password.',
    'auth/weak-password':               'Password must be at least 6 characters.',
    'auth/too-many-requests':           'Too many attempts — please wait a moment and try again.',
    'auth/user-disabled':               'This account has been disabled. Contact support.',
    'auth/network-request-failed':      'Network error — check your connection and try again.',
    'auth/popup-blocked':               'Popup was blocked. Allow popups for this site and retry.',
    'auth/popup-closed-by-user':        null,   // user closed popup — silent
    'auth/cancelled-popup-request':     null,   // duplicate popup — silent
    'auth/operation-not-allowed':       'This sign-in method is not enabled. Contact support.',
    'auth/account-exists-with-different-credential':
                                        'An account already exists with this email using a different sign-in method.',
    'auth/requires-recent-login':       'Please sign out and sign back in to continue.',
    'auth/credential-already-in-use':   'These credentials are already linked to another account.',
  }

  function _mapFirebaseError(err) {
    const mapped = FIREBASE_ERRORS[err.code]
    if (mapped === null) return null          // intentionally silent
    if (mapped)          return mapped
    // Fallback: strip Firebase boilerplate prefix for readability
    return (err.message || 'Authentication failed.')
      .replace(/^Firebase: /i, '')
      .replace(/\s*\(auth\/[\w-]+\)\s*\.?$/, '')
      .trim()
  }

  // ─── Session exchange ─────────────────────────────────────────────────────

  /**
   * POST the Firebase ID token to Django. On success Django sets
   * httpOnly JWT cookies and returns the user object.
   *
   * @param  {string} idToken   Firebase ID token
   * @param  {string} [name]    Display name (passed on sign-up)
   * @returns {Promise<{success:boolean, user:object, created:boolean}
   *                  |{error:string}>}
   */
  async function _exchangeToken(idToken, name = '') {
    let csrf
    try {
      csrf = await getCSRF()
    } catch {
      return { error: 'Could not obtain security token. Please refresh and try again.' }
    }

    let res, body
    try {
      res = await fetch(API.SESSION, {
        method:      'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken':  csrf,
        },
        body: JSON.stringify({ idToken, name }),
      })
      body = await res.text()
    } catch {
      return { error: 'Network error — check your connection and try again.' }
    }

    if (!res.ok) {
      let msg = 'Authentication failed. Please try again.'
      try {
        const parsed = JSON.parse(body)
        if (parsed.error) msg = parsed.error
      } catch { /* body was not JSON */ }
      return { error: msg }
    }

    try {
      const data = JSON.parse(body)
      // Normalise — always return { success: true, ... } shape
      if (!data.success) {
        return { error: data.error || 'Unexpected server response.' }
      }
      return data
    } catch {
      return { error: 'Unexpected server response. Please try again.' }
    }
  }

  // ─── Silent JWT refresh ───────────────────────────────────────────────────

  /**
   * Called automatically when /api/auth/me/ returns 401.
   * Skips the network call entirely if the refresh_token cookie is absent
   * (no point hitting the server when we know it'll return 401).
   * Returns true on success, false if the session is genuinely expired.
   */
  async function _tryRefresh() {
    // Quick cookie check — if there's no refresh token cookie there's nothing to refresh
    const hasRefreshCookie = /(?:^|;\s*)refresh_token=/.test(document.cookie)
    if (!hasRefreshCookie) return false

    try {
      const csrf = await getCSRF()
      const res  = await fetch(API.REFRESH, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'X-CSRFToken': csrf },
      })
      return res.ok
    } catch {
      return false
    }
  }

  // ─── Public Auth API ──────────────────────────────────────────────────────

  const Auth = {

    /**
     * Sign in / sign up with Google via Firebase popup.
     * Works for both new and returning users — Firebase decides which.
     */
    async loginWithGoogle() {
      const { GoogleAuthProvider, signInWithPopup } = window.firebaseAuth
      const provider = new GoogleAuthProvider()
      provider.addScope('email')
      provider.addScope('profile')
      // Prompt for account selection every time (avoids silent auto-select confusion)
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
        idToken = await cred.user.getIdToken(/* forceRefresh= */ true)
      } catch {
        return { error: 'Failed to verify Google credentials. Please try again.' }
      }

      return _exchangeToken(idToken, cred.user.displayName || '')
    },

    /**
     * Sign in with email + password.
     */
    async loginWithEmail(email, password) {
      if (!email || !password) {
        return { error: 'Email and password are required.' }
      }

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

    /**
     * Create a new email/password account.
     *
     * If Django rejects the token after Firebase creates the account,
     * the Firebase account is deleted so the user can retry cleanly
     * without hitting "email already in use".
     */
    async signupWithEmail(name, email, password) {
      if (!name || !email || !password) {
        return { error: 'All fields are required.' }
      }

      const {
        createUserWithEmailAndPassword,
        updateProfile,
        deleteUser,
      } = window.firebaseAuth

      let cred = null

      try {
        cred = await createUserWithEmailAndPassword(
          window._firebaseAuth,
          email.trim(),
          password,
        )
      } catch (err) {
        return { error: _mapFirebaseError(err) || 'Could not create account. Please try again.' }
      }

      // Set display name on the Firebase account
      try {
        await updateProfile(cred.user, { displayName: name.trim() })
      } catch {
        // Non-fatal — Django will use the name from the request body
      }

      // Force-refresh the token so it includes the updated displayName
      let idToken
      try {
        idToken = await cred.user.getIdToken(/* forceRefresh= */ true)
      } catch {
        // Can't get a token — roll back the Firebase account
        try { await deleteUser(cred.user) } catch { /* best-effort */ }
        return { error: 'Failed to verify new account. Please try again.' }
      }

      const result = await _exchangeToken(idToken, name.trim())

      if (!result.success) {
        // Django rejected the token — delete the Firebase account so the
        // user isn't left with a dangling credential
        try { await deleteUser(cred.user) } catch { /* best-effort */ }
      }

      return result
    },

    /**
     * Sign out from both Firebase and Django.
     * Always redirects home, even if one of the sign-out steps fails.
     */
    async logout() {
      // Fire both in parallel — neither result is blocking
      await Promise.allSettled([
        window._firebaseAuth.signOut(),
        (async () => {
          const csrf = await getCSRF()
          return fetch(API.LOGOUT, {
            method:      'POST',
            credentials: 'include',
            headers:     { 'X-CSRFToken': csrf },
          })
        })(),
      ])
      window.location.href = REDIRECT.HOME
    },

    /**
     * Returns the authenticated user object from the Django session,
     * or null if not authenticated.
     *
     * Skips network calls entirely when no auth cookies are present.
     * Attempts a silent token refresh on 401 before giving up.
     */
    async getUser() {
      // If neither auth cookie exists, skip the network round-trip entirely
      const hasAccessCookie  = /(?:^|;\s*)access_token=/.test(document.cookie)
      const hasRefreshCookie = /(?:^|;\s*)refresh_token=/.test(document.cookie)
      if (!hasAccessCookie && !hasRefreshCookie) return null

      try {
        let res = await fetch(API.ME, { credentials: 'include' })

        // Attempt one silent refresh on 401
        if (res.status === 401) {
          const refreshed = await _tryRefresh()
          if (refreshed) {
            res = await fetch(API.ME, { credentials: 'include' })
          }
        }

        if (!res.ok) return null
        const data = await res.json()
        return data.user || null
      } catch {
        return null
      }
    },

    /**
     * Redirect to the auth page if the current user is not authenticated.
     * Call this at the top of any protected page.
     *
     * @param {string} [redirectTo] Override the default redirect target.
     */
    requireAuth(redirectTo = REDIRECT.AUTH_PAGE) {
      this.getUser().then(user => {
        if (!user) window.location.href = redirectTo
      })
    },

    /**
     * Redirect already-authenticated users away from the auth page.
     * Call this on auth.html to avoid showing the form to logged-in users.
     */
    redirectIfAuthed(destination = REDIRECT.AFTER_AUTH) {
      this.getUser().then(user => {
        if (user) window.location.href = destination
      })
    },
  }

  // ─── Toast notification ───────────────────────────────────────────────────

  function showToast(message, type = 'info') {
    // Remove any existing toast
    document.querySelector('.toast')?.remove()

    const COLORS = { success: '#00D4AA', error: '#FF4757', info: '#8B949E' }
    const color  = COLORS[type] || COLORS.info

    const toast = document.createElement('div')
    toast.className   = 'toast'
    toast.textContent = message
    toast.style.cssText = `border-left: 3px solid ${color}`
    document.body.appendChild(toast)

    // Auto-dismiss after 3 s
    setTimeout(() => {
      toast.style.opacity    = '0'
      toast.style.transition = 'opacity .3s'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  // ─── Theme toggle ─────────────────────────────────────────────────────────

  function _initTheme() {
    const saved  = localStorage.getItem('theme') || 'dark'
    const isLight = saved === 'light'

    if (isLight) document.documentElement.classList.add('light')

    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.innerHTML = isLight
        ? '<i class="fa-solid fa-moon"></i>'
        : '<i class="fa-solid fa-sun"></i>'

      btn.addEventListener('click', () => {
        const nowLight = !document.documentElement.classList.contains('light')
        document.documentElement.classList.toggle('light', nowLight)
        localStorage.setItem('theme', nowLight ? 'light' : 'dark')
        btn.innerHTML = nowLight
          ? '<i class="fa-solid fa-moon"></i>'
          : '<i class="fa-solid fa-sun"></i>'
      })
    })
  }

  // ─── Nav scroll ───────────────────────────────────────────────────────────

  function _initNavScroll() {
    const nav = document.querySelector('nav')
    if (!nav) return
    const update = () => nav.classList.toggle('scrolled', window.scrollY > 20)
    window.addEventListener('scroll', update, { passive: true })
    update()
  }

  // ─── Expose to global scope ───────────────────────────────────────────────

  window.Auth     = Auth
  window.getCSRF  = getCSRF       // convenience for inline page scripts
  window.showToast = showToast

  // ─── Boot ─────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    _initTheme()
    _initNavScroll()
  })

}(window))
