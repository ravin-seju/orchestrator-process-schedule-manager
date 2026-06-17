import { useMemo } from 'react'
import {
  buildProcessDayGroups,
  buildSpanBarLayout,
  getVisibleYearRange,
  getYearMonths,
  scheduleKey,
  yearLabel,
} from '../calendarDisplay'
import type { ProcessSchedule } from '../orchestrator'
import { measurePerformance } from '../performance'
import {
  dateKey,
  getCachedScheduleOccurrences,
  getCalendarDays,
  getVisibleMonthRange,
  getVisibleWeekRange,
  getWeekDays,
  monthLabel,
  sortOccurrences,
  weekLabel,
} from '../scheduleUtils'
import type { ScheduleOccurrence } from '../scheduleUtils'
import type {
  CalendarDisplayItem,
  CalendarViewMode,
  RuntimeStats,
  SelectedDayDetail,
  ViewMode,
} from '../types'

export function groupOccurrencesByDay(occurrences: ScheduleOccurrence[]) {
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

  return grouped
}

export function buildCalendarItemsByDay(occurrencesByDay: Map<string, ScheduleOccurrence[]>) {
  const grouped = new Map<string, CalendarDisplayItem[]>()
  for (const [key, dayOccurrences] of occurrencesByDay) {
    grouped.set(key, buildProcessDayGroups(dayOccurrences))
  }

  return grouped
}

export function useCalendarModel({
  calendarMode,
  filteredSchedules,
  monthSpanLaneLimit,
  runtimeStats,
  selectedDayDetail,
  viewDate,
  viewMode,
  weekSpanLaneLimit,
}: {
  calendarMode: CalendarViewMode
  filteredSchedules: ProcessSchedule[]
  monthSpanLaneLimit: number
  runtimeStats?: Map<number, RuntimeStats>
  selectedDayDetail: SelectedDayDetail | null
  viewDate: Date
  viewMode: ViewMode
  weekSpanLaneLimit: number
}) {
  const range = useMemo(() => {
    if (calendarMode === 'year') return getVisibleYearRange(viewDate)
    if (calendarMode === 'month') return getVisibleMonthRange(viewDate)
    return getVisibleWeekRange(viewDate)
  }, [calendarMode, viewDate])
  const occurrences = useMemo(() => {
    return measurePerformance('calendar occurrences', () => {
      const items: ScheduleOccurrence[] = []
      for (const schedule of filteredSchedules) {
        items.push(...getCachedScheduleOccurrences(schedule, range.start, range.end))
      }
      return items
    }, {
      mode: calendarMode,
      schedules: filteredSchedules.length,
    })
  }, [calendarMode, filteredSchedules, range.end, range.start])
  const occurrencesByDay = useMemo(
    () => measurePerformance('calendar group by day', () => groupOccurrencesByDay(occurrences), {
      occurrences: occurrences.length,
    }),
    [occurrences],
  )
  const calendarItemsByDay = useMemo(
    () => measurePerformance('calendar process groups', () => buildCalendarItemsByDay(occurrencesByDay), {
      days: occurrencesByDay.size,
    }),
    [occurrencesByDay],
  )
  const calendarDays = useMemo(() => {
    if (calendarMode === 'year') return []
    return calendarMode === 'month' ? getCalendarDays(viewDate) : getWeekDays(viewDate)
  }, [calendarMode, viewDate])
  const calendarWeekCount = Math.max(1, Math.ceil(calendarDays.length / 7))
  const yearMonths = useMemo(() => getYearMonths(viewDate), [viewDate])
  const todayKey = dateKey(new Date())
  const spanBarLayout = useMemo(
    () =>
      measurePerformance(
        'calendar span bars',
        () =>
          buildSpanBarLayout(
            calendarDays,
            calendarItemsByDay,
            calendarMode === 'month' ? monthSpanLaneLimit : weekSpanLaneLimit,
            runtimeStats,
          ),
        {
          days: calendarDays.length,
          mode: calendarMode,
        },
      ),
    [calendarDays, calendarItemsByDay, calendarMode, monthSpanLaneLimit, runtimeStats, weekSpanLaneLimit],
  )
  const calendarTitle =
    calendarMode === 'year'
      ? yearLabel(viewDate)
      : calendarMode === 'month'
        ? monthLabel(viewDate)
        : weekLabel(viewDate)
  const selectedDayOccurrences = selectedDayDetail
    ? sortOccurrences(
        (occurrencesByDay.get(selectedDayDetail.key) ?? []).filter((occurrence) => {
          const occurrenceMinute = occurrence.date.getHours() * 60 + occurrence.date.getMinutes()

          if (selectedDayDetail.scheduleKey && scheduleKey(occurrence.schedule) !== selectedDayDetail.scheduleKey) {
            return false
          }

          if (selectedDayDetail.scheduleKeys && !selectedDayDetail.scheduleKeys.includes(scheduleKey(occurrence.schedule))) {
            return false
          }

          if (typeof selectedDayDetail.minuteOfDay === 'number') {
            return occurrenceMinute === selectedDayDetail.minuteOfDay
          }
          if (
            typeof selectedDayDetail.startMinute === 'number' &&
            typeof selectedDayDetail.endMinute === 'number'
          ) {
            return occurrenceMinute >= selectedDayDetail.startMinute && occurrenceMinute < selectedDayDetail.endMinute
          }

          return true
        }),
      )
    : []
  const activeSelectedDayDetail =
    selectedDayDetail && selectedDayOccurrences.length > 0 ? selectedDayDetail : null
  const shouldRenderSpanBars = calendarMode !== 'year' && viewMode === 'spanBars'
  const calendarRenderMode: ViewMode = shouldRenderSpanBars ? 'spanBars' : viewMode
  const visibleSpanLaneLimit = calendarMode === 'month' ? monthSpanLaneLimit : weekSpanLaneLimit

  return {
    activeSelectedDayDetail,
    calendarDays,
    calendarItemsByDay,
    calendarRenderMode,
    calendarTitle,
    calendarWeekCount,
    occurrences,
    occurrencesByDay,
    range,
    selectedDayOccurrences,
    shouldRenderSpanBars,
    spanBarLayout,
    todayKey,
    visibleSpanLaneLimit,
    yearMonths,
  }
}
