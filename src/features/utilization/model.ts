import type { RobotUsage } from '@/features/jobs/orchestrator'

// Where the capacity number comes from. 'runtimes' = deployed Unattended/Serverless runtimes,
// a lower bound (largest single-folder total, see loadFolderRuntimes); null = unknown, so only
// consumed hours can be shown. Licensed counts are out of reach: those endpoints answer 403.
export type CapacitySource = 'runtimes' | null

export interface UtilizationRow {
  id: number
  name: string
  hours: number
  sharePct: number
}

export interface UtilizationModel {
  source: CapacitySource
  capacityRuntimes: number | null
  capacityHours: number | null
  consumedHours: number
  idleHours: number | null
  // Raw ratio; it can pass 100 because the capacity is a lower bound.
  utilizationPct: number | null
  // Clamped to 0-100 for the meter and the headline tile.
  displayPct: number | null
  robots: UtilizationRow[]
  folders: UtilizationRow[]
}

export interface UtilizationInput {
  capacityRuntimes: number | null
  usage: RobotUsage
  sinceDays: number
  robotNames: Map<number, string>
  folderNames: Map<number, string>
}

const HOURS_PER_DAY = 24

const toRows = (
  secondsById: Map<number, number>,
  totalSec: number,
  nameFor: (id: number) => string,
): UtilizationRow[] =>
  [...secondsById.entries()]
    .map(([id, sec]) => ({
      id,
      name: nameFor(id),
      hours: sec / 3600,
      sharePct: totalSec > 0 ? (sec / totalSec) * 100 : 0,
    }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))

export function buildUtilizationModel({
  capacityRuntimes,
  usage,
  sinceDays,
  robotNames,
  folderNames,
}: UtilizationInput): UtilizationModel {
  const runtimes = capacityRuntimes != null && capacityRuntimes > 0 ? capacityRuntimes : null
  const source: CapacitySource = runtimes != null ? 'runtimes' : null
  const capacityHours = runtimes != null ? runtimes * HOURS_PER_DAY * sinceDays : null
  const consumedHours = usage.totalSec / 3600
  const utilizationPct = capacityHours ? (consumedHours / capacityHours) * 100 : null

  // A robot that ran nothing in the window still belongs in the table, at 0 h.
  const robotSeconds = new Map(usage.byRobot)
  for (const id of robotNames.keys()) {
    if (!robotSeconds.has(id)) robotSeconds.set(id, 0)
  }

  return {
    source,
    capacityRuntimes: runtimes,
    capacityHours,
    consumedHours,
    idleHours: capacityHours != null ? Math.max(0, capacityHours - consumedHours) : null,
    utilizationPct,
    displayPct: utilizationPct != null ? Math.min(100, Math.max(0, utilizationPct)) : null,
    robots: toRows(robotSeconds, usage.totalSec, (id) => robotNames.get(id) ?? `Robot ${id}`),
    // Folders are shown as a share of consumed hours only. Machines are shared across
    // folders, so a per-folder capacity would count the same robot-hours more than once.
    folders: toRows(usage.byFolder, usage.totalSec, (id) => folderNames.get(id) ?? `Folder ${id}`),
  }
}

// Meter and headline tone: under 50% teal, 50-85% orange, above 85% red.
export type UtilizationTone = 'low' | 'medium' | 'high'

export const utilizationTone = (pct: number): UtilizationTone =>
  pct > 85 ? 'high' : pct >= 50 ? 'medium' : 'low'
