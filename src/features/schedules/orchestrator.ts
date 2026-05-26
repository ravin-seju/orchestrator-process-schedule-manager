import type { UiPath } from '@uipath/uipath-typescript/core'

export interface Folder {
  Id: number
  Key?: string
  DisplayName?: string
  FullyQualifiedName?: string
  IsPersonal?: boolean
}

export interface ProcessSchedule {
  Id: number
  Name: string
  Enabled: boolean
  ReleaseId?: number
  ReleaseKey?: string
  ReleaseName?: string | null
  PackageName?: string | null
  StartProcessCron?: string | null
  StartProcessCronDetails?: string | null
  StartProcessCronSummary?: string | null
  StartProcessNextOccurrence?: string | null
  TimeZoneId?: string | null
  TimeZoneIana?: string | null
  QueueDefinitionId?: number | null
  folderId: number
  folderName: string
}

export interface TenantInfo {
  name: string
  displayName: string
  source: 'dynamic' | 'configured'
}

export interface LoadSchedulesResult {
  tenant: TenantInfo
  folders: Folder[]
  schedules: ProcessSchedule[]
  failedFolders: Array<{ folder: Folder; message: string }>
}

export interface LoadTenantsResult {
  tenants: TenantInfo[]
}

interface ODataCollection<T> {
  value?: T[]
}

const configuredTenantNames = (activeTenantName?: string, savedTenantNames: string[] = []) => {
  const savedTenantSource = savedTenantNames.join(',')
  const rawTenants = [
    savedTenantSource,
    activeTenantName,
  ]
    .filter(Boolean)
    .join(',')
  const seen = new Set<string>()

  return rawTenants
    .split(',')
    .map((tenant) => tenant.trim())
    .filter(Boolean)
    .filter((tenant) => {
      const key = tenant.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const configuredTenants = (activeTenantName?: string, savedTenantNames: string[] = []): TenantInfo[] =>
  configuredTenantNames(activeTenantName, savedTenantNames).map((tenant) => ({
    displayName: tenant,
    name: tenant,
    source: 'configured',
  }))

const isTenantNameAllowed = (tenantName: string) =>
  tenantName.trim().length > 0 && !/[/?#\\]/.test(tenantName)

const normalizeDynamicTenant = (tenant: Record<string, unknown>): TenantInfo | null => {
  const candidate =
    tenant.Name ??
    tenant.name ??
    tenant.TenantName ??
    tenant.tenantName ??
    tenant.DisplayName ??
    tenant.displayName

  if (typeof candidate !== 'string' || !isTenantNameAllowed(candidate)) return null

  const displayName =
    typeof tenant.DisplayName === 'string'
      ? tenant.DisplayName
      : typeof tenant.displayName === 'string'
        ? tenant.displayName
        : candidate

  return {
    displayName,
    name: candidate,
    source: 'dynamic',
  }
}

const readODataError = async (response: Response) => {
  const text = await response.text()
  if (!text) return `${response.status} ${response.statusText}`

  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string }
      message?: string
    }

    return typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.message ?? parsed.message ?? text
  } catch {
    return text
  }
}

const getAccessToken = (sdk: UiPath) => {
  const token = sdk.getToken()
  if (!token) {
    throw new Error('UiPath sign-in token is unavailable. Sign in again and retry.')
  }

  return token
}

const deriveApiBaseUrl = (baseUrl: string) => {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

  try {
    const parsed = new URL(normalizedBaseUrl)
    if (parsed.hostname === 'staging.uipath.com') return 'https://staging.api.uipath.com'
    if (parsed.hostname === 'cloud.uipath.com') return 'https://api.uipath.com'
    if (parsed.hostname === 'alpha.uipath.com') return 'https://alpha.api.uipath.com'
    if (
      parsed.hostname === 'staging.api.uipath.com' ||
      parsed.hostname === 'api.uipath.com' ||
      parsed.hostname === 'alpha.api.uipath.com'
    ) {
      return parsed.origin
    }

    return normalizedBaseUrl
  } catch {
    return normalizedBaseUrl
  }
}

const odataUrl = (sdk: UiPath, tenantName: string, path: string) => {
  const apiBase = deriveApiBaseUrl(sdk.config.baseUrl)
  const baseUrl = apiBase.endsWith('/') ? apiBase : `${apiBase}/`
  const orgPath = encodeURIComponent(sdk.config.orgName)
  const tenantPath = encodeURIComponent(tenantName)
  const normalizedPath = path.replace(/^\//, '')

  return new URL(`${orgPath}/${tenantPath}/orchestrator_/odata/${normalizedPath}`, baseUrl).toString()
}

const fetchOData = async <T>(
  sdk: UiPath,
  tenantName: string,
  path: string,
  folderId?: number,
): Promise<ODataCollection<T>> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${getAccessToken(sdk)}`,
  }

  if (folderId !== undefined) {
    headers['X-UIPATH-OrganizationUnitId'] = String(folderId)
  }

  const response = await fetch(odataUrl(sdk, tenantName, path), { headers })
  if (!response.ok) {
    throw new Error(await readODataError(response))
  }

  return response.json() as Promise<ODataCollection<T>>
}

export async function loadTenants(sdk: UiPath, savedTenantNames: string[] = []): Promise<LoadTenantsResult> {
  const fallbackTenants = configuredTenants(sdk.config.tenantName, savedTenantNames)

  try {
    const response = await fetchOData<Record<string, unknown>>(
      sdk,
      sdk.config.tenantName,
      'Tenants?$top=100',
    )
    const tenants = (response.value ?? [])
      .map(normalizeDynamicTenant)
      .filter((tenant): tenant is TenantInfo => Boolean(tenant))

    return { tenants: tenants.length ? tenants : fallbackTenants }
  } catch {
    return { tenants: fallbackTenants }
  }
}

const selectedScheduleFields = [
  'Id',
  'Name',
  'Enabled',
  'ReleaseId',
  'ReleaseKey',
  'ReleaseName',
  'PackageName',
  'StartProcessCron',
  'StartProcessCronDetails',
  'StartProcessCronSummary',
  'StartProcessNextOccurrence',
  'TimeZoneId',
  'TimeZoneIana',
  'QueueDefinitionId',
].join(',')

export async function loadProcessSchedules(
  sdk: UiPath,
  tenantName: string,
  savedTenantNames: string[] = [],
): Promise<LoadSchedulesResult> {
  const tenants = (await loadTenants(sdk, savedTenantNames)).tenants
  const selectedTenant = tenants.find((tenant) => tenant.name.toLowerCase() === tenantName.toLowerCase())

  if (!selectedTenant || !isTenantNameAllowed(selectedTenant.name)) {
    throw new Error(
      `Tenant "${tenantName}" is not available. Add it to the saved connection or grant tenant discovery access.`,
    )
  }

  const folderResponse = await fetchOData<Folder>(
    sdk,
    selectedTenant.name,
    'Folders?$select=Id,Key,DisplayName,FullyQualifiedName&$orderby=FullyQualifiedName&$top=1000',
  )
  const folders = folderResponse.value ?? []
  const settled = await Promise.allSettled(
    folders.map(async (folder) => {
      const scheduleResponse = await fetchOData<Record<string, unknown>>(
        sdk,
        selectedTenant.name,
        `ProcessSchedules?$select=${selectedScheduleFields}&$orderby=Name&$top=1000`,
        folder.Id,
      )
      const folderName = folder.FullyQualifiedName ?? folder.DisplayName ?? `Folder ${folder.Id}`
      return (scheduleResponse.value ?? []).map((schedule) => ({
        ...schedule,
        folderId: folder.Id,
        folderName,
      })) as ProcessSchedule[]
    }),
  )

  const schedules: ProcessSchedule[] = []
  const failedFolders: Array<{ folder: Folder; message: string }> = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      schedules.push(...result.value)
      return
    }

    failedFolders.push({
      folder: folders[index],
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    })
  })

  return { failedFolders, folders, schedules, tenant: selectedTenant }
}
