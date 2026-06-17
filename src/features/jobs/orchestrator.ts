import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchAllPages, settledBatch } from '@/features/orchestrator/odataClient'
import type { RuntimeStats } from '@/features/schedules/types'

interface RawJob {
  StartTime?: string | null
  EndTime?: string | null
  StartingScheduleId?: number | null
}

interface DurationRow {
  scheduleId: number | null
  durationSec: number
}

const toEpoch = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return isNaN(ms) ? null : ms
}

async function fetchAllJobs(sdk: UiPath, tenantName: string, folderId: number, sinceIso: string): Promise<RawJob[]> {
  const path =
    `Jobs?$select=StartTime,EndTime,StartingScheduleId&$filter=State eq 'Successful' and CreationTime gt ${sinceIso}&$top=200`
  return fetchAllPages<RawJob>(sdk, tenantName, path, folderId)
}

export async function loadJobHistory(
  sdk: UiPath,
  tenantName: string,
  folderIds: number[],
  sinceDays = 60,
): Promise<DurationRow[]> {
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
  const sinceIso = sinceDate.toISOString()

  const settled = await settledBatch(
    folderIds,
    10,
    (folderId) => fetchAllJobs(sdk, tenantName, folderId, sinceIso),
  )

  const rows: DurationRow[] = []
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const job of result.value) {
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

  return rows
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
