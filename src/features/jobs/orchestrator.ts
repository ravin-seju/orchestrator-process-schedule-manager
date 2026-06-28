import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchAllPages, settledBatch } from '@/features/orchestrator/odataClient'
import type { RuntimeStats } from '@/features/schedules/types'

interface RawJob {
  StartTime?: string | null
  EndTime?: string | null
  StartingScheduleId?: number | null
  State?: string | null
  Robot?: { Id?: number | null; Name?: string | null } | null
  Release?: { Id?: number | null } | null
  HostMachineName?: string | null
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
}

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
    `Jobs?$select=StartTime,EndTime,StartingScheduleId,State,HostMachineName&$expand=Robot($select=Id,Name),Release($select=Id)&$filter=(${EXECUTED_STATES}) and CreationTime gt ${sinceIso}&$top=200`
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
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
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
      // Duration stats use ONLY successful jobs (faulted/stopped runs would skew median/p90).
      if (job.State !== 'Successful') continue
      const start = toEpoch(job.StartTime)
      const end = toEpoch(job.EndTime)
      if (start == null || end == null) continue
      const durationSec = (end - start) / 1000
      if (durationSec <= 0) continue
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

  return { rows, robotNames, machineNames, scheduleMachineIds, releaseMachineIds }
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
