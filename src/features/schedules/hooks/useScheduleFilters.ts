import { useDeferredValue, useMemo } from 'react'
import { buildScheduleSearchIndex, classifyRecurrenceBucket } from '../calendarDisplay'
import type { ProcessSchedule } from '../orchestrator'
import { measurePerformance } from '../performance'
import { getCachedScheduleOccurrences, isQueueTrigger, isStaleSchedule } from '../scheduleUtils'
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
): Set<ProcessSchedule> => {
  const slots = new Map<string, Set<ProcessSchedule>>()
  for (const schedule of schedules) {
    if (!schedule.Enabled) continue
    if (isQueueTrigger(schedule)) continue
    const occurrences = getCachedScheduleOccurrences(schedule, windowStart, windowEnd)
    for (const occ of occurrences) {
      const d = occ.date
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`
      const set = slots.get(key) ?? new Set<ProcessSchedule>()
      set.add(schedule)
      slots.set(key, set)
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
    const colliding = findCollisionSet(matches, start, end)
    return matches.filter((s) => colliding.has(s))
  }

  return matches
}

export function useScheduleFilters({
  attentionFilter,
  query,
  schedules,
  selectedFolderIds,
  statusFilter,
  triggerTypeFilter,
}: {
  attentionFilter: AttentionFilter
  query: string
  schedules: ProcessSchedule[]
  selectedFolderIds: string[]
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

  const preAttentionSchedules = useMemo(() => {
    return measurePerformance('schedule filters', () => {
      const matches: ProcessSchedule[] = []
      const selectedFolderIdSet = new Set(selectedFolderIds)
      for (const { schedule, searchText } of scheduleSearchIndex) {
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'enabled' && schedule.Enabled) ||
          (statusFilter === 'disabled' && !schedule.Enabled)
        const matchesFolder =
          !selectedFolderIdSet.size || selectedFolderIdSet.has(String(schedule.folderId))
        const matchesTriggerType =
          triggerTypeFilter === 'all' || classifyRecurrenceBucket(schedule) === triggerTypeFilter

        if (
          matchesStatus &&
          matchesFolder &&
          matchesTriggerType &&
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
  }, [normalizedQuery, scheduleSearchIndex, selectedFolderIds, statusFilter, triggerTypeFilter])

  const filteredSchedules = useMemo(
    () => applyAttentionFilter(preAttentionSchedules, attentionFilter),
    [preAttentionSchedules, attentionFilter],
  )

  return { filteredSchedules, preAttentionSchedules, trimmedQuery }
}
