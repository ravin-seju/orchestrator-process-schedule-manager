// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeScopeGroup,
  addCustomAuthConfig,
  buildOAuthConfig,
  getAvailableAuthConfigs,
  getConnectionDefaults,
  getDefaultRedirectUri,
  getMissingRequiredScopes,
  getSelectedAuthConfigId,
  isScopeAcknowledged,
  REQUIRED_ORCHESTRATOR_SCOPE_TEXT,
  resetCustomAuthConfigs,
  setSelectedAuthConfigId,
} from '../uipathConfig'

const sdkMock = vi.hoisted(() => ({
  appBase: '/',
}))

vi.mock('@uipath/uipath-typescript', () => ({
  getAppBase: () => sdkMock.appBase,
}))

beforeEach(() => {
  sdkMock.appBase = '/'
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('UiPath connection config', () => {
  it('does not auto-seed env values as saved connections on first load', () => {
    vi.stubEnv('VITE_UIPATH_BASE_URL', 'https://staging.uipath.com')
    vi.stubEnv('VITE_UIPATH_CLIENT_ID', 'client-id')
    vi.stubEnv('VITE_UIPATH_ORG_NAME', 'ravinseju')
    vi.stubEnv('VITE_UIPATH_TENANTS', 'Demo, Attended')

    expect(getAvailableAuthConfigs()).toEqual([])
    expect(getSelectedAuthConfigId([])).toBeNull()
  })

  it('keeps add-connection defaults empty except for the current redirect URI', () => {
    vi.stubEnv('VITE_UIPATH_BASE_URL', 'https://staging.uipath.com')
    vi.stubEnv('VITE_UIPATH_CLIENT_ID', 'client-id')
    vi.stubEnv('VITE_UIPATH_ORG_NAME', 'ravinseju')
    vi.stubEnv('VITE_UIPATH_TENANTS', 'Demo, Attended')

    expect(getConnectionDefaults('http://localhost:5175')).toEqual({
      clientId: '',
      organization: '',
      redirectUri: 'http://localhost:5175',
      tenants: '',
      urlApp: '',
    })
  })

  it('derives redirect URIs for local root and deployed coded-app base paths', () => {
    expect(getDefaultRedirectUri('http://localhost:5177')).toBe('http://localhost:5177')

    sdkMock.appBase = '/apps/process-schedule-manager/'

    expect(getDefaultRedirectUri('https://cloud.uipath.com')).toBe(
      'https://cloud.uipath.com/apps/process-schedule-manager',
    )
  })

  it('saves custom connections with the fixed required scope', () => {
    const savedConfig = addCustomAuthConfig({
      externalApps: [
        {
          clientId: 'client-id',
          name: 'Customer App',
          scope: 'OR.Folders.Read',
          urlAppRedirect: 'http://localhost:5175',
        },
      ],
      organization: 'ravinseju',
      tenants: ['Demo', 'Attended'],
      urlApp: 'https://staging.uipath.com',
      urlBase: 'https://staging.api.uipath.com',
    })

    const configs = getAvailableAuthConfigs()

    expect(savedConfig.scope).toBe(REQUIRED_ORCHESTRATOR_SCOPE_TEXT)
    expect(configs).toHaveLength(2)
    expect(configs.map((config) => config.tenant)).toEqual(['Demo', 'Attended'])
  })

  it('builds SDK auth config from a saved custom connection', () => {
    addCustomAuthConfig({
      externalApps: [
        {
          clientId: 'client-id',
          name: 'Customer App',
          scope: '',
          urlAppRedirect: 'http://localhost:5175',
        },
      ],
      organization: 'ravinseju',
      tenants: ['Demo'],
      urlApp: 'https://staging.uipath.com',
      urlBase: 'https://staging.api.uipath.com',
    })

    expect(buildOAuthConfig('http://localhost:5175')).toEqual({
      baseUrl: 'https://staging.uipath.com',
      clientId: 'client-id',
      orgName: 'ravinseju',
      redirectUri: 'http://localhost:5175',
      scope: REQUIRED_ORCHESTRATOR_SCOPE_TEXT,
      tenantName: 'Demo',
    })
  })

  it('keeps organization display casing while using a lowercase SDK org slug', () => {
    addCustomAuthConfig({
      externalApps: [
        {
          clientId: 'client-id',
          name: 'Customer App',
          scope: '',
          urlAppRedirect: 'http://localhost:5175',
        },
      ],
      organization: 'RavinSeju',
      tenants: ['Demo'],
      urlApp: 'https://staging.uipath.com',
      urlBase: 'https://staging.api.uipath.com',
    })

    expect(getAvailableAuthConfigs()[0]).toMatchObject({
      organization: 'RavinSeju',
      organizationSlug: 'ravinseju',
    })
    expect(buildOAuthConfig('http://localhost:5175')).toMatchObject({
      orgName: 'ravinseju',
    })
  })

  it('normalizes pasted UiPath app URLs to the environment root for SDK OAuth', () => {
    addCustomAuthConfig({
      externalApps: [
        {
          clientId: 'client-id',
          name: 'Customer App',
          scope: '',
          urlAppRedirect: 'http://localhost:5175',
        },
      ],
      organization: 'ravinseju',
      tenants: ['Demo'],
      urlApp: 'https://staging.uipath.com/ravinseju/Demo',
      urlBase: 'https://staging.api.uipath.com',
    })

    expect(buildOAuthConfig('http://localhost:5175')).toMatchObject({
      baseUrl: 'https://staging.uipath.com',
    })
  })

  it('reports when no saved UiPath connection exists', () => {
    expect(() => buildOAuthConfig('http://localhost:5175')).toThrow(
      'No saved UiPath connection',
    )
  })

  it('remembers the selected saved config id', () => {
    addCustomAuthConfig({
      externalApps: [
        {
          clientId: 'client-id',
          name: 'Customer App',
          scope: '',
          urlAppRedirect: 'http://localhost:5175',
        },
      ],
      organization: 'ravinseju',
      tenants: ['Demo', 'Attended'],
      urlApp: 'https://staging.uipath.com',
      urlBase: 'https://staging.api.uipath.com',
    })
    const configs = getAvailableAuthConfigs()

    setSelectedAuthConfigId(configs[1].id)

    expect(getSelectedAuthConfigId(configs)).toBe(configs[1].id)
  })

  it('resets saved connection state back to an empty first-run state', () => {
    addCustomAuthConfig({
      externalApps: [
        {
          clientId: 'client-id',
          name: 'Customer App',
          scope: '',
          urlAppRedirect: 'http://localhost:5175',
        },
      ],
      organization: 'ravinseju',
      tenants: ['Demo'],
      urlApp: 'https://staging.uipath.com',
      urlBase: 'https://staging.api.uipath.com',
    })
    setSelectedAuthConfigId(getAvailableAuthConfigs()[0].id)

    expect(resetCustomAuthConfigs()).toEqual([])
    expect(getSelectedAuthConfigId([])).toBeNull()
  })

  it('detects missing required Orchestrator scopes from legacy saved configs', () => {
    expect(getMissingRequiredScopes('OR.Folders.Read OR.Execution.Read')).toEqual([
      'OR.Jobs.Read',
      'OR.Machines.Read',
      'OR.Robots.Read',
    ])
    expect(getMissingRequiredScopes(REQUIRED_ORCHESTRATOR_SCOPE_TEXT)).toEqual([])
  })

  it('heals legacy saved scopes to the full required set on read so sign-in is not stranded', () => {
    window.localStorage.setItem(
      'process-schedule-manager.oauth.custom-auth-configs',
      JSON.stringify([
        {
          externalApps: [
            {
              clientId: 'client-id',
              name: 'Legacy App',
              scope: 'OR.Folders.Read OR.Execution.Read OR.Jobs.Read',
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

    const [config] = getAvailableAuthConfigs()

    expect(config.scope).toBe(REQUIRED_ORCHESTRATOR_SCOPE_TEXT)
    expect(getMissingRequiredScopes(config.scope)).toEqual([])
  })

  it('records per-group scope acknowledgment and clears it on reset', () => {
    expect(isScopeAcknowledged('group-a')).toBe(false)

    acknowledgeScopeGroup('group-a')
    expect(isScopeAcknowledged('group-a')).toBe(true)
    expect(isScopeAcknowledged('group-b')).toBe(false)

    resetCustomAuthConfigs()
    expect(isScopeAcknowledged('group-a')).toBe(false)
  })
})
