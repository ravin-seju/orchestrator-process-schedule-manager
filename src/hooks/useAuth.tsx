import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { UiPath, UiPathError } from '@uipath/uipath-typescript/core'
import {
  addCustomAuthConfig,
  buildOAuthConfigFromAuthConfig,
  deleteCustomAuthConfigGroup,
  getAuthConfigById,
  getAuthConfigGroupById,
  getAvailableAuthConfigs,
  getSelectedAuthConfigId,
  REQUIRED_ORCHESTRATOR_SCOPES,
  resetCustomAuthConfigs,
  setSelectedAuthConfigId,
  updateCustomAuthConfig,
} from '../uipathConfig'
import type {
  NewAuthConfigInput,
  StoredAuthConfig,
  StoredAuthConfigGroup,
} from '../uipathConfig'

interface AuthContextType {
  activeAuthConfig: StoredAuthConfig | null
  activeAuthConfigGroup: StoredAuthConfigGroup | null
  addAuthConfig: (config: NewAuthConfigInput, options?: { activate?: boolean }) => StoredAuthConfig
  authConfigs: StoredAuthConfig[]
  deleteAuthConfigGroup: (groupId: string) => StoredAuthConfig[]
  dismissSignInIncomplete: () => void
  error: string | null
  isAuthenticated: boolean
  isAuthenticating: boolean
  isInitializing: boolean
  login: () => Promise<void>
  logout: () => void
  resetAuthConfigs: () => StoredAuthConfig[]
  sdk: UiPath | null
  selectAuthConfig: (configId: string | null) => void
  signInIncomplete: boolean
  updateAuthConfig: (
    groupId: string,
    config: NewAuthConfigInput,
    preferredTenant?: string,
    preferredName?: string,
  ) => StoredAuthConfig
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const cleanCurrentUrl = () => `${window.location.origin}${window.location.pathname}${window.location.hash}`

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const [, payload] = token.split('.')
  if (!payload) return null

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')
    return JSON.parse(window.atob(paddedPayload)) as Record<string, unknown>
  } catch {
    return null
  }
}

const parseScopeClaim = (claim: unknown) => {
  if (Array.isArray(claim)) return claim.filter((scope): scope is string => typeof scope === 'string')
  if (typeof claim === 'string') return claim.split(/\s+/).filter(Boolean)
  return []
}

const getTokenScopes = (token: string | undefined) => {
  if (!token) return new Set<string>()

  const payload = decodeJwtPayload(token)
  return new Set([...parseScopeClaim(payload?.scope), ...parseScopeClaim(payload?.scp)])
}

const assertRequiredScopes = (token: string | undefined) => {
  const tokenScopes = getTokenScopes(token)
  const missingTokenScopes = REQUIRED_ORCHESTRATOR_SCOPES.filter((scope) => !tokenScopes.has(scope))

  if (missingTokenScopes.length) {
    throw new Error(
      `UiPath token is missing required scope(s): ${missingTokenScopes.join(', ')}. Confirm the External App includes them, then sign in again.`,
    )
  }
}

function clearOAuthRedirectQueryString(): void {
  if (!window.location.search) return
  window.history.replaceState({}, document.title, cleanCurrentUrl())
}

// A full-page OAuth redirect cedes control to UiPath; if the External App is missing a
// requested scope, UiPath renders its own hosted error page and never redirects back. We
// can't see that, but we can leave a same-tab breadcrumb before redirecting: if the app
// later loads without a callback and without a session, the user came back from a failed
// attempt and we show an in-app recovery landing. sessionStorage auto-clears on tab close,
// so a stale breadcrumb can't haunt a future session.
const SIGNIN_ATTEMPT_KEY = 'process-schedule-manager.oauth.signin-attempt'

const getSessionStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const markSignInAttempt = (): void => {
  getSessionStorage()?.setItem(SIGNIN_ATTEMPT_KEY, '1')
}

const clearSignInAttempt = (): void => {
  getSessionStorage()?.removeItem(SIGNIN_ATTEMPT_KEY)
}

// Read-and-clear: returns whether a sign-in attempt was pending, consuming it so it fires once.
const consumeSignInAttempt = (): boolean => {
  const storage = getSessionStorage()
  const wasPending = storage?.getItem(SIGNIN_ATTEMPT_KEY) === '1'
  storage?.removeItem(SIGNIN_ATTEMPT_KEY)
  return wasPending
}

// OAuth authorization codes are single-use (RFC 6749 §4.1.2). React StrictMode
// double-invokes the init effect in dev, which would redeem the code twice — the
// second redemption fails with `invalid_grant`. Memoize the exchange per config so
// both effect runs await the SAME redemption and resolve to the one authenticated
// instance; the surviving (non-cancelled) run delivers it to state.
let oauthExchange: { key: string; promise: Promise<UiPath> } | null = null

function completeOAuthOnce(instance: UiPath, key: string): Promise<UiPath> {
  if (oauthExchange?.key === key) return oauthExchange.promise
  const promise = instance.completeOAuth().then(() => instance)
  oauthExchange = { key, promise }
  return promise
}

// Test-only hook: reset the memoized OAuth exchange between unit tests.
// eslint-disable-next-line react-refresh/only-export-components
export function __resetOAuthExchangeForTests(): void {
  oauthExchange = null
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [authConfigs, setAuthConfigs] = useState<StoredAuthConfig[]>(() => getAvailableAuthConfigs())
  const [activeAuthConfigId, setActiveAuthConfigId] = useState<string | null>(() =>
    getSelectedAuthConfigId(getAvailableAuthConfigs()),
  )
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [signInIncomplete, setSignInIncomplete] = useState(false)
  const [sdk, setSdk] = useState<UiPath | null>(null)

  const activeAuthConfig = authConfigs.find((config) => config.id === activeAuthConfigId) ?? null
  const activeAuthConfigGroup = activeAuthConfig ? getAuthConfigGroupById(activeAuthConfig.groupId) : null

  const clearCurrentSdkSession = useCallback(() => {
    try {
      sdk?.logout()
    } catch (err) {
      console.warn('Unable to clear the previous UiPath SDK session while switching connections.', err)
    }

    setIsAuthenticated(false)
    setIsAuthenticating(false)
    setError(null)
    setSignInIncomplete(false)
  }, [sdk])

  const refreshConfigs = useCallback((nextActiveId?: string | null) => {
    const nextConfigs = getAvailableAuthConfigs()
    const selectedId =
      nextActiveId !== undefined
        ? nextActiveId && nextConfigs.some((config) => config.id === nextActiveId)
          ? nextActiveId
          : null
        : getSelectedAuthConfigId(nextConfigs)

    setAuthConfigs(nextConfigs)
    setSelectedAuthConfigId(selectedId)
    setActiveAuthConfigId(selectedId)
    setSdk(null)
    setIsAuthenticated(false)
    setIsAuthenticating(false)
    setError(null)
    setSignInIncomplete(false)

    return nextConfigs
  }, [])

  useEffect(() => {
    let cancelled = false

    const initializeExistingAuth = async () => {
      setIsInitializing(true)
      setError(null)

      if (!activeAuthConfig) {
        if (!cancelled) {
          clearSignInAttempt()
          setSdk(null)
          setIsAuthenticated(false)
          setIsInitializing(false)
        }
        return
      }

      try {
        const instance = new UiPath(buildOAuthConfigFromAuthConfig(activeAuthConfig))

        if (instance.isInOAuthCallback()) {
          let authed: UiPath
          try {
            authed = await completeOAuthOnce(instance, activeAuthConfig.id)
          } finally {
            clearOAuthRedirectQueryString()
          }
          assertRequiredScopes(authed.getToken())

          if (!cancelled) {
            clearSignInAttempt()
            setSdk(authed)
            setIsAuthenticated(true)
            setIsInitializing(false)
          }
          return
        }

        const alreadyAuthenticated = instance.isAuthenticated()
        if (alreadyAuthenticated) {
          assertRequiredScopes(instance.getToken())
        }

        if (!cancelled) {
          // No callback + no session, but a sign-in attempt was pending → the user bounced
          // back from a failed UiPath redirect (most likely the External App lacks a
          // requested scope). Surface the in-app recovery landing instead of a bare retry.
          if (alreadyAuthenticated) {
            clearSignInAttempt()
          } else if (consumeSignInAttempt()) {
            setSignInIncomplete(true)
          }
          setSdk(instance)
          setIsAuthenticated(alreadyAuthenticated)
          setIsInitializing(false)
        }
      } catch (err) {
        if (!cancelled) {
          clearSignInAttempt()
          console.error('UiPath sign-in failed:', err)
          setError(err instanceof Error ? err.message : 'UiPath sign-in failed')
          setIsAuthenticated(false)
          setIsInitializing(false)
        }
      }
    }

    initializeExistingAuth()

    return () => {
      cancelled = true
    }
  }, [activeAuthConfig])

  const login = useCallback(async () => {
    if (!sdk || !activeAuthConfig) return

    try {
      setError(null)
      setSignInIncomplete(false)
      // Drives the sign-in button spinner. Stays true through the redirect (the page unloads),
      // so the busy render is never coalesced away; only the catch below clears it, when sign-in
      // fails locally with no redirect.
      setIsAuthenticating(true)
      markSignInAttempt()
      await sdk.initialize()
      // initialize() resolves even when it has scheduled a full-page redirect to UiPath —
      // navigation only commits once this task yields, so any code here runs first. Only
      // finalize (and clear the breadcrumb) when a session actually exists; otherwise a
      // redirect is pending and the breadcrumb must survive the round-trip so the return
      // can surface the recovery landing.
      if (sdk.isAuthenticated()) {
        clearSignInAttempt()
        assertRequiredScopes(sdk.getToken())
        setIsAuthenticated(true)
      }
    } catch (err) {
      clearSignInAttempt()
      const message = err instanceof UiPathError || err instanceof Error ? err.message : 'UiPath sign-in failed'
      setError(message)
      setIsAuthenticated(false)
      setIsAuthenticating(false)
    }
  }, [activeAuthConfig, sdk])

  const dismissSignInIncomplete = useCallback(() => {
    setSignInIncomplete(false)
  }, [])

  const logout = useCallback(() => {
    sdk?.logout()
    setIsAuthenticated(false)
    setError(null)
  }, [sdk])

  const selectAuthConfig = useCallback((configId: string | null) => {
    clearCurrentSdkSession()
    refreshConfigs(configId)
  }, [clearCurrentSdkSession, refreshConfigs])

  const addAuthConfig = useCallback((config: NewAuthConfigInput, options: { activate?: boolean } = {}) => {
    const nextConfig = addCustomAuthConfig(config)
    const nextEntry = getAuthConfigById(nextConfig.id) ?? nextConfig
    const shouldActivate = options.activate ?? true

    if (!shouldActivate) {
      setAuthConfigs(getAvailableAuthConfigs())
      setError(null)
      return nextEntry
    }

    clearCurrentSdkSession()
    refreshConfigs(nextEntry.id)
    return nextEntry
  }, [clearCurrentSdkSession, refreshConfigs])

  const updateAuthConfigHandler = useCallback((
    groupId: string,
    config: NewAuthConfigInput,
    preferredTenant?: string,
    preferredName?: string,
  ) => {
    const nextConfig = updateCustomAuthConfig(groupId, config, preferredTenant, preferredName)
    const nextEntry = getAuthConfigById(nextConfig.id) ?? nextConfig
    clearCurrentSdkSession()
    refreshConfigs(nextEntry.id)
    return nextEntry
  }, [clearCurrentSdkSession, refreshConfigs])

  const deleteAuthConfigGroupHandler = useCallback((groupId: string) => {
    const isActiveGroup = activeAuthConfig?.groupId === groupId
    const nextConfigs = deleteCustomAuthConfigGroup(groupId)

    if (isActiveGroup) {
      clearCurrentSdkSession()
    }

    refreshConfigs(getSelectedAuthConfigId(nextConfigs))
    return nextConfigs
  }, [activeAuthConfig?.groupId, clearCurrentSdkSession, refreshConfigs])

  const resetAuthConfigsHandler = useCallback(() => {
    const nextConfigs = resetCustomAuthConfigs()
    clearCurrentSdkSession()
    refreshConfigs(getSelectedAuthConfigId(nextConfigs))
    return nextConfigs
  }, [clearCurrentSdkSession, refreshConfigs])

  return (
    <AuthContext.Provider
      value={{
        activeAuthConfig,
        activeAuthConfigGroup,
        addAuthConfig,
        authConfigs,
        deleteAuthConfigGroup: deleteAuthConfigGroupHandler,
        dismissSignInIncomplete,
        error,
        isAuthenticated,
        isAuthenticating,
        isInitializing,
        login,
        logout,
        resetAuthConfigs: resetAuthConfigsHandler,
        sdk,
        selectAuthConfig,
        signInIncomplete,
        updateAuthConfig: updateAuthConfigHandler,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// AuthProvider and useAuth live together so consumers cannot import the context directly.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}
