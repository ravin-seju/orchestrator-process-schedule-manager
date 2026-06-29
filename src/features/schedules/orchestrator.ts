import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchAllPages, fetchOData, ODataFetchError, settledBatch } from '@/features/orchestrator/odataClient'

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
    MachineId: number | null
    MachineName: string | null
    RobotId: number | null
    RobotUserName: string | null
    SessionId: number | null
    SessionName: string | null
  }>
  folderId: number
  folderName: string
}

export interface TenantInfo {
  name: string
  displayName: string
  source: 'configured'
}

export interface LoadSchedulesResult {
  tenant: TenantInfo
  folders: Folder[]
  schedules: ProcessSchedule[]
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

export async function loadTenants(sdk: UiPath, savedTenantNames: string[] = []): Promise<LoadTenantsResult> {
  // /odata/Tenants discovery requires host-admin scope (OR.Administration[.Read]) and is
  // "Host only" per the Orchestrator API spec — this app (OR.Folders/Execution/Jobs.Read,
  // tenant-scoped) can never satisfy it, so it always 403s. The tenant switcher can only offer
  // tenants this app is actually able to load: the connection's configured tenants. Build the
  // list from those, with no network call.
  return { tenants: configuredTenants(sdk.config.tenantName, savedTenantNames) }
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
  'MachineRobots',
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
): Promise<{ schedules: ProcessSchedule[] }> {
  const baseScheduleQuery = `ProcessSchedules?$select=${selectedScheduleFields}&$orderby=Name&$top=1000`
  const folderNameById = buildFolderNameMap(folders)

  const settled = await settledBatch(
    folders,
    10,
    async (folder) => {
      const scheduleResponse = await fetchOData<Record<string, unknown>>(sdk, tenantName, baseScheduleQuery, folder.Id)
      const folderName = folderNameById.get(folder.Id) ?? `Folder ${folder.Id}`
      return (scheduleResponse.value ?? []).map((schedule) => ({
        ...schedule,
        folderId: folder.Id,
        folderName,
      })) as ProcessSchedule[]
    },
  )

  const schedules: ProcessSchedule[] = []

  // Folders the user can't query (per-folder access errors, e.g. 403/1100) reject
  // here; their data is skipped while the good folders still load.
  for (const result of settled) {
    if (result.status === 'fulfilled') schedules.push(...result.value)
  }

  return { schedules }
}

export async function loadProcessSchedules(
  sdk: UiPath,
  tenantName: string,
  savedTenantNames: string[] = [],
): Promise<LoadSchedulesResult> {
  // Resolve the tenant from the connection's configured tenants. Dynamic discovery is gone
  // (see loadTenants), so a tenant the user didn't configure can't be resolved.
  const selectedTenant = configuredTenants(sdk.config.tenantName, savedTenantNames)
    .find((tenant) => tenant.name.toLowerCase() === tenantName.toLowerCase())

  if (!selectedTenant || !isTenantNameAllowed(selectedTenant.name)) {
    throw new Error(
      `Tenant "${tenantName}" is not available. Add it to the saved connection.`,
    )
  }

  const folders = await fetchAllPages<Folder>(
    sdk,
    selectedTenant.name,
    'Folders?$select=Id,Key,DisplayName,FullyQualifiedName&$orderby=FullyQualifiedName&$top=1000',
  ).catch((err) => {
    // A 404 on the tenant-root Folders call means the tenant doesn't exist / isn't reachable —
    // Orchestrator returns "Service: orchestrator not found ... Tenant: X". Surface a clear
    // connection error instead of that raw platform string.
    if (err instanceof ODataFetchError && err.status === 404) {
      throw new Error(
        `Tenant "${selectedTenant.name}" was not found or is not accessible. Verify the tenant name in the connection.`,
      )
    }
    throw err
  })

  const { schedules } = await loadProcessSchedulesPerFolder(sdk, selectedTenant.name, folders)
  return { folders, schedules, tenant: selectedTenant }
}
