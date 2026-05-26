// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../hooks/useAuth'
import {
  addCustomAuthConfig,
  getAvailableAuthConfigs,
  setSelectedAuthConfigId,
} from '../uipathConfig'

const sdkState = vi.hoisted(() => ({
  authenticated: false,
  callback: false,
  completeOAuth: vi.fn(),
  initialize: vi.fn(),
  logout: vi.fn(),
  token: '',
}))

const createToken = (scopes: string[]) => {
  const payload = window.btoa(JSON.stringify({ scope: scopes.join(' ') }))
  return `header.${payload}.signature`
}

vi.mock('@uipath/uipath-typescript', () => ({
  getAppBase: () => '/',
}))

vi.mock('@uipath/uipath-typescript/core', () => ({
  UiPath: class MockUiPath {
    config: Record<string, string>

    constructor(config: Record<string, string>) {
      this.config = config
    }

    async completeOAuth() {
      await sdkState.completeOAuth()
    }

    getToken() {
      return sdkState.token
    }

    async initialize() {
      await sdkState.initialize()
    }

    isAuthenticated() {
      return sdkState.authenticated
    }

    isInOAuthCallback() {
      return sdkState.callback
    }

    logout() {
      sdkState.logout()
      sdkState.authenticated = false
    }
  },
  UiPathError: Error,
}))

function Probe() {
  const auth = useAuth()

  return (
    <div>
      <span data-testid="state">
        {auth.isInitializing ? 'loading' : auth.isAuthenticated ? 'authenticated' : 'guest'}
      </span>
      <span data-testid="error">{auth.error ?? ''}</span>
      <span data-testid="active-organization">{auth.activeAuthConfig?.organization ?? ''}</span>
      <span data-testid="config-count">{auth.authConfigs.length}</span>
      <button type="button" onClick={auth.login}>Sign in</button>
      <button type="button" onClick={() => auth.selectAuthConfig('second-connection-0-0')}>Switch connection</button>
      <button type="button" onClick={() => auth.deleteAuthConfigGroup('second-connection')}>Delete second connection</button>
      <button
        type="button"
        onClick={() =>
          auth.addAuthConfig(
            {
              externalApps: [
                {
                  clientId: 'new-client-id',
                  name: 'New App',
                  scope: 'OR.Folders.Read OR.Execution.Read OR.Jobs.Read',
                  urlAppRedirect: 'http://localhost:5175',
                },
              ],
              organization: 'neworg',
              tenants: ['Production'],
              urlApp: 'https://cloud.uipath.com',
              urlBase: 'https://api.uipath.com',
            },
            { activate: false },
          )
        }
      >
        Save new connection
      </button>
    </div>
  )
}

const stubEnv = () => {
  vi.stubEnv('VITE_UIPATH_BASE_URL', 'https://staging.uipath.com')
  vi.stubEnv('VITE_UIPATH_CLIENT_ID', 'client-id')
  vi.stubEnv('VITE_UIPATH_ORG_NAME', 'ravinseju')
  vi.stubEnv('VITE_UIPATH_TENANT_NAME', 'Demo')
}

const rememberFirstConfig = () => {
  addCustomAuthConfig({
    externalApps: [
      {
        clientId: 'client-id',
        name: 'Test App',
        scope: '',
        urlAppRedirect: 'http://localhost:5175',
      },
    ],
    organization: 'ravinseju',
    tenants: ['Demo'],
    urlApp: 'https://staging.uipath.com',
    urlBase: 'https://staging.api.uipath.com',
  })
  const configs = getAvailableAuthConfigs()
  setSelectedAuthConfigId(configs[0]?.id ?? null)
}

const rememberLegacyInvalidConfig = () => {
  window.localStorage.setItem(
    'process-schedule-manager.oauth.custom-auth-configs',
    JSON.stringify([
      {
        externalApps: [
          {
            clientId: 'client-id',
            name: 'Legacy App',
            scope: 'OR.Folders.Read OR.Execution.Read',
            urlAppRedirect: 'http://localhost:5175',
          },
        ],
        id: 'legacy-invalid',
        organization: 'ravinseju',
        source: 'custom',
        tenants: ['Demo'],
        urlApp: 'https://staging.uipath.com',
        urlBase: 'https://staging.api.uipath.com',
      },
    ]),
  )
  setSelectedAuthConfigId('legacy-invalid-0-0')
}

const rememberTwoConfigs = () => {
  window.localStorage.setItem(
    'process-schedule-manager.oauth.custom-auth-configs',
    JSON.stringify([
      {
        externalApps: [
          {
            clientId: 'client-id',
            name: 'First App',
            scope: 'OR.Folders.Read OR.Execution.Read OR.Jobs.Read',
            urlAppRedirect: 'http://localhost:5175',
          },
        ],
        id: 'first-connection',
        organization: 'ravinseju',
        source: 'custom',
        tenants: ['Demo'],
        urlApp: 'https://staging.uipath.com',
        urlBase: 'https://staging.api.uipath.com',
      },
      {
        externalApps: [
          {
            clientId: 'second-client-id',
            name: 'Second App',
            scope: 'OR.Folders.Read OR.Execution.Read OR.Jobs.Read',
            urlAppRedirect: 'http://localhost:5175',
          },
        ],
        id: 'second-connection',
        organization: 'cloudorg',
        source: 'custom',
        tenants: ['DefaultTenant'],
        urlApp: 'https://cloud.uipath.com',
        urlBase: 'https://api.uipath.com',
      },
    ]),
  )
  setSelectedAuthConfigId('first-connection-0-0')
}

beforeEach(() => {
  cleanup()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  sdkState.authenticated = false
  sdkState.callback = false
  sdkState.token = createToken(['OR.Folders.Read', 'OR.Execution.Read', 'OR.Jobs.Read'])
  sdkState.completeOAuth.mockReset()
  sdkState.initialize.mockReset()
  sdkState.logout.mockReset()
  stubEnv()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('guided AuthProvider', () => {
  it('does not start OAuth automatically when a remembered config exists', async () => {
    rememberFirstConfig()

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('guest'))

    expect(sdkState.initialize).not.toHaveBeenCalled()
  })

  it('starts OAuth when login is clicked', async () => {
    rememberFirstConfig()
    sdkState.initialize.mockImplementation(async () => {
      sdkState.authenticated = true
    })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('guest'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(sdkState.initialize).toHaveBeenCalledTimes(1))
  })

  it('completes OAuth callbacks and clears callback params', async () => {
    rememberFirstConfig()
    window.history.replaceState(null, '', '/?code=abc&state=xyz')
    sdkState.callback = true
    sdkState.authenticated = true

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('authenticated'))

    expect(sdkState.completeOAuth).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('')
  })

  it('clears callback params when OAuth callback completion fails', async () => {
    rememberFirstConfig()
    window.history.replaceState(null, '', '/?code=abc&state=xyz')
    sdkState.callback = true
    sdkState.completeOAuth.mockRejectedValueOnce(new Error('Failed to get access token: {"error":"invalid_grant"}'))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('guest'))

    expect(sdkState.completeOAuth).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('')
  })

  it('surfaces missing required scope errors', async () => {
    rememberLegacyInvalidConfig()

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('guest'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('OR.Jobs.Read'))
  })

  it('clears the previous SDK session when switching saved connections', async () => {
    rememberTwoConfigs()
    sdkState.authenticated = true

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('authenticated'))
    fireEvent.click(screen.getByRole('button', { name: 'Switch connection' }))

    await waitFor(() => expect(sdkState.logout).toHaveBeenCalledTimes(1))
    expect(window.localStorage.getItem('process-schedule-manager.oauth.active-auth-config-id')).toBe('second-connection-0-0')
  })

  it('can save a new connection without activating it or closing the active session', async () => {
    rememberFirstConfig()
    const originalActiveId = window.localStorage.getItem('process-schedule-manager.oauth.active-auth-config-id')
    sdkState.authenticated = true

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('authenticated'))
    fireEvent.click(screen.getByRole('button', { name: 'Save new connection' }))

    await waitFor(() => expect(screen.getByTestId('config-count')).toHaveTextContent('2'))
    expect(screen.getByTestId('state')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('active-organization')).toHaveTextContent('ravinseju')
    expect(sdkState.logout).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('process-schedule-manager.oauth.active-auth-config-id')).toBe(originalActiveId)
  })

  it('can delete a non-active saved connection without closing the active session', async () => {
    rememberTwoConfigs()
    sdkState.authenticated = true

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('authenticated'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete second connection' }))

    await waitFor(() => expect(screen.getByTestId('config-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('state')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('active-organization')).toHaveTextContent('ravinseju')
    expect(getAvailableAuthConfigs().map((config) => config.groupId)).toEqual(['first-connection'])
    expect(sdkState.logout).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('process-schedule-manager.oauth.active-auth-config-id')).toBe('first-connection-0-0')
  })
})
