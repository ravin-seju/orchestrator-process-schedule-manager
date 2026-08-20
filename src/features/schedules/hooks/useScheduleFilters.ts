import { useDeferredValue, useMemo } from 'react'
import { buildScheduleSearchIndex, classifyRecurrenceBucket } from '../calendarDisplay'
import type { ProcessSchedule } from '../orchestrator'
import { measurePerformance } from '../performance'
import { getAssignedMachineIds, getAssignedRobotIds, getCachedScheduleOccurrences, getLifecycleStatus, isAutoDisabledByStopDate, isLifecycleAttention, isQueueTrigger, isStaleSchedule } from '../scheduleUtils'
import type { AttentionFilter, StatusFilter, TriggerTypeFilter } from '../types'

const COLLISION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const duplicateKey = (schedule: ProcessSchedule) =>
  `${schedule.folderId}-${String(schedule.ReleaseId ?? schedule.PackageName ?? schedule.Name)}`

const findDuplicateSet = (schedules: ProcessSchedule[]): Set<ProcessSchedule> => {
  const groups = new Map<string, ProcessSchedule[]>()
  for (const schedule of schedules) {
    const key = duplicateKey(schedule)
    const list = groups.get(key) ?? []
    list.push(schedule)
    groups.set(key, list)
  }
  const dupes = new Set<ProcessSchedule>()
  for (const list of groups.values()) {
    if (list.length > 1) {
      for (const s of list) dupes.add(s)
    }
  }
  return dupes
}

const findCollisionSet = (
  schedules: ProcessSchedule[],
  windowStart: Date,
  windowEnd: Date,
  machineScope?: Set<number>,
  robotScope?: Set<number>,
  scheduleMachineIds?: Map<number, number[]>,
): Set<ProcessSchedule> => {
  const scopedMachine = machineScope != null && machineScope.size > 0
  const scopedRobot = robotScope != null && robotScope.size > 0
  const scoped = scopedMachine || scopedRobot
  // Machine identity comes from job history (scheduleMachineIds) when provided —
  // the actual runtime machine — otherwise from the schedule's configured MachineRobots.
  const machineIdsOf = (s: ProcessSchedule): number[] =>
    scheduleMachineIds ? (scheduleMachineIds.get(s.Id) ?? []) : getAssignedMachineIds(s)
  const slots = new Map<string, Set<ProcessSchedule>>()
  for (const schedule of schedules) {
    if (!schedule.Enabled) continue
    if (isQueueTrigger(schedule)) continue

    // When a machine/robot filter is active, partition collisions per resource:
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
    // Skip schedules not allocated to any selected machine/robot
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
  return colliding
}

export const applyAttentionFilter = (
  matches: ProcessSchedule[],
  attentionFilter: AttentionFilter,
  machineScope?: Set<number>,
  robotScope?: Set<number>,
  scheduleMachineIds?: Map<number, number[]>,
): ProcessSchedule[] => {
  if (attentionFilter === 'none') return matches

  if (attentionFilter === 'duplicates') {
    const dupes = findDuplicateSet(matches)
    return matches.filter((s) => dupes.has(s))
  }

  if (attentionFilter === 'stale') {
    const now = Date.now()
    return matches.filter((s) => isStaleSchedule(s, now))
  }

  if (attentionFilter === 'collisions') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start.getTime() + COLLISION_WINDOW_MS)
    const colliding = findCollisionSet(matches, start, end, machineScope, robotScope, scheduleMachineIds)
    return matches.filter((s) => colliding.has(s))
  }

  if (attentionFilter === 'expiring') {
    const now = Date.now()
    return matches.filter((s) => isLifecycleAttention(getLifecycleStatus(s, now)))
  }

  if (attentionFilter === 'expired') {
    const now = Date.now()
    return matches.filter((s) => isAutoDisabledByStopDate(s, now))
  }

  return matches
}

export function useScheduleFilters({
  attentionFilter,
  query,
  schedules,
  scheduleMachineIds,
  collisionMachineIds,
  selectedFolderIds,
  selectedMachineIds = [],
  selectedRobotIds = [],
  statusFilter,
  triggerTypeFilter,
}: {
  attentionFilter: AttentionFilter
  query: string
  schedules: ProcessSchedule[]
  scheduleMachineIds?: Map<number, number[]>
  collisionMachineIds?: Map<number, number[]>
  selectedFolderIds: string[]
  selectedMachineIds?: number[]
  selectedRobotIds?: number[]
  statusFilter: StatusFilter
  triggerTypeFilter: TriggerTypeFilter
}) {
  const trimmedQuery = query.trim()
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const scheduleSearchIndex = useMemo(
    () => measurePerformance('schedule search index', () => buildScheduleSearchIndex(schedules), {
      schedules: schedules.length,
    }),
    [schedules],
  )

  const selectedMachineIdSet = useMemo(() => new Set(selectedMachineIds), [selectedMachineIds])
  const selectedRobotIdSet = useMemo(() => new Set(selectedRobotIds), [selectedRobotIds])

  const preAttentionSchedules = useMemo(() => {
    return measurePerformance('schedule filters', () => {
      const matches: ProcessSchedule[] = []
      const selectedFolderIdSet = new Set(selectedFolderIds)
      // Machine identity from job history when available (actual runtime machine),
      // else the schedule's configured MachineRobots.
      const machineIdsOf = (s: ProcessSchedule): number[] =>
        scheduleMachineIds ? (scheduleMachineIds.get(s.Id) ?? []) : getAssignedMachineIds(s)
      for (const { schedule, searchText } of scheduleSearchIndex) {
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'enabled' && schedule.Enabled) ||
          (statusFilter === 'disabled' && !schedule.Enabled)
        const matchesFolder =
          !selectedFolderIdSet.size || selectedFolderIdSet.has(String(schedule.folderId))
        const matchesTriggerType =
          triggerTypeFilter === 'all' || classifyRecurrenceBucket(schedule) === triggerTypeFilter
        const matchesMachine =
          !selectedMachineIdSet.size ||
          machineIdsOf(schedule).some((id) => selectedMachineIdSet.has(id))
        const matchesRobot =
          !selectedRobotIdSet.size ||
          getAssignedRobotIds(schedule).some((id) => selectedRobotIdSet.has(id))

        if (
          matchesStatus &&
          matchesFolder &&
          matchesTriggerType &&
          matchesMachine &&
          matchesRobot &&
          (!normalizedQuery || searchText.includes(normalizedQuery))
        ) {
          matches.push(schedule)
        }
      }

      return matches
    }, {
      query: normalizedQuery,
      schedules: scheduleSearchIndex.length,
    })
  }, [
    normalizedQuery,
    scheduleSearchIndex,
    scheduleMachineIds,
    selectedFolderIds,
    selectedMachineIdSet,
    selectedRobotIdSet,
    statusFilter,
    triggerTypeFilter,
  ])

  const filteredSchedules = useMemo(
    () => applyAttentionFilter(preAttentionSchedules, attentionFilter, selectedMachineIdSet, selectedRobotIdSet, collisionMachineIds ?? scheduleMachineIds),
    [preAttentionSchedules, attentionFilter, selectedMachineIdSet, selectedRobotIdSet, collisionMachineIds, scheduleMachineIds],
  )

  return { filteredSchedules, preAttentionSchedules, trimmedQuery }
}
