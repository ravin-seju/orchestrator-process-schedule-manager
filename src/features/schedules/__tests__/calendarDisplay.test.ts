// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCalendarItemsByDay,
  groupOccurrencesByDay,
} from '../hooks/useCalendarModel'
import {
  buildProcessDayGroups,
  buildOutlookWeekLayout,
  buildSpanBarLayout,
  classifyRecurrenceBucket,
  countHighFrequencySchedules,
  countScheduleRunsInRange,
  readInitialViewMode,
} from '../calendarDisplay'
import {
  legacyTimelineModeStorageKey,
  viewModeStorageKey,
} from '../constants'
import type { ProcessSchedule } from '../orchestrator'
import {
  dateKey,
  getScheduleOccurrences,
  getWeekDays,
} from '../scheduleUtils'
import {
  createStressScheduleData,
  parseStressScheduleCount,
  parseStressTenantName,
} from '../stressData'

const baseSchedule = (overrides: Partial<ProcessSchedule>): ProcessSchedule => ({
  Id: 1,
  Name: 'Process A',
  Enabled: true,
  StartProcessCron: '0 0 10 1/1 * ?',
  StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 10, atMinute: 0 } }),
  StartProcessCronSummary: 'At 10:00 AM',
  StartProcessNextOccurrence: null,
  TimeZoneId: 'Central Standard Time',
  TimeZoneIana: 'America/Chicago',
  folderId: 8101,
  folderName: 'Shared',
  ...overrides,
})

afterEach(() => {
  window.localStorage.clear()
})

const dayRange = (date: Date) => {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)

  const end = new Date(date)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

describe('schedule occurrence generation', () => {
  it('generates all minute-by-minute and hourly runs for a day', () => {
    const { start, end } = dayRange(new Date(2026, 4, 6))
    const minuteSchedule = baseSchedule({
      Id: 2,
      Name: 'Minute Process',
      StartProcessCron: '0 * * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 0, minutely: { atMinute: 1 } }),
      StartProcessCronSummary: 'Every minute',
    })
    const hourlySchedule = baseSchedule({
      Id: 3,
      Name: 'Hourly Process',
      StartProcessCron: '0 0 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every hour',
    })

    const minuteOccurrences = getScheduleOccurrences(minuteSchedule, start, end)
    const hourlyOccurrences = getScheduleOccurrences(hourlySchedule, start, end)

    expect(minuteOccurrences).toHaveLength(1_440)
    expect(hourlyOccurrences).toHaveLength(24)
    expect(classifyRecurrenceBucket(minuteSchedule, minuteOccurrences)).toBe('minute')
    expect(classifyRecurrenceBucket(hourlySchedule, hourlyOccurrences)).toBe('hourly')
  })

  it('keeps weekly schedules on their configured weekday', () => {
    const start = new Date(2026, 4, 3)
    start.setHours(0, 0, 0, 0)
    const end = new Date(2026, 4, 9)
    end.setHours(23, 59, 59, 999)
    const weeklySchedule = baseSchedule({
      Id: 4,
      Name: 'Weekly Process',
      StartProcessCron: '0 0 8 ? * MON',
      StartProcessCronDetails: JSON.stringify({
        type: 3,
        weekly: { atHour: 8, atMinute: 0, weekdays: [{ id: 'MON' }] },
      }),
      StartProcessCronSummary: 'At 08:00 AM, only on Monday',
    })

    const occurrences = getScheduleOccurrences(weeklySchedule, start, end)

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].date.getDay()).toBe(1)
    expect(classifyRecurrenceBucket(weeklySchedule, occurrences)).toBe('weekly')
  })
})

describe('calendar display grouping', () => {
  it('migrates the old timeline mode preference into the view mode preference', () => {
    window.localStorage.setItem(legacyTimelineModeStorageKey, 'timeBlocks')

    expect(readInitialViewMode()).toBe('timeBlocks')
    expect(window.localStorage.getItem(viewModeStorageKey)).toBe('timeBlocks')
    expect(window.localStorage.getItem(legacyTimelineModeStorageKey)).toBeNull()
  })

  it('groups occurrences into one process row per day', () => {
    const { start, end } = dayRange(new Date(2026, 4, 6))
    const hourlySchedule = baseSchedule({
      Id: 5,
      Name: 'Hourly Process',
      StartProcessCron: '0 0 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every hour',
    })

    const groups = buildProcessDayGroups(getScheduleOccurrences(hourlySchedule, start, end))

    expect(groups).toHaveLength(1)
    expect(groups[0].runCount).toBe(24)
    expect(groups[0].bucket).toBe('hourly')
  })

  it('builds span bars for schedules that run on contiguous visible days', () => {
    const weekDays = getWeekDays(new Date(2026, 4, 6))
    const weekStart = new Date(weekDays[0])
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekDays[6])
    weekEnd.setHours(23, 59, 59, 999)
    const dailySchedule = baseSchedule({ Id: 6, Name: 'Daily Process' })
    const hourlySchedule = baseSchedule({
      Id: 7,
      Name: 'Hourly Process',
      StartProcessCron: '0 0 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every hour',
    })
    const occurrencesByDay = groupOccurrencesByDay([
      ...getScheduleOccurrences(hourlySchedule, weekStart, weekEnd),
      ...getScheduleOccurrences(dailySchedule, weekStart, weekEnd),
    ])
    const calendarItemsByDay = buildCalendarItemsByDay(occurrencesByDay)

    const allBars = buildSpanBarLayout(weekDays, calendarItemsByDay, 2)
    const limitedBars = buildSpanBarLayout(weekDays, calendarItemsByDay, 1)

    expect(allBars.bars).toHaveLength(2)
    expect(allBars.bars.every((bar) => bar.spanDays === 7)).toBe(true)
    expect(limitedBars.bars).toHaveLength(1)
    expect(limitedBars.hiddenCountByDay.get(dateKey(weekDays[0]))).toBe(1)
  })

  it('represents month overflow as hidden process groups, not hidden raw runs', () => {
    const { start, end } = dayRange(new Date(2026, 4, 6))
    const schedules = [
      baseSchedule({ Id: 8, Name: 'Daily A' }),
      baseSchedule({ Id: 9, Name: 'Daily B', StartProcessCron: '0 30 11 1/1 * ?' }),
      baseSchedule({
        Id: 10,
        Name: 'Hourly Process',
        StartProcessCron: '0 0 * 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
        StartProcessCronSummary: 'Every hour',
      }),
    ]
    const groups = buildProcessDayGroups(
      schedules.flatMap((schedule) => getScheduleOccurrences(schedule, start, end)),
    )

    expect(groups).toHaveLength(3)
    expect(Math.max(0, groups.length - 2)).toBe(1)
    expect(groups.reduce((total, group) => total + group.runCount, 0)).toBe(26)
  })

  it('derives high-frequency trigger and run-count metrics from filtered schedules', () => {
    const { start, end } = dayRange(new Date(2026, 4, 6))
    const hourlySchedule = baseSchedule({
      Id: 15,
      Name: 'Hourly Process',
      StartProcessCron: '0 0 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every hour',
    })
    const minuteSchedule = baseSchedule({
      Id: 16,
      Name: 'Minute Process',
      StartProcessCron: '0 * * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 0, minutely: { atMinute: 1 } }),
      StartProcessCronSummary: 'Every minute',
    })
    const weeklySchedule = baseSchedule({
      Id: 17,
      Name: 'Weekly Process',
      StartProcessCron: '0 0 8 ? * MON',
      StartProcessCronDetails: JSON.stringify({
        type: 3,
        weekly: { atHour: 8, atMinute: 0, weekdays: [{ id: 'MON' }] },
      }),
      StartProcessCronSummary: 'At 08:00 AM, only on Monday',
    })

    expect(countHighFrequencySchedules([hourlySchedule, minuteSchedule, weeklySchedule])).toBe(2)
    expect(countHighFrequencySchedules([weeklySchedule, baseSchedule({ Id: 18, Name: 'Daily Process' })])).toBe(0)
    expect(countScheduleRunsInRange([hourlySchedule, baseSchedule({ Id: 19, Name: 'Daily Process' })], start, end)).toBe(25)
    expect(countScheduleRunsInRange([weeklySchedule], start, end)).toBe(0)
  })

  it('builds Outlook week timed events with 15-minute blocks and overlap columns', () => {
    const weekDays = getWeekDays(new Date(2026, 4, 6))
    const weekStart = new Date(weekDays[0])
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekDays[6])
    weekEnd.setHours(23, 59, 59, 999)
    const sameTimeSchedules = [
      baseSchedule({ Id: 11, Name: 'Daily A' }),
      baseSchedule({ Id: 12, Name: 'Daily B' }),
    ]
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        sameTimeSchedules.flatMap((schedule) => getScheduleOccurrences(schedule, weekStart, weekEnd)),
      ),
    )

    const layout = buildOutlookWeekLayout(weekDays, calendarItemsByDay)
    const targetDay = layout.days.find((day) => day.key === '2026-05-06')

    expect(targetDay?.denseSummaries).toHaveLength(0)
    expect(targetDay?.timedEvents).toHaveLength(2)
    expect(targetDay?.timedEvents.map((event) => event.columnCount)).toEqual([2, 2])
    expect(targetDay?.timedEvents.map((event) => event.columnIndex).sort()).toEqual([0, 1])
    expect(targetDay!.timedEvents[0]!.endMinute - targetDay!.timedEvents[0]!.startMinute).toBe(15)
  })

  it('uses a 15-minute rendered footprint when assigning Outlook week columns', () => {
    const weekDays = getWeekDays(new Date(2026, 4, 6))
    const weekStart = new Date(weekDays[0])
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekDays[6])
    weekEnd.setHours(23, 59, 59, 999)
    const adjacentSchedules = [
      baseSchedule({
        Id: 15,
        Name: 'Daily 9:45',
        StartProcessCron: '0 45 9 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 9, atMinute: 45 } }),
        StartProcessCronSummary: 'At 09:45 AM',
      }),
      baseSchedule({ Id: 16, Name: 'Daily 10:00' }),
    ]
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        adjacentSchedules.flatMap((schedule) => getScheduleOccurrences(schedule, weekStart, weekEnd)),
      ),
    )

    const layout = buildOutlookWeekLayout(weekDays, calendarItemsByDay)
    const targetDay = layout.days.find((day) => day.key === '2026-05-06')

    expect(targetDay?.timedEvents).toHaveLength(2)
    expect(targetDay?.timedEvents.map((event) => event.columnCount)).toEqual([1, 1])
    expect(targetDay?.timedEvents.map((event) => event.columnIndex).sort()).toEqual([0, 0])
    expect(targetDay!.timedEvents[0]!.endMinute - targetDay!.timedEvents[0]!.startMinute).toBe(15)
  })

  it('keeps hourly and minute triggers in Outlook all-day summaries', () => {
    const weekDays = getWeekDays(new Date(2026, 4, 6))
    const { start, end } = dayRange(new Date(2026, 4, 6))
    const hourlySchedule = baseSchedule({
      Id: 13,
      Name: 'Hourly Process',
      StartProcessCron: '0 0 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every hour',
    })
    const minuteSchedule = baseSchedule({
      Id: 14,
      Name: 'Minute Process',
      StartProcessCron: '0 * * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 0, minutely: { atMinute: 1 } }),
      StartProcessCronSummary: 'Every minute',
    })
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay([
        ...getScheduleOccurrences(hourlySchedule, start, end),
        ...getScheduleOccurrences(minuteSchedule, start, end),
      ]),
    )

    const layout = buildOutlookWeekLayout(weekDays, calendarItemsByDay)
    const targetDay = layout.days.find((day) => day.key === '2026-05-06')

    expect(targetDay?.timedEvents).toHaveLength(0)
    expect(targetDay?.denseSummaries).toHaveLength(2)
    expect(targetDay?.denseSummaries.map((summary) => summary.item.runCount).sort((a, b) => a - b)).toEqual([
      24,
      1_440,
    ])
  })
})

describe('stress tenant fixtures', () => {
  it('parses stress tenant shortcuts and creates matching fixture counts', () => {
    expect(parseStressScheduleCount('?stress=50')).toBe(50)
    expect(parseStressTenantName('stress-100')).toBe(100)
    expect(parseStressTenantName('Demo')).toBeNull()
    expect(createStressScheduleData(10).schedules).toHaveLength(10)
  })
})
