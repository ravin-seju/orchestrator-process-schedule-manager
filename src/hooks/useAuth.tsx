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
  getMissingRequiredScopes,
  getSelectedAuthConfigId,
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
  error: string | null
  isAuthenticated: boolean
  isInitializing: boolean
  login: () => Promise<void>
  logout: () => void
  resetAuthConfigs: () => StoredAuthConfig[]
  sdk: UiPath | null
  selectAuthConfig: (configId: string | null) => void
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

const assertConfiguredRequiredScopes = (configuredScope: string) => {
  const missingConfiguredScopes = getMissingRequiredScopes(configuredScope)
  if (missingConfiguredScopes.length) {
    throw new Error(
      `Selected connection is missing required scope(s): ${missingConfiguredScopes.join(', ')}.`,
    )
  }
}

const assertRequiredScopes = (token: string | undefined, configuredScope: string) => {
  assertConfiguredRequiredScopes(configuredScope)
  const tokenScopes = getTokenScopes(token)
  const missingTokenScopes = configuredScope
    .split(/\s+/)
    .filter(Boolean)
    .filter((scope) => !tokenScopes.has(scope))

  if (missingTokenScopes.length) {
    throw new Error(
      `UiPath token is missing configured scope(s): ${missingTokenScopes.join(', ')}. Confirm the External App includes them, then sign in again.`,
    )
  }
}

function clearOAuthRedirectQueryString(): void {
  if (!window.location.search) return
  window.history.replaceState({}, document.title, cleanCurrentUrl())
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [authConfigs, setAuthConfigs] = useState<StoredAuthConfig[]>(() => getAvailableAuthConfigs())
  const [activeAuthConfigId, setActiveAuthConfigId] = useState<string | null>(() =>
    getSelectedAuthConfigId(getAvailableAuthConfigs()),
  )
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
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
    setError(null)
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
    setError(null)

    return nextConfigs
  }, [])

  useEffect(() => {
    let cancelled = false

    const initializeExistingAuth = async () => {
      setIsInitializing(true)
      setError(null)

      if (!activeAuthConfig) {
        if (!cancelled) {
          setSdk(null)
          setIsAuthenticated(false)
          setIsInitializing(false)
        }
        return
      }

      try {
        const instance = new UiPath(buildOAuthConfigFromAuthConfig(activeAuthConfig))

        if (instance.isInOAuthCallback()) {
          try {
            await instance.completeOAuth()
          } finally {
            clearOAuthRedirectQueryString()
          }
          assertRequiredScopes(instance.getToken(), activeAuthConfig.scope)

          if (!cancelled) {
            setSdk(instance)
            setIsAuthenticated(true)
            setIsInitializing(false)
          }
          return
        }

        const alreadyAuthenticated = instance.isAuthenticated()
        if (alreadyAuthenticated) {
          assertRequiredScopes(instance.getToken(), activeAuthConfig.scope)
        }

        if (!cancelled) {
          setSdk(instance)
          setIsAuthenticated(alreadyAuthenticated)
          setIsInitializing(false)
        }
      } catch (err) {
        console.error('UiPath sign-in failed:', err)
        if (!cancelled) {
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
      assertConfiguredRequiredScopes(activeAuthConfig.scope)
      await sdk.initialize()
      assertRequiredScopes(sdk.getToken(), activeAuthConfig.scope)
      setIsAuthenticated(sdk.isAuthenticated())
    } catch (err) {
      const message = err instanceof UiPathError || err instanceof Error ? err.message : 'UiPath sign-in failed'
      setError(message)
      setIsAuthenticated(false)
    }
  }, [activeAuthConfig, sdk])

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
        error,
        isAuthenticated,
        isInitializing,
        login,
        logout,
        resetAuthConfigs: resetAuthConfigsHandler,
        sdk,
        selectAuthConfig,
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
