import { useMemo } from 'react'
import { buildProcessDayGroups } from '../calendarDisplay'
import { upcomingGroupLabel } from '../formatters'
import type { ProcessSchedule } from '../orchestrator'
import { measurePerformance } from '../performance'
import { dateKey, getCachedScheduleOccurrences, sortOccurrences } from '../scheduleUtils'
import type { ScheduleOccurrence } from '../scheduleUtils'
import type { UpcomingDisplayGroup } from '../types'

export function buildUpcomingDisplayGroups(occurrences: ScheduleOccurrence[]): UpcomingDisplayGroup[] {
  const grouped = new Map<string, ScheduleOccurrence[]>()
  for (const occurrence of occurrences) {
    const key = dateKey(occurrence.date)
    const items = grouped.get(key)
    if (items) {
      items.push(occurrence)
    } else {
      grouped.set(key, [occurrence])
    }
  }

  return Array.from(grouped, ([key, items]) => ({
    key,
    label: upcomingGroupLabel(items[0].date),
    items: buildProcessDayGroups(items),
  }))
}

export function useUpcomingModel(filteredSchedules: ProcessSchedule[]) {
  const upcomingRangeEnd = useMemo(() => {
    const end = new Date()
    end.setDate(end.getDate() + 7)
    end.setHours(23, 59, 59, 999)
    return end
  }, [])

  const upcomingOccurrences = useMemo(() => {
    return measurePerformance('upcoming occurrences', () => {
      const now = new Date()
      const items: ScheduleOccurrence[] = []
      for (const schedule of filteredSchedules) {
        items.push(...getCachedScheduleOccurrences(schedule, now, upcomingRangeEnd))
      }
      return sortOccurrences(items)
    }, {
      schedules: filteredSchedules.length,
    })
  }, [filteredSchedules, upcomingRangeEnd])

  const upcomingDisplayGroups = useMemo(
    () =>
      measurePerformance('upcoming groups', () => buildUpcomingDisplayGroups(upcomingOccurrences), {
        occurrences: upcomingOccurrences.length,
      }),
    [upcomingOccurrences],
  )

  return { upcomingDisplayGroups }
}
