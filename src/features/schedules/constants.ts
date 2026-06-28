import type { Folder, ProcessSchedule, TenantInfo } from './orchestrator'
import type { RecurrenceBucket, TenantOption, ViewMode } from './types'

export const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const emptyFolders: Folder[] = []
export const emptySchedules: ProcessSchedule[] = []
export const emptyTenants: TenantInfo[] = []
export const iconSize = 17
export const defaultMonthSpanLaneLimit = 3
export const minMonthSpanLaneLimit = 3
export const maxMonthSpanLaneLimit = 6
export const monthSpanLaneStepPx = 18
export const monthSpanReservedHeightPx = 44
export const weekVisibleSpanRows = 7
export const maxDensitySegments = 96
export const maxDetailTimeChips = 120
export const maxHighFrequencyDetailTimeChips = 5
export const maxInlineDetailMachines = 4
export const pickerSearchThreshold = 8
export const maxUpcomingItemsPerGroup = 12
export const legacyTimelineModeStorageKey = 'process-calendar.timeline-mode'
export const viewModeStorageKey = 'process-schedule-manager.view-mode'
export const defaultViewMode: ViewMode = 'spanBars'
export const defaultTenantName = 'DefaultTenant'
export const environmentLabel = 'cloud'

export const getEnvironmentDisplayLabel = (source?: string) => {
  const rawValue = String(source || environmentLabel || '').trim()
  const normalized = rawValue.toLowerCase()

  if (!rawValue) return 'Production'
  if (normalized === 'testing') return 'Testing'

  try {
    const hostname = new URL(rawValue).hostname.toLowerCase()
    if (hostname.includes('staging') || hostname.includes('preprod')) return 'Staging'
    if (hostname.includes('alpha')) return 'Alpha'
    if (hostname.endsWith('uipath.com')) return 'Cloud'
  } catch {
    // Fall through to title-case display for non-URL environment labels.
  }

  if (normalized === 'staging' || normalized.includes('staging') || normalized.includes('preprod')) return 'Staging'
  if (normalized === 'alpha' || normalized.includes('alpha')) return 'Alpha'
  if (normalized === 'cloud') return 'Cloud'
  if (normalized === 'production' || normalized === 'prod') return 'Production'

  return rawValue.charAt(0).toUpperCase() + rawValue.slice(1)
}

export const recurrenceBucketLabels: Record<RecurrenceBucket, string> = {
  minute: 'Minute-by-minute',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  queue: 'Queue',
  other: 'One-time/Other',
}

export const recurrenceLegend: RecurrenceBucket[] = ['minute', 'hourly', 'daily', 'weekly', 'monthly', 'queue', 'other']

export const viewModeLabels: Record<ViewMode, string> = {
  spanBars: 'Bars',
  timeBlocks: 'Blocks',
}

export const viewModeDescriptions: Record<ViewMode, string> = {
  spanBars: 'Bars show recurring triggers as continuous bands across the visible days they run.',
  timeBlocks: 'Blocks show compact daily trigger chips inside each day.',
}

export const viewModes: ViewMode[] = ['spanBars', 'timeBlocks']
export const yearMonthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' })

export const fallbackTenant: TenantInfo = {
  name: defaultTenantName,
  displayName: defaultTenantName,
  source: 'configured',
}

export const tenantToOption = (tenant: TenantInfo): TenantOption => ({ ...tenant, kind: 'live' })
