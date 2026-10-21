import {
  forEachLocalHour,
  localDayKey,
  localWeekday,
  WAIT_BUCKET_LIMITS_SEC,
  type UsageEntry,
  type UsageWindow,
} from '@/features/jobs/orchestrator'
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

// One weekday and hour of the week, Monday = weekday 0, averaged over the times it occurs in the
// window.
export interface WeekSlot {
  weekday: number
  hour: number
  avgBusy: number
  pctOfCapacity: number | null
}

export interface DayBucket {
  // Local calendar day, YYYY-MM-DD.
  day: string
  hours: number
  // Average runtimes busy over the part of the day inside the window.
  avgBusy: number
  pctOfCapacity: number | null
  // The whole day is inside the window; the first and last days are usually partial.
  full: boolean
}

export interface WaitSummary {
  jobCount: number
  avgWaitMin: number
  // Share of jobs that waited more than 5 minutes between creation and start.
  over5MinPct: number
  // Job counts per wait band (see WAIT_BUCKET_LIMITS_SEC).
  bands: number[]
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
  // 168 slots, Monday 00:00 first; empty when the job history window is unknown.
  week: WeekSlot[]
  quietestSlot: WeekSlot | null
  // Every local day in the window, oldest first; empty when the window is unknown.
  daily: DayBucket[]
  lowestDay: DayBucket | null
  wait: WaitSummary | null
  failedHours: number
  failedPct: number
  // Set when one robot account carries at least CONCENTRATION_WARNING_PCT of consumed hours.
  concentration: { name: string; sharePct: number } | null
  // Most counted runs overlapping at one moment in the window, and when that first happened. Each run
  // holds one runtime, so this many runtimes were in use at once. Null without job history.
  peakConcurrency: { runtimes: number; atMs: number } | null
}

export const CONCENTRATION_WARNING_PCT = 50

export interface UtilizationInput {
  folderRuntimes: FolderRuntimeEntry[]
  usage: UsageEntry[]
  // Personal workspace folders: their robots are people's own, not the shared fleet.
  excludedFolderIds: ReadonlySet<number>
  sinceDays: number
  // The span the job history covers; the weekly and daily charts average over it.
  usageWindow: UsageWindow | null
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
  usageWindow,
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
  const waitBands = new Array<number>(WAIT_BUCKET_LIMITS_SEC.length + 1).fill(0)
  const byWeekdayHour = new Array<number>(7 * HOURS_PER_DAY).fill(0)
  const byDay = new Map<string, number>()
  const intervals: number[][] = []
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
    entry.waitBuckets.forEach((count, band) => (waitBands[band] += count))
    entry.byWeekdayHour.forEach((sec, slot) => (byWeekdayHour[slot] += sec))
    for (const [day, sec] of Object.entries(entry.byDay)) add(byDay, day, sec)
    intervals.push(entry.intervals)
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

  const pctOfCapacity = (avgBusy: number) => (capacityRuntimes ? (avgBusy / capacityRuntimes) * 100 : null)

  // Hour of day: busy seconds in that hour over the window / (days x 3600) = average runtimes busy.
  const hourly: HourBucket[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    let sec = 0
    for (let weekday = 0; weekday < 7; weekday++) sec += byWeekdayHour[weekday * HOURS_PER_DAY + hour]
    const avgBusy = sinceDays > 0 ? sec / (sinceDays * 3600) : 0
    return { hour, avgBusy, pctOfCapacity: pctOfCapacity(avgBusy) }
  })
  const peakHour = consumedSec > 0 ? hourly.reduce((peak, bucket) => (bucket.avgBusy > peak.avgBusy ? bucket : peak)) : null

  // Week and day averages divide by how much of each slot and day the window covers, so the
  // partial first and last days, and a weekday that occurs four times rather than five, aren't
  // understated.
  const slotCoverSec = new Array<number>(7 * HOURS_PER_DAY).fill(0)
  const dayCoverSec = new Map<string, number>()
  if (usageWindow) {
    forEachLocalHour(usageWindow.startMs, usageWindow.endMs, (date, sec) => {
      slotCoverSec[localWeekday(date) * HOURS_PER_DAY + date.getHours()] += sec
      add(dayCoverSec, localDayKey(date), sec)
    })
  }
  const week: WeekSlot[] = usageWindow
    ? byWeekdayHour.map((sec, slot) => {
        const avgBusy = slotCoverSec[slot] > 0 ? sec / slotCoverSec[slot] : 0
        return { weekday: Math.floor(slot / HOURS_PER_DAY), hour: slot % HOURS_PER_DAY, avgBusy, pctOfCapacity: pctOfCapacity(avgBusy) }
      })
    : []
  const quietestSlot =
    consumedSec > 0 && week.length > 0
      ? week.filter((_, slot) => slotCoverSec[slot] > 0).reduce((low, slot) => (slot.avgBusy < low.avgBusy ? slot : low))
      : null
  const daily: DayBucket[] = [...dayCoverSec.entries()].map(([day, coverSec]) => {
    const [year, month, date] = day.split('-').map(Number)
    const fullSec = (new Date(year, month - 1, date + 1).getTime() - new Date(year, month - 1, date).getTime()) / 1000
    const sec = byDay.get(day) ?? 0
    const avgBusy = sec / coverSec
    return { day, hours: sec / 3600, avgBusy, pctOfCapacity: pctOfCapacity(avgBusy), full: coverSec >= fullSec }
  })
  const fullDays = daily.filter((day) => day.full)
  const lowestDay =
    consumedSec > 0 && fullDays.length > 0 ? fullDays.reduce((low, day) => (day.avgBusy < low.avgBusy ? day : low)) : null

  const top = robots[0]

  // Sweep the run starts and ends in time order. At the same second an end comes before a start, so
  // a run that begins as another finishes isn't counted as overlapping it.
  const events: [number, number][] = []
  for (const list of intervals) {
    for (let i = 0; i + 1 < list.length; i += 2) events.push([list[i], 1], [list[i + 1], -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let running = 0
  let peak: { runtimes: number; atSec: number } | null = null
  for (const [sec, delta] of events) {
    running += delta
    if (running > (peak?.runtimes ?? 0)) peak = { runtimes: running, atSec: sec }
  }

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
    week,
    quietestSlot,
    daily,
    lowestDay,
    wait:
      waitCount > 0
        ? {
            jobCount: waitCount,
            avgWaitMin: waitSec / waitCount / 60,
            // Bands 2 onward are 5 minutes or more (see WAIT_BUCKET_LIMITS_SEC).
            over5MinPct: (waitBands.slice(2).reduce((sum, count) => sum + count, 0) / waitCount) * 100,
            bands: waitBands,
          }
        : null,
    failedHours: failedSec / 3600,
    failedPct: share(failedSec),
    concentration:
      top && top.sharePct >= CONCENTRATION_WARNING_PCT && windowSec > 0 ? { name: top.name, sharePct: top.sharePct } : null,
    peakConcurrency:
      peak && usageWindow ? { runtimes: peak.runtimes, atMs: usageWindow.startMs + peak.atSec * 1000 } : null,
  }
}

// Meter and headline tone. Higher is better: under 50% (schedules need work), 50-85%, above 85%.
export type UtilizationTone = 'low' | 'medium' | 'high'

export const utilizationTone = (pct: number): UtilizationTone =>
  pct > 85 ? 'high' : pct >= 50 ? 'medium' : 'low'
