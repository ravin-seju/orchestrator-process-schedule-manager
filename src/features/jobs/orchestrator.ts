import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchAllPages, settledBatch } from '@/features/orchestrator/odataClient'
import type { RuntimeStats } from '@/features/schedules/types'

interface RawJob {
  CreationTime?: string | null
  StartTime?: string | null
  EndTime?: string | null
  StartingScheduleId?: number | null
  State?: string | null
  Robot?: { Id?: number | null; Name?: string | null } | null
  Release?: { Id?: number | null } | null
  HostMachineName?: string | null
  RuntimeType?: string | null
}

interface DurationRow {
  scheduleId: number | null
  durationSec: number
}

export interface JobHistoryResult {
  rows: DurationRow[]
  // RobotId → canonical Robot.Name (e.g. "automationbot@example.com-unattended").
  // Sourced here because /Robots is 403 on some tenants but Jobs $expand=Robot is authorized.
  robotNames: Map<number, string>
  // MachineKey → host machine name (e.g. "PRD-HOST-01"). The actual runtime machine.
  // The Job.Machine nav entity returns null on some tenants, so we use the scalar
  // HostMachineName and derive a stable numeric key (hash) since it has no numeric id.
  machineNames: Map<number, string>
  // ScheduleId → distinct machine keys the schedule's jobs actually ran on. On
  // dynamic-allocation tenants the machine is resolved at runtime and only appears in Jobs.
  scheduleMachineIds: Map<number, number[]>
  // ReleaseId → machine keys from MANUAL runs (no StartingScheduleId). Used as a
  // fallback so manual-only schedules still show a (process-level) machine.
  releaseMachineIds: Map<number, number[]>
  // Robot-busy seconds over the window for the Utilization view, one entry per folder, runtime
  // type and robot. Covers every executed job (Successful, Faulted, Stopped): a faulted or stopped
  // run still held its robot. Which types and folders count is decided by the model, not here.
  usage: UsageEntry[]
  // The span of job creation times the history covers, so averages can divide by the hours and
  // days actually in the window.
  window: UsageWindow
}

export interface UsageWindow {
  startMs: number
  endMs: number
}

export interface UsageEntry {
  folderId: number
  runtimeType: string | null
  robotId: number | null
  sec: number
  // Part of sec spent on runs that ended Faulted or Stopped.
  failedSec: number
  // sec split by local weekday and hour: index = weekday * 24 + hour, Monday = weekday 0.
  byWeekdayHour: number[]
  // sec split by local calendar day, keyed YYYY-MM-DD.
  byDay: Record<string, number>
  // Time from job creation to start: how long jobs waited for a robot. Counted per job in the
  // bands of WAIT_BUCKET_LIMITS_SEC, plus a running total for the average.
  waitSec: number
  waitCount: number
  waitBuckets: number[]
}

// Upper bounds of the wait-time bands: under 1 min, 1-5 min, 5-15 min, 15-60 min, then over 60 min.
export const WAIT_BUCKET_LIMITS_SEC = [60, 300, 900, 3600] as const

const waitBucket = (waitSec: number) => {
  const index = WAIT_BUCKET_LIMITS_SEC.findIndex((limit) => waitSec < limit)
  return index === -1 ? WAIT_BUCKET_LIMITS_SEC.length : index
}

// Monday = 0 ... Sunday = 6, in local time.
export const localWeekday = (date: Date) => (date.getDay() + 6) % 7

export const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// Walks [startMs, endMs) one local clock hour at a time, so a job from 01:30 to 03:15 gives
// 30 min to hour 1, 60 min to hour 2 and 15 min to hour 3, each on the right weekday and day.
export const forEachLocalHour = (startMs: number, endMs: number, visit: (date: Date, sec: number) => void) => {
  let t = startMs
  while (t < endMs) {
    const d = new Date(t)
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
    const segmentEnd = Math.min(endMs, nextHour)
    visit(d, (segmentEnd - t) / 1000)
    t = segmentEnd
  }
}

const addByTime = (entry: UsageEntry, startMs: number, endMs: number) =>
  forEachLocalHour(startMs, endMs, (date, sec) => {
    entry.byWeekdayHour[localWeekday(date) * 24 + date.getHours()] += sec
    const day = localDayKey(date)
    entry.byDay[day] = (entry.byDay[day] ?? 0) + sec
  })

// Jobs whose machine association is meaningful — the job actually executed on a host.
// Excludes never-ran states (Pending/Running/Cancelled/etc.) to avoid phantom machines.
const EXECUTED_STATES = "State eq 'Successful' or State eq 'Faulted' or State eq 'Stopped'"

// djb2 string hash → stable non-negative int. HostMachineName has no numeric id, so we
// hash the normalized name to a key that survives reloads (cache + selection consistency).
// Same hashing family the app uses for folder colors.
const hashMachineName = (name: string): number => {
  let hash = 5381
  const s = name.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0
  }
  return hash >>> 0
}

const toEpoch = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return isNaN(ms) ? null : ms
}

async function fetchAllJobs(sdk: UiPath, tenantName: string, folderId: number, sinceIso: string): Promise<RawJob[]> {
  const path =
    `Jobs?$select=CreationTime,StartTime,EndTime,StartingScheduleId,State,HostMachineName,RuntimeType&$expand=Robot($select=Id,Name),Release($select=Id)&$filter=(${EXECUTED_STATES}) and CreationTime gt ${sinceIso}&$top=200`
  return fetchAllPages<RawJob>(sdk, tenantName, path, folderId)
}

export async function loadJobHistory(
  sdk: UiPath,
  tenantName: string,
  folderIds: number[],
  sinceDays = 60,
): Promise<JobHistoryResult> {
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
  const sinceIso = sinceDate.toISOString()

  const settled = await settledBatch(
    folderIds,
    10,
    (folderId) => fetchAllJobs(sdk, tenantName, folderId, sinceIso),
  )

  const rows: DurationRow[] = []
  const robotNames = new Map<number, string>()
  const machineNames = new Map<number, string>()
  const scheduleMachineSets = new Map<number, Set<number>>()
  const releaseMachineSets = new Map<number, Set<number>>()
  const usageByKey = new Map<string, UsageEntry>()
  // settledBatch keeps input order, so settled[i] holds folderIds[i]'s jobs.
  for (const [index, result] of settled.entries()) {
    if (result.status !== 'fulfilled') continue
    const folderId = folderIds[index]
    for (const job of result.value) {
      if (job.Robot?.Id != null && job.Robot.Name) {
        robotNames.set(job.Robot.Id, job.Robot.Name)
      }
      const host = job.HostMachineName?.trim()
      const machineKey = host ? hashMachineName(host) : null
      if (host && machineKey != null) {
        machineNames.set(machineKey, host)
      }
      // Associate the machine with the schedule its jobs ran on (scheduled runs);
      // for manual runs (no StartingScheduleId) associate by Release as a fallback.
      if (machineKey != null) {
        if (job.StartingScheduleId != null) {
          const set = scheduleMachineSets.get(job.StartingScheduleId) ?? new Set<number>()
          set.add(machineKey)
          scheduleMachineSets.set(job.StartingScheduleId, set)
        } else if (job.Release?.Id != null) {
          const set = releaseMachineSets.get(job.Release.Id) ?? new Set<number>()
          set.add(machineKey)
          releaseMachineSets.set(job.Release.Id, set)
        }
      }
      const start = toEpoch(job.StartTime)
      const end = toEpoch(job.EndTime)
      if (start == null || end == null) continue
      const durationSec = (end - start) / 1000
      if (durationSec <= 0) continue
      if (folderId != null) {
        const runtimeType = job.RuntimeType ?? null
        const robotId = job.Robot?.Id ?? null
        const key = `${folderId}|${runtimeType}|${robotId}`
        let entry = usageByKey.get(key)
        if (!entry) {
          entry = {
            folderId,
            runtimeType,
            robotId,
            sec: 0,
            failedSec: 0,
            byWeekdayHour: new Array<number>(7 * 24).fill(0),
            byDay: {},
            waitSec: 0,
            waitCount: 0,
            waitBuckets: new Array<number>(WAIT_BUCKET_LIMITS_SEC.length + 1).fill(0),
          }
          usageByKey.set(key, entry)
        }
        entry.sec += durationSec
        if (job.State !== 'Successful') entry.failedSec += durationSec
        addByTime(entry, start, end)
        const created = toEpoch(job.CreationTime)
        if (created != null && start >= created) {
          const waitSec = (start - created) / 1000
          entry.waitSec += waitSec
          entry.waitCount += 1
          entry.waitBuckets[waitBucket(waitSec)] += 1
        }
      }
      // Duration stats use ONLY successful jobs (faulted/stopped runs would skew median/p90).
      if (job.State !== 'Successful') continue
      rows.push({
        scheduleId: job.StartingScheduleId ?? null,
        durationSec,
      })
    }
  }

  const scheduleMachineIds = new Map<number, number[]>()
  for (const [scheduleId, set] of scheduleMachineSets) {
    scheduleMachineIds.set(scheduleId, [...set])
  }
  const releaseMachineIds = new Map<number, number[]>()
  for (const [releaseId, set] of releaseMachineSets) {
    releaseMachineIds.set(releaseId, [...set])
  }

  return {
    rows,
    robotNames,
    machineNames,
    scheduleMachineIds,
    releaseMachineIds,
    usage: [...usageByKey.values()],
    window: { startMs: sinceDate.getTime(), endMs: Date.now() },
  }
}

export function aggregateRuntimes(rows: DurationRow[]): Map<number, RuntimeStats> {
  const bySchedule = new Map<number, number[]>()
  for (const row of rows) {
    if (row.scheduleId == null) continue
    const list = bySchedule.get(row.scheduleId) ?? []
    list.push(row.durationSec)
    bySchedule.set(row.scheduleId, list)
  }

  const result = new Map<number, RuntimeStats>()
  for (const [scheduleId, durations] of bySchedule) {
    const sorted = [...durations].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median =
      sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0)
    const p90Index = Math.min(Math.ceil(sorted.length * 0.9) - 1, sorted.length - 1)
    const p90 = sorted[p90Index] ?? median
    result.set(scheduleId, { medianSec: median, p90Sec: p90, sampleSize: sorted.length })
  }

  return result
}
