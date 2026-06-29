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

const textResponse = (text: string, status: number) => new Response(text, { status })

const tenantsFetched = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.some((call) => String(call[0]).includes('/Tenants?'))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('browser Orchestrator client', () => {
  describe('loadTenants (configured-only, no discovery)', () => {
    it('returns the configured tenant without calling the /Tenants discovery endpoint', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ value: [] }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(loadTenants(sdk)).resolves.toEqual({
        tenants: [{ displayName: 'Demo', name: 'Demo', source: 'configured' }],
      })

      // /odata/Tenants needs host-admin scope this app never holds — never call it.
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('prefers saved connection tenants over the active SDK tenant, still without discovery', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ value: [] }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(loadTenants(sdk, ['Finance', 'Payroll'])).resolves.toEqual({
        tenants: [
          { displayName: 'Finance', name: 'Finance', source: 'configured' },
          { displayName: 'Payroll', name: 'Payroll', source: 'configured' },
          { displayName: 'Demo', name: 'Demo', source: 'configured' },
        ],
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('loadProcessSchedules', () => {
    it('loads good folders and skips inaccessible ones, without /Tenants discovery', async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const requestUrl = String(url)
        const folderId = (init?.headers as Record<string, string> | undefined)?.['X-UIPATH-OrganizationUnitId']

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
      expect(result.tenant).toEqual({ displayName: 'Demo', name: 'Demo', source: 'configured' })
      expect(tenantsFetched(fetchMock)).toBe(false)
    })

    it('follows @odata.nextLink to load every page of folders', async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const requestUrl = String(url)
        if (requestUrl.includes('/Folders?')) {
          if (requestUrl.includes('$skiptoken=page2')) {
            return jsonResponse({ value: [{ DisplayName: 'B', FullyQualifiedName: 'B', Id: 2, Key: 'folder-2' }] })
          }
          return jsonResponse({
            '@odata.nextLink':
              'https://staging.api.uipath.com/ravinseju/Demo/orchestrator_/odata/Folders?$skiptoken=page2',
            value: [{ DisplayName: 'A', FullyQualifiedName: 'A', Id: 1, Key: 'folder-1' }],
          })
        }
        return jsonResponse({ value: [] })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await loadProcessSchedules(sdk, 'Demo')

      expect(result.folders.map((folder) => folder.Id)).toEqual([1, 2])
    })

    it('targets the derived OData API host for the selected connection', async () => {
      const cloudSdk = {
        config: {
          baseUrl: 'https://cloud.uipath.com',
          orgName: 'customerorg',
          tenantName: 'DefaultTenant',
        },
        getToken: () => 'oauth-token',
      } as unknown as UiPath
      let foldersUrl: string | undefined
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const requestUrl = String(url)
        if (requestUrl.includes('/Folders?')) foldersUrl = requestUrl
        return jsonResponse({ value: [] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await loadProcessSchedules(cloudSdk, 'DefaultTenant')

      expect(foldersUrl).toBe(
        'https://api.uipath.com/customerorg/DefaultTenant/orchestrator_/odata/Folders?$select=Id,Key,DisplayName,FullyQualifiedName&$orderby=FullyQualifiedName&$top=1000',
      )
    })

    it('throws a not-available error when the tenant is not in the configured set (no discovery fallback)', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ value: [] }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(loadProcessSchedules(sdk, 'Unconfigured')).rejects.toThrow(/not available/i)
      expect(tenantsFetched(fetchMock)).toBe(false)
    })

    it('surfaces a tenant-not-found error when the Folders request returns 404', async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('/Folders?')) {
          return textResponse('Service: orchestrator not found in Organization: ravinseju Tenant: demo', 404)
        }
        return jsonResponse({ value: [] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(loadProcessSchedules(sdk, 'Demo')).rejects.toThrow(/Demo.*not found or is not accessible/i)
    })
  })
})
