import type { UsageEntry } from '@/features/jobs/orchestrator'
import type { FolderRuntimeEntry } from '@/features/machines/orchestrator'
import { isCountedRuntimeType, runtimeTypeLabel } from '@/features/orchestrator/runtimeTypes'

// Where the capacity number comes from. 'runtimes' = deployed runtimes of the counted types, a
// lower bound (largest single-folder total); null = unknown, so only consumed hours can be shown.
// Licensed counts are out of reach: those endpoints answer 403 for this app's users.
export type CapacitySource = 'runtimes' | null

export interface UtilizationRow {
  id: number
  name: string
  hours: number
  sharePct: number
}

export interface RobotRow extends UtilizationRow {
  // Counted runtime types this robot account ran on, most hours first. One account can run on
  // several (for example Unattended and Cloud Serverless).
  runtimeTypes: { label: string; hours: number }[]
}

export interface RootFolderRow {
  name: string
  hours: number
  sharePct: number
  // Folders with job time or runtimes rolled into this root, the root itself included.
  folderCount: number
  // Most counted runtimes deployed to any one folder in this root (a lower bound, as for capacity).
  runtimes: number
  // Runtimes are deployed here but no counted job ran in the window.
  idle: boolean
}

export interface RuntimeTypeRow {
  type: string | null
  label: string
  counted: boolean
  // Largest single-folder total for this type, as for the headline capacity, and how many of
  // that folder's runtimes had a host connected when they were read.
  runtimes: number
  connected: number
  offline: number
  hours: number
}

// Snapshot from the capacity folder at the time runtimes were read: connected runtimes are busy or
// idle; the rest of the deployed runtimes have no host online.
export interface LiveRuntimeStatus {
  folderName: string
  total: number
  busy: number
  idle: number
  offline: number
}

export interface HourBucket {
  hour: number
  // Average runtimes busy in this hour of the day across the window.
  avgBusy: number
  pctOfCapacity: number | null
}

export interface WaitSummary {
  jobCount: number
  avgWaitMin: number
  // Share of jobs that waited more than 5 minutes between creation and start.
  over5MinPct: number
}

export interface UtilizationModel {
  source: CapacitySource
  capacityRuntimes: number | null
  capacityFolderName: string | null
  capacityHours: number | null
  consumedHours: number
  consumedFolderCount: number
  // Job time in excluded (personal workspace) folders, of any runtime type, left out of everything.
  excludedHours: number
  idleHours: number | null
  // Raw ratio; it can pass 100 because the capacity is a lower bound.
  utilizationPct: number | null
  // Clamped to 0-100 for the meter and the headline tile.
  displayPct: number | null
  robots: RobotRow[]
  rootFolders: RootFolderRow[]
  runtimeTypes: RuntimeTypeRow[]
  live: LiveRuntimeStatus | null
  hourly: HourBucket[]
  peakHour: HourBucket | null
  wait: WaitSummary | null
  failedHours: number
  failedPct: number
  // Set when one robot account carries at least CONCENTRATION_WARNING_PCT of consumed hours.
  concentration: { name: string; sharePct: number } | null
}

export const CONCENTRATION_WARNING_PCT = 50

export interface UtilizationInput {
  folderRuntimes: FolderRuntimeEntry[]
  usage: UsageEntry[]
  // Personal workspace folders: their robots are people's own, not the shared fleet.
  excludedFolderIds: ReadonlySet<number>
  sinceDays: number
  robotNames: Map<number, string>
  folderNames: Map<number, string>
}

const HOURS_PER_DAY = 24

const add = <K>(map: Map<K, number>, key: K, value: number) => map.set(key, (map.get(key) ?? 0) + value)

const byHoursThenName = (a: { hours: number; name: string }, b: { hours: number; name: string }) =>
  b.hours - a.hours || a.name.localeCompare(b.name)

// Root of a folder path, the same rule the app uses for folder colours ("Finance/Onboarding" ->
// "Finance").
const rootFolderName = (fullyQualifiedName: string) => fullyQualifiedName.split('/')[0]

export function buildUtilizationModel({
  folderRuntimes,
  usage,
  excludedFolderIds,
  sinceDays,
  robotNames,
  folderNames,
}: UtilizationInput): UtilizationModel {
  const folderName = (id: number) => folderNames.get(id) ?? `Folder ${id}`
  const windowSec = sinceDays * HOURS_PER_DAY * 3600

  // Capacity: per folder, add up the counted runtime types; take the largest folder. Adding the
  // folders together would count a machine shared by several folders once per folder.
  const countedByFolder = new Map<number, { total: number; connected: number; available: number }>()
  const typeByFolder = new Map<string, Map<number, FolderRuntimeEntry>>()
  for (const entry of folderRuntimes) {
    if (excludedFolderIds.has(entry.folderId)) continue
    if (isCountedRuntimeType(entry.runtimeType)) {
      const sum = countedByFolder.get(entry.folderId) ?? { total: 0, connected: 0, available: 0 }
      sum.total += entry.total
      sum.connected += entry.connected
      sum.available += entry.available
      countedByFolder.set(entry.folderId, sum)
    }
    const folders = typeByFolder.get(entry.runtimeType) ?? new Map<number, FolderRuntimeEntry>()
    folders.set(entry.folderId, entry)
    typeByFolder.set(entry.runtimeType, folders)
  }
  let capacityFolderId: number | null = null
  for (const [folderId, sum] of countedByFolder) {
    if (sum.total > 0 && (capacityFolderId == null || sum.total > countedByFolder.get(capacityFolderId)!.total)) {
      capacityFolderId = folderId
    }
  }
  const capacityFolder = capacityFolderId != null ? countedByFolder.get(capacityFolderId)! : null
  const capacityRuntimes = capacityFolder?.total ?? null

  // Consumed: job time on counted runtime types, outside excluded folders.
  let consumedSec = 0
  let excludedSec = 0
  let failedSec = 0
  let waitSec = 0
  let waitCount = 0
  let waitOver5Min = 0
  const byHour = new Array<number>(24).fill(0)
  const byRobotType = new Map<number, Map<string, number>>()
  const byFolder = new Map<number, number>()
  const secByType = new Map<string | null, number>()
  for (const entry of usage) {
    if (excludedFolderIds.has(entry.folderId)) {
      excludedSec += entry.sec
      continue
    }
    add(secByType, entry.runtimeType, entry.sec)
    if (!isCountedRuntimeType(entry.runtimeType)) continue
    consumedSec += entry.sec
    failedSec += entry.failedSec
    waitSec += entry.waitSec
    waitCount += entry.waitCount
    // Bands 2 onward are 5 minutes or more (see WAIT_BUCKET_LIMITS_SEC).
    waitOver5Min += entry.waitBuckets.slice(2).reduce((sum, count) => sum + count, 0)
    entry.byHour.forEach((sec, hour) => (byHour[hour] += sec))
    add(byFolder, entry.folderId, entry.sec)
    if (entry.robotId != null) {
      const types = byRobotType.get(entry.robotId) ?? new Map<string, number>()
      add(types, entry.runtimeType, entry.sec)
      byRobotType.set(entry.robotId, types)
    }
  }
  const share = (sec: number) => (consumedSec > 0 ? (sec / consumedSec) * 100 : 0)

  // Only robots with counted time: a robot known only from personal, development or agentic jobs
  // isn't part of the fleet being measured.
  const robots: RobotRow[] = [...byRobotType.entries()]
    .map(([id, types]) => {
      const sec = [...types.values()].reduce((sum, value) => sum + value, 0)
      return {
        id,
        name: robotNames.get(id) ?? `Robot ${id}`,
        hours: sec / 3600,
        sharePct: share(sec),
        runtimeTypes: [...types.entries()]
          .map(([type, typeSec]) => ({ label: runtimeTypeLabel(type), hours: typeSec / 3600 }))
          .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label)),
      }
    })
    .sort(byHoursThenName)

  // Folders roll up to their root: hours as a share of consumed, and the most counted runtimes
  // deployed to any one folder in the root. Roots with runtimes but no counted jobs are listed as
  // idle, last.
  const roots = new Map<string, { sec: number; runtimes: number; folders: Set<number> }>()
  const rootOf = (folderId: number) => {
    const name = rootFolderName(folderName(folderId))
    const root = roots.get(name) ?? { sec: 0, runtimes: 0, folders: new Set<number>() }
    roots.set(name, root)
    root.folders.add(folderId)
    return root
  }
  for (const [folderId, sec] of byFolder) rootOf(folderId).sec += sec
  for (const [folderId, sum] of countedByFolder) {
    if (sum.total <= 0) continue
    const root = rootOf(folderId)
    root.runtimes = Math.max(root.runtimes, sum.total)
  }
  const rootFolders: RootFolderRow[] = [...roots.entries()]
    .map(([name, root]) => ({
      name,
      hours: root.sec / 3600,
      sharePct: share(root.sec),
      folderCount: root.folders.size,
      runtimes: root.runtimes,
      idle: root.sec === 0,
    }))
    .sort((a, b) => Number(a.idle) - Number(b.idle) || b.hours - a.hours || b.runtimes - a.runtimes || a.name.localeCompare(b.name))

  const source: CapacitySource = capacityRuntimes != null ? 'runtimes' : null
  const capacityHours = capacityRuntimes != null ? capacityRuntimes * HOURS_PER_DAY * sinceDays : null
  const consumedHours = consumedSec / 3600
  const utilizationPct = capacityHours ? (consumedHours / capacityHours) * 100 : null

  const types = new Set<string | null>([...secByType.keys(), ...typeByFolder.keys()])
  const runtimeTypes: RuntimeTypeRow[] = [...types]
    .map((type) => {
      const largest = type != null
        ? [...(typeByFolder.get(type)?.values() ?? [])].sort((a, b) => b.total - a.total)[0]
        : undefined
      return {
        type,
        label: runtimeTypeLabel(type),
        counted: isCountedRuntimeType(type),
        runtimes: largest?.total ?? 0,
        connected: largest?.connected ?? 0,
        offline: largest ? Math.max(0, largest.total - largest.connected) : 0,
        hours: (secByType.get(type) ?? 0) / 3600,
      }
    })
    .filter((row) => row.runtimes > 0 || row.hours > 0)
    .sort(
      (a, b) =>
        Number(b.counted) - Number(a.counted) || b.hours - a.hours || b.runtimes - a.runtimes || a.label.localeCompare(b.label),
    )

  // Hour of day: busy seconds in that hour over the window / (days x 3600) = average runtimes busy.
  const hourly: HourBucket[] = byHour.map((sec, hour) => {
    const avgBusy = sinceDays > 0 ? sec / (sinceDays * 3600) : 0
    return { hour, avgBusy, pctOfCapacity: capacityRuntimes ? (avgBusy / capacityRuntimes) * 100 : null }
  })
  const peakHour = consumedSec > 0 ? hourly.reduce((peak, bucket) => (bucket.avgBusy > peak.avgBusy ? bucket : peak)) : null

  const top = robots[0]

  return {
    source,
    capacityRuntimes,
    capacityFolderName: capacityFolderId != null ? folderName(capacityFolderId) : null,
    capacityHours,
    consumedHours,
    consumedFolderCount: byFolder.size,
    excludedHours: excludedSec / 3600,
    idleHours: capacityHours != null ? Math.max(0, capacityHours - consumedHours) : null,
    utilizationPct,
    displayPct: utilizationPct != null ? Math.min(100, Math.max(0, utilizationPct)) : null,
    robots,
    rootFolders,
    runtimeTypes,
    live:
      capacityFolder && capacityFolderId != null
        ? {
            folderName: folderName(capacityFolderId),
            total: capacityFolder.total,
            busy: Math.max(0, capacityFolder.connected - capacityFolder.available),
            idle: capacityFolder.available,
            offline: Math.max(0, capacityFolder.total - capacityFolder.connected),
          }
        : null,
    hourly,
    peakHour,
    wait:
      waitCount > 0
        ? { jobCount: waitCount, avgWaitMin: waitSec / waitCount / 60, over5MinPct: (waitOver5Min / waitCount) * 100 }
        : null,
    failedHours: failedSec / 3600,
    failedPct: share(failedSec),
    concentration:
      top && top.sharePct >= CONCENTRATION_WARNING_PCT && windowSec > 0 ? { name: top.name, sharePct: top.sharePct } : null,
  }
}

// Meter and headline tone. Higher is better: under 50% (schedules need work), 50-85%, above 85%.
export type UtilizationTone = 'low' | 'medium' | 'high'

export const utilizationTone = (pct: number): UtilizationTone =>
  pct > 85 ? 'high' : pct >= 50 ? 'medium' : 'low'
