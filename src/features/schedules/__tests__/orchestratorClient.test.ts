import type { UiPath } from '@uipath/uipath-typescript/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadProcessSchedules, loadTenants } from '../orchestrator'

const sdk = {
  config: {
    baseUrl: 'https://staging.uipath.com',
    orgName: 'ravinseju',
    tenantName: 'Demo',
  },
  getToken: () => 'oauth-token',
} as unknown as UiPath

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('browser Orchestrator client', () => {
  it('loads dynamic tenants with the SDK OAuth token', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ value: [{ DisplayName: 'Demo Tenant', Name: 'Demo' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadTenants(sdk)).resolves.toEqual({
      tenants: [{ displayName: 'Demo Tenant', name: 'Demo', source: 'dynamic' }],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://staging.api.uipath.com/ravinseju/Demo/orchestrator_/odata/Tenants?$top=100',
      {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer oauth-token',
        },
      },
    )
  })

  it('falls back to configured tenants when dynamic discovery is denied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Denied' }, 403)))

    await expect(loadTenants(sdk)).resolves.toEqual({
      tenants: [
        { displayName: 'Demo', name: 'Demo', source: 'configured' },
      ],
    })
  })

  it('derives OData API host from the selected SDK connection instead of a global env override', async () => {
    vi.stubEnv('VITE_UIPATH_API_BASE_URL', 'https://staging.api.uipath.com')
    const cloudSdk = {
      config: {
        baseUrl: 'https://cloud.uipath.com',
        orgName: 'customerorg',
        tenantName: 'DefaultTenant',
      },
      getToken: () => 'oauth-token',
    } as unknown as UiPath
    const fetchMock = vi.fn(async () =>
      jsonResponse({ value: [{ DisplayName: 'Default Tenant', Name: 'DefaultTenant' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadTenants(cloudSdk)).resolves.toEqual({
      tenants: [{ displayName: 'Default Tenant', name: 'DefaultTenant', source: 'dynamic' }],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.uipath.com/customerorg/DefaultTenant/orchestrator_/odata/Tenants?$top=100',
      {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer oauth-token',
        },
      },
    )
  })

  it('prefers saved connection tenants over the active SDK tenant when discovery is denied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Denied' }, 403)))

    await expect(loadTenants(sdk, ['Finance', 'Payroll'])).resolves.toEqual({
      tenants: [
        { displayName: 'Finance', name: 'Finance', source: 'configured' },
        { displayName: 'Payroll', name: 'Payroll', source: 'configured' },
        { displayName: 'Demo', name: 'Demo', source: 'configured' },
      ],
    })
  })

  it('loads folders and schedules while preserving failed folder warnings', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      const folderId = (init?.headers as Record<string, string> | undefined)?.['X-UIPATH-OrganizationUnitId']

      if (requestUrl.includes('/Tenants?')) {
        return jsonResponse({ value: [{ Name: 'Demo' }] })
      }

      if (requestUrl.includes('/Folders?')) {
        return jsonResponse({
          value: [
            { DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 101, Key: 'folder-101' },
            { DisplayName: 'Finance', FullyQualifiedName: 'Finance', Id: 202, Key: 'folder-202' },
          ],
        })
      }

      if (requestUrl.includes('/ProcessSchedules?') && folderId === '101') {
        return jsonResponse({
          value: [{ Enabled: true, Id: 1, Name: 'Daily Trigger', StartProcessCronSummary: 'At 10:00 AM' }],
        })
      }

      return jsonResponse({ error: { message: 'Folder denied' } }, 403)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadProcessSchedules(sdk, 'Demo')

    expect(result.schedules).toEqual([
      {
        Enabled: true,
        Id: 1,
        Name: 'Daily Trigger',
        StartProcessCronSummary: 'At 10:00 AM',
        folderId: 101,
        folderName: 'Shared',
      },
    ])
    expect(result.failedFolders).toEqual([
      {
        folder: { DisplayName: 'Finance', FullyQualifiedName: 'Finance', Id: 202, Key: 'folder-202' },
        message: 'Folder denied',
      },
    ])
  })
})
