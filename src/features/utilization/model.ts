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

export interface RuntimeTypeRow {
  type: string | null
  label: string
  counted: boolean
  // Largest single-folder total for this type, as for the headline capacity.
  runtimes: number
  hours: number
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
  robots: UtilizationRow[]
  folders: UtilizationRow[]
  runtimeTypes: RuntimeTypeRow[]
}

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
  folderRuntimes,
  usage,
  excludedFolderIds,
  sinceDays,
  robotNames,
  folderNames,
}: UtilizationInput): UtilizationModel {
  const folderName = (id: number) => folderNames.get(id) ?? `Folder ${id}`

  // Capacity: per folder, add up the counted runtime types; take the largest folder. Adding the
  // folders together would count a machine shared by several folders once per folder.
  const countedRuntimesByFolder = new Map<number, number>()
  const runtimesByTypeFolder = new Map<string, Map<number, number>>()
  for (const entry of folderRuntimes) {
    if (excludedFolderIds.has(entry.folderId)) continue
    if (isCountedRuntimeType(entry.runtimeType)) add(countedRuntimesByFolder, entry.folderId, entry.total)
    const byFolder = runtimesByTypeFolder.get(entry.runtimeType) ?? new Map<number, number>()
    add(byFolder, entry.folderId, entry.total)
    runtimesByTypeFolder.set(entry.runtimeType, byFolder)
  }
  let capacityRuntimes: number | null = null
  let capacityFolderId: number | null = null
  for (const [folderId, total] of countedRuntimesByFolder) {
    if (total > 0 && (capacityRuntimes == null || total > capacityRuntimes)) {
      capacityRuntimes = total
      capacityFolderId = folderId
    }
  }

  // Consumed: job time on counted runtime types, outside excluded folders.
  let consumedSec = 0
  let excludedSec = 0
  const byRobot = new Map<number, number>()
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
    add(byFolder, entry.folderId, entry.sec)
    if (entry.robotId != null) add(byRobot, entry.robotId, entry.sec)
  }

  const source: CapacitySource = capacityRuntimes != null ? 'runtimes' : null
  const capacityHours = capacityRuntimes != null ? capacityRuntimes * HOURS_PER_DAY * sinceDays : null
  const consumedHours = consumedSec / 3600
  const utilizationPct = capacityHours ? (consumedHours / capacityHours) * 100 : null

  const types = new Set<string | null>([...secByType.keys(), ...runtimesByTypeFolder.keys()])
  const runtimeTypes: RuntimeTypeRow[] = [...types]
    .map((type) => ({
      type,
      label: runtimeTypeLabel(type),
      counted: isCountedRuntimeType(type),
      runtimes: type != null ? Math.max(0, ...(runtimesByTypeFolder.get(type)?.values() ?? [])) : 0,
      hours: (secByType.get(type) ?? 0) / 3600,
    }))
    .filter((row) => row.runtimes > 0 || row.hours > 0)
    .sort(
      (a, b) =>
        Number(b.counted) - Number(a.counted) || b.hours - a.hours || b.runtimes - a.runtimes || a.label.localeCompare(b.label),
    )

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
    // Only robots with counted time: a robot known only from personal, development or agentic
    // jobs isn't part of the fleet being measured.
    robots: toRows(byRobot, consumedSec, (id) => robotNames.get(id) ?? `Robot ${id}`),
    // Folders are a share of consumed hours only; per-folder capacity would double-count shared
    // machines.
    folders: toRows(byFolder, consumedSec, folderName),
    runtimeTypes,
  }
}

// Meter and headline tone: under 50% teal, 50-85% orange, above 85% red.
export type UtilizationTone = 'low' | 'medium' | 'high'

export const utilizationTone = (pct: number): UtilizationTone =>
  pct > 85 ? 'high' : pct >= 50 ? 'medium' : 'low'
