import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchOData, ODataFetchError, settledBatch } from '@/features/orchestrator/odataClient'
import { V11_ENABLED } from '@/features/v11'

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
  MachineRobots?: Array<{
    MachineId: number
    MachineName: string
    RobotId: number | null
    RobotName: string | null
  }>
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
  failedFolders: Array<{ folder: Folder; message: string; reason?: 'missing-scope' }>
}

export interface LoadTenantsResult {
  tenants: TenantInfo[]
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

const buildFolderNameMap = (folders: Folder[]): Map<number, string> =>
  new Map(
    folders.map((folder) => [
      folder.Id,
      folder.FullyQualifiedName ?? folder.DisplayName ?? `Folder ${folder.Id}`,
    ]),
  )

// Per-folder fan-out: one ProcessSchedules request per folder. ProcessSchedules
// is folder-scoped — Orchestrator rejects any query without a folder header
// (errorCode 1101 "A folder is required for this action"), so this is the only
// way to read tenant-wide. Volume is bounded by folder count; cache + the global
// rate limiter keep it within API limits.
async function loadProcessSchedulesPerFolder(
  sdk: UiPath,
  tenantName: string,
  folders: Folder[],
): Promise<{ schedules: ProcessSchedule[]; failedFolders: LoadSchedulesResult['failedFolders'] }> {
  const baseScheduleQuery = `ProcessSchedules?$select=${selectedScheduleFields}&$orderby=Name&$top=1000`
  // MachineRobots navigation property name is tenant-dependent; expand disabled until verified via $metadata
  const v11ScheduleQuery = baseScheduleQuery
  const folderNameById = buildFolderNameMap(folders)

  const settled = await settledBatch(
    folders,
    10,
    async (folder) => {
      const scheduleResponse = await (V11_ENABLED
        ? fetchOData<Record<string, unknown>>(sdk, tenantName, v11ScheduleQuery, folder.Id)
            .catch((err) => {
              if (err instanceof ODataFetchError) {
                return fetchOData<Record<string, unknown>>(sdk, tenantName, baseScheduleQuery, folder.Id)
              }
              throw err
            })
        : fetchOData<Record<string, unknown>>(sdk, tenantName, baseScheduleQuery, folder.Id))
      const folderName = folderNameById.get(folder.Id) ?? `Folder ${folder.Id}`
      return (scheduleResponse.value ?? []).map((schedule) => ({
        ...schedule,
        folderId: folder.Id,
        folderName,
      })) as ProcessSchedule[]
    },
  )

  const schedules: ProcessSchedule[] = []
  const failedFolders: LoadSchedulesResult['failedFolders'] = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      schedules.push(...result.value)
      return
    }

    const err = result.reason
    const message = err instanceof Error ? err.message : String(err)
    const reason =
      V11_ENABLED && err instanceof ODataFetchError && err.status === 403
        ? ('missing-scope' as const)
        : undefined
    failedFolders.push({ folder: folders[index], message, reason })
  })

  return { failedFolders, schedules }
}

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

  const { schedules, failedFolders } = await loadProcessSchedulesPerFolder(sdk, selectedTenant.name, folders)
  return { failedFolders, folders, schedules, tenant: selectedTenant }
}
