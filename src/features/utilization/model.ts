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
  // Folders with job time rolled into this root, the root itself included.
  folderCount: number
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
  robots: RobotRow[]
  rootFolders: RootFolderRow[]
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

  // Folders roll up to their root, shown as a share of consumed hours only. Capacity isn't split by
  // folder, because a machine shared by several folders would count once per folder.
  const rootTotals = new Map<string, { sec: number; folderCount: number }>()
  for (const [folderId, sec] of byFolder) {
    const root = rootFolderName(folderName(folderId))
    const total = rootTotals.get(root) ?? { sec: 0, folderCount: 0 }
    total.sec += sec
    total.folderCount += 1
    rootTotals.set(root, total)
  }
  const rootFolders: RootFolderRow[] = [...rootTotals.entries()]
    .map(([name, total]) => ({ name, hours: total.sec / 3600, sharePct: share(total.sec), folderCount: total.folderCount }))
    .sort(byHoursThenName)

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
    robots,
    rootFolders,
    runtimeTypes,
  }
}

// Meter and headline tone: under 50% teal, 50-85% orange, above 85% red.
export type UtilizationTone = 'low' | 'medium' | 'high'

export const utilizationTone = (pct: number): UtilizationTone =>
  pct > 85 ? 'high' : pct >= 50 ? 'medium' : 'low'
