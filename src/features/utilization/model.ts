import type { RobotUsage } from '@/features/jobs/orchestrator'

// Where the capacity number comes from. 'licensed' = Orchestrator's licensed unattended
// robot count; 'configured' = the sum of machine unattended slots, an estimate used when the
// license can't be read; null = neither is known, so only consumed hours can be shown.
export type CapacitySource = 'licensed' | 'configured' | null

export interface UtilizationRow {
  id: number
  name: string
  hours: number
  sharePct: number
}

export interface UtilizationModel {
  source: CapacitySource
  robotCount: number | null
  capacityHours: number | null
  consumedHours: number
  idleHours: number | null
  // Raw ratio; it can pass 100 when the capacity is the configured-slot estimate.
  utilizationPct: number | null
  // Clamped to 0-100 for the meter and the headline tile.
  displayPct: number | null
  robots: UtilizationRow[]
  folders: UtilizationRow[]
}

export interface UtilizationInput {
  allowedUnattended: number | null
  totalUnattendedSlots: number | null
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

const positive = (value: number | null) => (value != null && value > 0 ? value : null)

export function buildUtilizationModel({
  allowedUnattended,
  totalUnattendedSlots,
  usage,
  sinceDays,
  robotNames,
  folderNames,
}: UtilizationInput): UtilizationModel {
  const licensed = positive(allowedUnattended)
  const configured = positive(totalUnattendedSlots)
  const source: CapacitySource = licensed != null ? 'licensed' : configured != null ? 'configured' : null
  const robotCount = licensed ?? configured
  const capacityHours = robotCount != null ? robotCount * HOURS_PER_DAY * sinceDays : null
  const consumedHours = usage.totalSec / 3600
  const utilizationPct = capacityHours ? (consumedHours / capacityHours) * 100 : null

  // A robot that ran nothing in the window still belongs in the table, at 0 h.
  const robotSeconds = new Map(usage.byRobot)
  for (const id of robotNames.keys()) {
    if (!robotSeconds.has(id)) robotSeconds.set(id, 0)
  }

  return {
    source,
    robotCount,
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
