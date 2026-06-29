import type { CSSProperties } from 'react'
import {
  defaultViewMode,
  legacyTimelineModeStorageKey,
  maxDensitySegments,
  recurrenceBucketLabels,
  viewModes,
  viewModeStorageKey,
} from './constants'
import { formatDayCount, formatNumber, formatRunCount } from './formatters'
import type { ProcessSchedule } from './orchestrator'
import {
  dateKey,
  getCachedScheduleOccurrences,
  getScheduleSummary,
  isQueueTrigger,
  shortDateLabel,
} from './scheduleUtils'
import type { ScheduleOccurrence } from './scheduleUtils'
import type {
  CalendarDisplayItem,
  CalendarSpanBar,
  DensitySegment,
  OutlookWeekDenseSummary,
  OutlookWeekTimedEvent,
  ProcessDayGroup,
  RecurrenceBucket,
  RuntimeStats,
  ScheduleSearchEntry,
  SpanBarLayout,
  ViewMode,
} from './types'

const rootFolderName = (folderName: string): string =>
  (folderName.split('/')[0] ?? folderName).trim() || folderName

// djb2-style string hash → hue 0..359, deterministic per root folder name
const hashHue = (name: string): number => {
  let h = 5381
  for (let i = 0; i < name.length; i += 1) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  return h % 360
}

export const folderColorVars = (folderName: string): CSSProperties => {
  const hue = hashHue(rootFolderName(folderName))
  const accent = `hsl(${hue} 62% 55%)`
  return { '--folder-accent': accent, '--bucket-accent': accent } as CSSProperties
}

export const buildScheduleSearchIndex = (schedules: ProcessSchedule[]): ScheduleSearchEntry[] =>
  schedules.map((schedule) => ({
    schedule,
    searchText: [
      schedule.Name,
      schedule.ReleaseName,
      schedule.PackageName,
      schedule.folderName,
      schedule.StartProcessCronSummary,
      schedule.StartProcessCron,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }))

export const isTestingPath = (pathname: string) => pathname.replace(/\/+$/, '').endsWith('/testing')

export const folderAccentStyle = (folderName: string): CSSProperties => folderColorVars(folderName)

export const scheduleKey = (schedule: ProcessSchedule) => `${schedule.folderId}-${schedule.Id}`

export const schedulePatternLabel = (schedule: ProcessSchedule) =>
  isQueueTrigger(schedule) ? 'Queue trigger' : getScheduleSummary(schedule)

export const getVisibleYearRange = (date: Date) => {
  const start = new Date(date.getFullYear(), 0, 1)
  start.setHours(0, 0, 0, 0)

  const end = new Date(date.getFullYear() + 1, 0, 1)
  end.setMilliseconds(-1)

  return { start, end }
}

export const getYearMonths = (date: Date) =>
  Array.from({ length: 12 }, (_, index) => new Date(date.getFullYear(), index, 1))

export const yearLabel = (date: Date) => String(date.getFullYear())

const cronFields = (schedule: ProcessSchedule) => schedule.StartProcessCron?.trim().split(/\s+/) ?? []

const isIntervalField = (field?: string) => Boolean(field && (field.includes('/') || field === '*'))

const parseScheduleDetailsType = (schedule: ProcessSchedule) => {
  if (!schedule.StartProcessCronDetails) return undefined

  try {
    const parsed = JSON.parse(schedule.StartProcessCronDetails) as { type?: number }
    return parsed.type
  } catch {
    return undefined
  }
}

export const classifyRecurrenceBucket = (
  schedule: ProcessSchedule,
  occurrences: ScheduleOccurrence[] = [],
): RecurrenceBucket => {
  if (isQueueTrigger(schedule)) return 'queue'
  const summary = schedulePatternLabel(schedule).toLowerCase()
  const fields = cronFields(schedule)
  const minuteField = fields[1]
  const hourField = fields[2]
  const dayOfMonthField = fields[3]
  const dayOfWeekField = fields[5]
  const detailsType = parseScheduleDetailsType(schedule)

  if (
    detailsType === 0 ||
    summary.includes('minute') ||
    (isIntervalField(minuteField) && minuteField !== '0' && occurrences.length !== 1)
  ) {
    return 'minute'
  }

  if (
    detailsType === 1 ||
    summary.includes('hour') ||
    (isIntervalField(hourField) && minuteField !== '*' && occurrences.length !== 1)
  ) {
    return 'hourly'
  }

  if (
    detailsType === 4 ||
    summary.includes('month') ||
    (dayOfMonthField && dayOfMonthField !== '*' && dayOfMonthField !== '?' && dayOfMonthField !== '1/1')
  ) {
    return 'monthly'
  }

  if (
    detailsType === 3 ||
    summary.includes('only on') ||
    summary.includes('weekly') ||
    (dayOfWeekField && dayOfWeekField !== '*' && dayOfWeekField !== '?')
  ) {
    return 'weekly'
  }

  if (
    detailsType === 2 ||
    summary.startsWith('at ') ||
    dayOfMonthField === '1/1' ||
    (occurrences.length === 1 && occurrences[0].generatedFrom === 'cron')
  ) {
    return 'daily'
  }

  return 'other'
}

export const isHighFrequencySchedule = (schedule: ProcessSchedule) => {
  const bucket = classifyRecurrenceBucket(schedule)
  return bucket === 'minute' || bucket === 'hourly'
}

export const countHighFrequencySchedules = (schedules: ProcessSchedule[]) =>
  schedules.reduce((total, schedule) => total + (isHighFrequencySchedule(schedule) ? 1 : 0), 0)

export const countScheduleRunsInRange = (schedules: ProcessSchedule[], start: Date, end: Date) =>
  schedules.reduce(
    (total, schedule) => total + getCachedScheduleOccurrences(schedule, start, end).length,
    0,
  )

export const recurrenceAccentStyle = (bucket: RecurrenceBucket): CSSProperties =>
  ({
    '--bucket-accent': `var(--bucket-${bucket})`,
    '--bucket-soft': `var(--bucket-${bucket}-soft)`,
  }) as CSSProperties

export const groupAccentStyle = (group: ProcessDayGroup): CSSProperties =>
  folderColorVars(group.schedule.folderName)

const occurrenceMinuteOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes()
const compareOccurrences = (a: ScheduleOccurrence, b: ScheduleOccurrence) => a.date.getTime() - b.date.getTime()
const outlookWeekDefaultBlockMinutes = 15
const outlookWeekVisualBlockMinutes = 15

export const readInitialViewMode = (): ViewMode => {
  if (typeof window === 'undefined') return defaultViewMode

  const storedMode = window.localStorage.getItem(viewModeStorageKey)
  if (viewModes.includes(storedMode as ViewMode)) return storedMode as ViewMode

  const legacyMode = window.localStorage.getItem(legacyTimelineModeStorageKey)
  if (viewModes.includes(legacyMode as ViewMode)) {
    window.localStorage.setItem(viewModeStorageKey, legacyMode as ViewMode)
    window.localStorage.removeItem(legacyTimelineModeStorageKey)
    return legacyMode as ViewMode
  }

  return defaultViewMode
}

export const buildDensitySegments = (occurrences: ScheduleOccurrence[]): DensitySegment[] => {
  const visibleOccurrences =
    occurrences.length <= maxDensitySegments
      ? occurrences
      : Array.from({ length: maxDensitySegments }, (_, index) => {
          const sourceIndex = Math.round((index * (occurrences.length - 1)) / (maxDensitySegments - 1))
          return occurrences[sourceIndex]
        })

  return visibleOccurrences.map((occurrence) => ({
    left: Math.min(99.2, Math.max(0.8, (occurrenceMinuteOfDay(occurrence.date) / 1439) * 100)),
  }))
}

export const buildProcessDayGroups = (occurrences: ScheduleOccurrence[]) => {
  const grouped = new Map<string, ScheduleOccurrence[]>()
  for (const occurrence of occurrences) {
    const key = scheduleKey(occurrence.schedule)
    const items = grouped.get(key)
    if (items) {
      items.push(occurrence)
    } else {
      grouped.set(key, [occurrence])
    }
  }

  return Array.from(grouped, ([key, items]) => {
    const sortedItems = items.sort(compareOccurrences)
    const firstOccurrence = sortedItems[0]
    const lastOccurrence = sortedItems[sortedItems.length - 1]
    const bucket = classifyRecurrenceBucket(firstOccurrence.schedule, sortedItems)

    return {
      type: 'process-day' as const,
      id: `${key}-${dateKey(firstOccurrence.date)}-process-day`,
      date: firstOccurrence.date,
      scheduleKey: key,
      schedule: firstOccurrence.schedule,
      occurrences: sortedItems,
      bucket,
      bucketLabel: recurrenceBucketLabels[bucket],
      patternLabel: schedulePatternLabel(firstOccurrence.schedule),
      firstOccurrence,
      lastOccurrence,
      runCount: sortedItems.length,
      densitySegments: buildDensitySegments(sortedItems),
    }
  }).sort(
    (a, b) =>
      a.firstOccurrence.date.getTime() - b.firstOccurrence.date.getTime() ||
      a.schedule.Name.localeCompare(b.schedule.Name),
  )
}

const getSpanTimingLabel = (
  item: ProcessDayGroup,
  dayCount: number,
  runtimeStats?: Map<number, RuntimeStats>,
) => {
  let base: string
  if (dayCount > 1 && item.runCount > 1) {
    base = `${formatNumber(item.runCount)}/day`
  } else if (dayCount > 1) {
    base = formatDayCount(dayCount)
  } else {
    base = item.runCount > 1 ? formatRunCount(item.runCount) : item.firstOccurrence.timeLabel
  }

  const stats = runtimeStats?.get(item.schedule.Id)
  if (stats) {
    const typMinutes = Math.max(1, Math.ceil(stats.medianSec / 60))
    return `${base} (typ. ~${typMinutes}m)`
  }

  return base
}

export const buildSpanBarLayout = (
  calendarDays: Date[],
  itemsByDay: Map<string, CalendarDisplayItem[]>,
  visibleLaneLimit: number,
  runtimeStats?: Map<number, RuntimeStats>,
): SpanBarLayout => {
  const bars: CalendarSpanBar[] = []
  const hiddenCountByDay = new Map<string, number>()
  const weekCount = Math.ceil(calendarDays.length / 7)
  const calendarDayKeys = calendarDays.map(dateKey)

  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const weekDays = calendarDays.slice(weekIndex * 7, weekIndex * 7 + 7)
    const weekDayKeys = calendarDayKeys.slice(weekIndex * 7, weekIndex * 7 + 7)
    const itemsByScheduleAndDay = new Map<string, Map<string, ProcessDayGroup>>()

    for (let dayIndex = 0; dayIndex < weekDays.length; dayIndex += 1) {
      const key = weekDayKeys[dayIndex]
      for (const item of itemsByDay.get(key) ?? []) {
        let scheduleDays = itemsByScheduleAndDay.get(item.scheduleKey)
        if (!scheduleDays) {
          scheduleDays = new Map<string, ProcessDayGroup>()
          itemsByScheduleAndDay.set(item.scheduleKey, scheduleDays)
        }
        scheduleDays.set(key, item)
      }
    }

    const segments: Omit<CalendarSpanBar, 'lane'>[] = []
    for (const [scheduleKeyValue, byDay] of itemsByScheduleAndDay) {
      let dayIndex = 0
      while (dayIndex < weekDays.length) {
        const firstItem = byDay.get(weekDayKeys[dayIndex])
        if (!firstItem) {
          dayIndex += 1
          continue
        }

        const segmentItems = [firstItem]
        let endIndex = dayIndex + 1
        while (endIndex < weekDays.length) {
          const nextItem = byDay.get(weekDayKeys[endIndex])
          if (!nextItem) break
          segmentItems.push(nextItem)
          endIndex += 1
        }

        const dayCount = segmentItems.length
        const totalRuns = segmentItems.reduce((total, item) => total + item.runCount, 0)
        segments.push({
          id: `${scheduleKeyValue}-${weekDayKeys[dayIndex]}-${weekDayKeys[endIndex - 1]}-span`,
          item: firstItem,
          startColumn: dayIndex + 1,
          spanDays: dayCount,
          weekIndex,
          dayCount,
          totalRuns,
          timingLabel: getSpanTimingLabel(firstItem, dayCount, runtimeStats),
        })

        dayIndex = endIndex
      }
    }

    segments.sort(
      (a, b) =>
        b.spanDays - a.spanDays ||
        a.startColumn - b.startColumn ||
        a.item.firstOccurrence.date.getTime() - b.item.firstOccurrence.date.getTime() ||
        a.item.schedule.Name.localeCompare(b.item.schedule.Name),
    )

    const laneEnds: number[] = []
    for (const segment of segments) {
      const segmentEnd = segment.startColumn + segment.spanDays
      const lane = laneEnds.findIndex((endColumn) => segment.startColumn >= endColumn)
      const assignedLane = lane === -1 ? laneEnds.length : lane
      laneEnds[assignedLane] = segmentEnd

      if (assignedLane < visibleLaneLimit) {
        bars.push({ ...segment, lane: assignedLane })
      } else {
        for (let offset = 0; offset < segment.spanDays; offset += 1) {
          const hiddenKey = weekDayKeys[segment.startColumn - 1 + offset]
          hiddenCountByDay.set(hiddenKey, (hiddenCountByDay.get(hiddenKey) ?? 0) + 1)
        }
      }
    }
  }

  return { bars, hiddenCountByDay }
}

const isOutlookDenseGroup = (item: ProcessDayGroup) =>
  (item.bucket === 'minute' || item.bucket === 'hourly') && item.runCount > 1

const layoutOverlappingWeekEvents = (
  events: Array<Omit<OutlookWeekTimedEvent, 'columnIndex' | 'columnCount'>>,
) => {
  const sortedEvents = [...events].sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      a.endMinute - b.endMinute ||
      a.item.schedule.Name.localeCompare(b.item.schedule.Name) ||
      a.occurrence.id.localeCompare(b.occurrence.id),
  )
  const laidOutEvents: OutlookWeekTimedEvent[] = []

  const flushCluster = (cluster: typeof sortedEvents) => {
    const laneEnds: number[] = []
    const assigned = cluster.map((event) => {
      const reusableLane = laneEnds.findIndex((endMinute) => event.startMinute >= endMinute)
      const columnIndex = reusableLane === -1 ? laneEnds.length : reusableLane
      laneEnds[columnIndex] = Math.max(event.endMinute, event.startMinute + outlookWeekVisualBlockMinutes)

      return { event, columnIndex }
    })
    const columnCount = Math.max(1, laneEnds.length)

    for (const { event, columnIndex } of assigned) {
      laidOutEvents.push({ ...event, columnIndex, columnCount })
    }
  }

  let cluster: typeof sortedEvents = []
  let clusterEndMinute = -1

  for (const event of sortedEvents) {
    if (cluster.length > 0 && event.startMinute >= clusterEndMinute) {
      flushCluster(cluster)
      cluster = []
      clusterEndMinute = -1
    }

    cluster.push(event)
    clusterEndMinute = Math.max(
      clusterEndMinute,
      event.endMinute,
      event.startMinute + outlookWeekVisualBlockMinutes,
    )
  }

  if (cluster.length > 0) flushCluster(cluster)

  return laidOutEvents
}

export const buildOutlookWeekLayout = (
  calendarDays: Date[],
  itemsByDay: Map<string, CalendarDisplayItem[]>,
  blockMinutes = outlookWeekDefaultBlockMinutes,
  runtimeStats?: Map<number, RuntimeStats>,
) => ({
  days: calendarDays.map((day) => {
    const key = dateKey(day)
    const denseSummaries: OutlookWeekDenseSummary[] = []
    const timedEvents: Array<Omit<OutlookWeekTimedEvent, 'columnIndex' | 'columnCount'>> = []

    for (const item of itemsByDay.get(key) ?? []) {
      if (isOutlookDenseGroup(item)) {
        denseSummaries.push({
          id: `${item.id}-dense-summary`,
          item,
          dayKey: key,
        })
        continue
      }

      const stats = runtimeStats?.get(item.schedule.Id)
      const eventBlockMinutes = stats
        ? Math.max(5, Math.ceil(stats.medianSec / 60))
        : blockMinutes

      for (const occurrence of item.occurrences) {
        const startMinute = occurrenceMinuteOfDay(occurrence.date)
        const endMinute = Math.min(24 * 60, startMinute + eventBlockMinutes)
        timedEvents.push({
          id: `${item.id}-${occurrence.id}-timed`,
          item,
          occurrence,
          dayKey: key,
          startMinute,
          endMinute,
        })
      }
    }

    denseSummaries.sort(
      (a, b) =>
        a.item.firstOccurrence.date.getTime() - b.item.firstOccurrence.date.getTime() ||
        a.item.schedule.Name.localeCompare(b.item.schedule.Name),
    )

    return {
      date: day,
      key,
      denseSummaries,
      timedEvents: layoutOverlappingWeekEvents(timedEvents),
    }
  }),
})

export const groupOccurrencesBySchedule = (occurrences: ScheduleOccurrence[]) => {
  const grouped = new Map<string, ScheduleOccurrence[]>()
  for (const occurrence of occurrences) {
    const key = scheduleKey(occurrence.schedule)
    const items = grouped.get(key)
    if (items) {
      items.push(occurrence)
    } else {
      grouped.set(key, [occurrence])
    }
  }

  return Array.from(grouped, ([key, items]) => {
    const sortedItems = items.sort(compareOccurrences)

    return {
      key,
      schedule: sortedItems[0].schedule,
      occurrences: sortedItems,
    }
  }).sort(
    (a, b) => a.occurrences[0].date.getTime() - b.occurrences[0].date.getTime() ||
      a.schedule.Name.localeCompare(b.schedule.Name),
  )
}

export const yearDayTitle = (day: Date, items: CalendarDisplayItem[]) => {
  const visibleItems = items.slice(0, 4)
  const itemLabels = visibleItems.map((item) => {
    const runLabel = item.runCount === 1 ? item.firstOccurrence.timeLabel : formatRunCount(item.runCount)
    return `${item.schedule.Name} (${item.bucketLabel}, ${runLabel})`
  })
  const overflowLabel = items.length > visibleItems.length ? `, +${formatNumber(items.length - visibleItems.length)} more` : ''

  return `${shortDateLabel(day)}: ${itemLabels.join(', ')}${overflowLabel}`
}
