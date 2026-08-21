import {
  countScheduleRunsInRange,
} from './calendarDisplay'
import { defaultLifecycleHorizonDays, lifecycleHorizonLabel } from './constants'
import type { ProcessSchedule } from './orchestrator'
import { getAssignedMachineIds, getAssignedRobotIds, getCachedScheduleOccurrences, getLifecycleStatus, isLifecycleAttention, isQueueTrigger, isStaleSchedule } from './scheduleUtils'
import type { StatusFilter } from './types'

export type SummaryMetricKey =
  | 'triggers'
  | 'enabled'
  | 'activeToday'
  | 'suppressedToday'
  | 'folders'
  | 'machines'
  | 'robots'
  | 'duplicateSchedules'
  | 'stale'
  | 'collisions'
  | 'expiring'

export type SummaryMetricData = {
  description: string
  key: SummaryMetricKey
  label: string
  tone: string
  value: number
}

const metricTones: Record<SummaryMetricKey, string> = {
  activeToday: 'var(--metric-runs)',
  collisions: 'var(--danger)',
  duplicateSchedules: 'var(--metric-high-frequency)',
  enabled: 'var(--metric-enabled)',
  expiring: 'var(--metric-expiring)',
  folders: 'var(--metric-folders)',
  machines: 'var(--metric-machines)',
  robots: 'var(--metric-robots)',
  stale: 'var(--metric-suppressed)',
  suppressedToday: 'var(--metric-suppressed)',
  triggers: 'var(--metric-triggers)',
}

const metricDescriptions: Record<SummaryMetricKey, string> = {
  activeToday: 'Unique visible triggers with at least one scheduled run today.',
  collisions: 'Enabled triggers scheduled to fire at the exact same minute as another trigger over the next 7 days.',
  duplicateSchedules: 'Processes with more than one trigger configured in the same folder. These may need review.',
  enabled: 'Visible triggers that are currently enabled.',
  // Placeholder only — the live copy comes from expiringDescription(), which names the selected
  // horizon so the tooltip and the header toggle can never disagree.
  expiring: 'Triggers with a scheduled stop date that has already passed or falls within the selected window.',
  folders: 'Folders represented by the visible triggers.',
  machines: 'Distinct machines that have run the visible triggers.',
  robots: 'Distinct robots assigned to the visible triggers.',
  stale: 'Enabled triggers with no upcoming run in the next 30 days — likely a broken cron or an expired one-shot schedule.',
  suppressedToday: 'Scheduled runs today that are suppressed because the visible triggers are disabled.',
  triggers: 'Visible triggers after the current filters.',
}

export const countUniqueFolders = (schedules: ProcessSchedule[]) =>
  new Set(schedules.map((schedule) => schedule.folderId)).size

const countMachines = (schedules: ProcessSchedule[], scheduleMachineIds: Map<number, number[]>): number => {
  const ids = new Set<number>()
  for (const schedule of schedules) {
    for (const id of scheduleMachineIds.get(schedule.Id) ?? []) ids.add(id)
  }
  return ids.size
}

const countRobots = (schedules: ProcessSchedule[]): number => {
  const ids = new Set<number>()
  for (const schedule of schedules) {
    for (const id of getAssignedRobotIds(schedule)) ids.add(id)
  }
  return ids.size
}

const countActiveToday = (schedules: ProcessSchedule[], todayStart: Date, todayEnd: Date) =>
  schedules.filter(
    (schedule) => getCachedScheduleOccurrences(schedule, todayStart, todayEnd).length > 0,
  ).length

const countDuplicateSchedules = (schedules: ProcessSchedule[]): number => {
  const counts = new Map<string, number>()
  for (const s of schedules) {
    const key = `${s.folderId}-${String(s.ReleaseId ?? s.PackageName ?? s.Name)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.values()).filter((n) => n > 1).length
}

const countStale = (schedules: ProcessSchedule[]): number => {
  const now = Date.now()
  let count = 0
  for (const s of schedules) {
    if (isStaleSchedule(s, now)) count += 1
  }
  return count
}

// Reads the selected horizon rather than a constant, so the tooltip always matches the toggle.
export const expiringDescription = (horizonDays: number) =>
  `Triggers with a scheduled stop date that has already passed or falls within the next ${lifecycleHorizonLabel(horizonDays)}.`

const countExpiring = (schedules: ProcessSchedule[], horizonDays: number): number => {
  const now = Date.now()
  let count = 0
  for (const s of schedules) {
    if (isLifecycleAttention(getLifecycleStatus(s, now, horizonDays))) count += 1
  }
  return count
}

const countCollisions = (
  schedules: ProcessSchedule[],
  windowStart: Date,
  windowEnd: Date,
  machineScope?: Set<number>,
  robotScope?: Set<number>,
  scheduleMachineIds?: Map<number, number[]>,
): number => {
  const scopedMachine = machineScope != null && machineScope.size > 0
  const scopedRobot = robotScope != null && robotScope.size > 0
  const scoped = scopedMachine || scopedRobot
  // Machine identity from job history (actual runtime machine) when provided,
  // else the schedule's configured MachineRobots.
  const machineIdsOf = (s: ProcessSchedule): number[] =>
    scheduleMachineIds ? (scheduleMachineIds.get(s.Id) ?? []) : getAssignedMachineIds(s)
  const slots = new Map<string, Set<ProcessSchedule>>()
  for (const schedule of schedules) {
    if (!schedule.Enabled) continue
    if (isQueueTrigger(schedule)) continue

    // Under an active machine/robot filter, partition collisions per resource:
    // a schedule only collides with others sharing the same machine OR robot.
    const scopeKeys = scoped
      ? [
          ...(scopedMachine
            ? machineIdsOf(schedule).filter((id) => machineScope!.has(id)).map((id) => `m${id}`)
            : []),
          ...(scopedRobot
            ? getAssignedRobotIds(schedule).filter((id) => robotScope!.has(id)).map((id) => `r${id}`)
            : []),
        ]
      : null
    if (scoped && scopeKeys!.length === 0) continue

    const occurrences = getCachedScheduleOccurrences(schedule, windowStart, windowEnd)
    for (const occ of occurrences) {
      const d = occ.date
      const tsKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`
      if (scoped) {
        for (const scopeKey of scopeKeys!) {
          const key = `${scopeKey}-${tsKey}`
          const set = slots.get(key) ?? new Set<ProcessSchedule>()
          set.add(schedule)
          slots.set(key, set)
        }
      } else {
        const set = slots.get(tsKey) ?? new Set<ProcessSchedule>()
        set.add(schedule)
        slots.set(tsKey, set)
      }
    }
  }
  const colliding = new Set<ProcessSchedule>()
  for (const set of slots.values()) {
    if (set.size <= 1) continue
    for (const s of set) colliding.add(s)
  }
  return colliding.size
}

const COLLISION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function buildSummaryMetricData({
  horizonDays = defaultLifecycleHorizonDays,
  schedules,
  scheduleMachineIds,
  collisionMachineIds,
  selectedMachineIds,
  selectedRobotIds,
  statusFilter,
  todayEnd,
  todayStart,
}: {
  horizonDays?: number
  schedules: ProcessSchedule[]
  scheduleMachineIds?: Map<number, number[]>
  collisionMachineIds?: Map<number, number[]>
  selectedMachineIds?: number[]
  selectedRobotIds?: number[]
  statusFilter: StatusFilter
  todayEnd: Date
  todayStart: Date
}): SummaryMetricData[] {
  const machineScope = selectedMachineIds?.length ? new Set(selectedMachineIds) : undefined
  const robotScope = selectedRobotIds?.length ? new Set(selectedRobotIds) : undefined
  const enabledSchedules = schedules.filter((schedule) => schedule.Enabled)
  const disabledSchedules = schedules.filter((schedule) => !schedule.Enabled)
  const folderCount = countUniqueFolders(schedules)
  const duplicateCount = countDuplicateSchedules(schedules)
  const collisionWindowEnd = new Date(todayStart.getTime() + COLLISION_WINDOW_MS)
  const staleCount = countStale(schedules)
  const collisionCount = countCollisions(schedules, todayStart, collisionWindowEnd, machineScope, robotScope, collisionMachineIds ?? scheduleMachineIds)
  const expiringCount = countExpiring(schedules, horizonDays)

  // Machine/robot metrics surface when the runtime machine map is present. Counts are
  // filter-aware: they derive from the visible `schedules`, exactly like the folders metric.
  const machineRobotMetrics: SummaryMetricData[] = scheduleMachineIds
    ? [
        {
          description: metricDescriptions.machines,
          key: 'machines',
          label: 'Machines',
          tone: metricTones.machines,
          value: countMachines(schedules, scheduleMachineIds),
        },
        {
          description: metricDescriptions.robots,
          key: 'robots',
          label: 'Robots',
          tone: metricTones.robots,
          value: countRobots(schedules),
        },
      ]
    : []

  const baseMetrics: SummaryMetricData[] = [
    {
      description: metricDescriptions.triggers,
      key: 'triggers',
      label: 'Triggers',
      tone: metricTones.triggers,
      value: schedules.length,
    },
  ]

  const attentionMetrics: SummaryMetricData[] = [
    {
      description: metricDescriptions.duplicateSchedules,
      key: 'duplicateSchedules',
      label: 'Duplicates',
      tone: metricTones.duplicateSchedules,
      value: duplicateCount,
    },
    {
      description: metricDescriptions.stale,
      key: 'stale',
      label: 'Stale',
      tone: metricTones.stale,
      value: staleCount,
    },
    {
      description: metricDescriptions.collisions,
      key: 'collisions',
      label: 'Collisions',
      tone: metricTones.collisions,
      value: collisionCount,
    },
    {
      description: expiringDescription(horizonDays),
      key: 'expiring',
      label: 'Expiring',
      tone: metricTones.expiring,
      value: expiringCount,
    },
  ]

  if (statusFilter === 'disabled') {
    const suppressedRunCount = countScheduleRunsInRange(disabledSchedules, todayStart, todayEnd)

    return [
      ...baseMetrics,
      {
        description: metricDescriptions.suppressedToday,
        key: 'suppressedToday',
        label: 'Suppressed Today',
        tone: metricTones.suppressedToday,
        value: suppressedRunCount,
      },
      ...attentionMetrics,
      ...machineRobotMetrics,
      {
        description: metricDescriptions.folders,
        key: 'folders',
        label: 'Folders',
        tone: metricTones.folders,
        value: folderCount,
      },
    ]
  }

  if (statusFilter === 'enabled') {
    const activeTodayCount = countActiveToday(enabledSchedules, todayStart, todayEnd)

    return [
      ...baseMetrics,
      {
        description: metricDescriptions.activeToday,
        key: 'activeToday',
        label: 'Active Today',
        tone: metricTones.activeToday,
        value: activeTodayCount,
      },
      ...attentionMetrics,
      ...machineRobotMetrics,
      {
        description: metricDescriptions.folders,
        key: 'folders',
        label: 'Folders',
        tone: metricTones.folders,
        value: folderCount,
      },
    ]
  }

  // statusFilter === 'all'
  const activeTodayCount = countActiveToday(enabledSchedules, todayStart, todayEnd)

  return [
    ...baseMetrics,
    {
      description: metricDescriptions.enabled,
      key: 'enabled',
      label: 'Enabled',
      tone: metricTones.enabled,
      value: enabledSchedules.length,
    },
    {
      description: metricDescriptions.activeToday,
      key: 'activeToday',
      label: 'Active Today',
      tone: metricTones.activeToday,
      value: activeTodayCount,
    },
    ...attentionMetrics,
    ...machineRobotMetrics,
    {
      description: metricDescriptions.folders,
      key: 'folders',
      label: 'Folders',
      tone: metricTones.folders,
      value: folderCount,
    },
  ]
}
