import type { ProcessSchedule } from './orchestrator'
import { EXPIRING_SOON_DAYS } from './constants'

export interface ScheduleOccurrence {
  id: string
  schedule: ProcessSchedule
  date: Date
  timeLabel: string
  generatedFrom: 'cron' | 'next'
}

interface CronDetails {
  type?: number
  minutely?: Record<string, unknown>
  hourly?: Record<string, unknown>
  daily?: Record<string, unknown>
  weekly?: Record<string, unknown>
  monthly?: Record<string, unknown>
  advancedCron?: string
  advancedCronExpression?: string
}

interface TimePart {
  hour: number
  minute: number
}

const WEEKDAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MAX_DAILY_EXPANDED_TIMES = 24 * 60
const MAX_GENERATED_OCCURRENCES = MAX_DAILY_EXPANDED_TIMES * 45
const occurrenceCache = new WeakMap<ProcessSchedule, Map<string, ScheduleOccurrence[]>>()
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>()
const defaultTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const getTimeFormatter = (timeZone: string | null | undefined): Intl.DateTimeFormat => {
  if (!timeZone) return defaultTimeFormatter
  const cached = timeFormatterCache.get(timeZone)
  if (cached) return cached
  try {
    const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
    timeFormatterCache.set(timeZone, formatter)
    return formatter
  } catch {
    timeFormatterCache.set(timeZone, defaultTimeFormatter)
    return defaultTimeFormatter
  }
}

// Shared cache for the zone-aware date labels below, mirroring getTimeFormatter: constructing an
// Intl.DateTimeFormat is expensive and these run per row/chip. An unknown zone falls back to the
// viewer's rather than throwing.
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()

const getFormatter = (
  options: Intl.DateTimeFormatOptions,
  timeZone: string | null | undefined,
): Intl.DateTimeFormat => {
  const key = `${JSON.stringify(options)}|${timeZone ?? ''}`
  const cached = dateFormatterCache.get(key)
  if (cached) return cached

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat(undefined, timeZone ? { ...options, timeZone } : options)
  } catch {
    formatter = new Intl.DateTimeFormat(undefined, options)
  }
  dateFormatterCache.set(key, formatter)

  return formatter
}

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`

export const dateKey = toDateKey

export const monthLabel = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)

export const shortDateLabel = (date: Date, timeZone?: string | null) =>
  getFormatter({ day: 'numeric', month: 'short' }, timeZone).format(date)

// Zone-aware, and it names the zone: StopProcessDate is an absolute instant, so rendering it in the
// viewer's zone under a "Time zone: <schedule zone>" line could show a different calendar day than
// the one Orchestrator enforces.
export const fullDateTimeLabel = (date: Date, timeZone?: string | null) =>
  getFormatter(
    {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'long',
      timeZoneName: 'short',
      weekday: 'long',
      year: 'numeric',
    },
    timeZone,
  ).format(date)

export const scheduleTimeZone = (schedule: ProcessSchedule) =>
  schedule.TimeZoneIana ?? schedule.TimeZoneId

export const timeLabel = (date: Date, timeZone?: string | null) =>
  getTimeFormatter(timeZone).format(date)

export const getVisibleMonthRange = (month: Date) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  start.setHours(0, 0, 0, 0)

  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  let end = new Date(last)
  end.setDate(last.getDate() + (6 - last.getDay()))
  end.setHours(23, 59, 59, 999)

  const minimumEnd = new Date(start)
  minimumEnd.setDate(start.getDate() + 35)
  minimumEnd.setMilliseconds(-1)
  if (end < minimumEnd) end = minimumEnd

  return { start, end }
}

export const getVisibleWeekRange = (date: Date) => {
  const start = new Date(date)
  start.setDate(date.getDate() - date.getDay())
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  end.setMilliseconds(-1)

  return { start, end }
}

export const getCalendarDays = (month: Date) => {
  const { start, end } = getVisibleMonthRange(month)
  const days: Date[] = []
  const cursor = new Date(start)

  while (cursor <= end) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return days
}

export const getWeekDays = (date: Date) => {
  const { start } = getVisibleWeekRange(date)

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

export const weekLabel = (date: Date) => {
  const { start, end } = getVisibleWeekRange(date)
  const lastDay = new Date(end)
  const sameMonth = start.getMonth() === lastDay.getMonth() && start.getFullYear() === lastDay.getFullYear()
  const sameYear = start.getFullYear() === lastDay.getFullYear()

  if (sameMonth) {
    const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(start)
    return `${month} ${start.getDate()}-${lastDay.getDate()}, ${start.getFullYear()}`
  }

  const startLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(start)
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(lastDay)

  return `${startLabel} - ${endLabel}`
}

const parseDetails = (schedule: ProcessSchedule): CronDetails | null => {
  if (!schedule.StartProcessCronDetails) return null

  try {
    return JSON.parse(schedule.StartProcessCronDetails) as CronDetails
  } catch {
    return null
  }
}

const numeric = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }

  return undefined
}

const findTimeParts = (details: CronDetails | null) => {
  if (!details) return null

  for (const bucket of [details.daily, details.weekly, details.monthly, details.hourly]) {
    const atHour = numeric(bucket?.atHour)
    const atMinute = numeric(bucket?.atMinute)
    if (atHour !== undefined || atMinute !== undefined) {
      return { hour: atHour ?? 0, minute: atMinute ?? 0 }
    }
  }

  return null
}

const cronFields = (cron?: string | null) => cron?.trim().split(/\s+/) ?? []

const parseCronNumberField = (field: string, min: number, max: number) => {
  if (field === '?' || field === '') return null

  const values = new Set<number>()
  const addRange = (start: number, end: number, step = 1) => {
    if (step < 1) return
    for (let value = start; value <= end; value += step) {
      if (value >= min && value <= max) values.add(value)
    }
  }

  for (const rawPart of field.split(',')) {
    const part = rawPart.trim()
    if (!part) return null

    const [base, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) return null

    if (base === '*') {
      addRange(min, max, step)
    } else if (base.includes('-')) {
      const [start, end] = base.split('-').map(Number)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null
      addRange(start, end, step)
    } else {
      const start = Number(base)
      if (!Number.isInteger(start)) return null
      if (stepRaw === undefined) {
        addRange(start, start)
      } else {
        addRange(start, max, step)
      }
    }
  }

  return values.size ? [...values].sort((a, b) => a - b) : null
}

const parseCronTimes = (cron?: string | null) => {
  if (!cron) return null

  const fields = cronFields(cron)
  if (fields.length < 6) return null

  const minutes = parseCronNumberField(fields[1], 0, 59)
  const hours = parseCronNumberField(fields[2], 0, 23)
  if (!minutes?.length || !hours?.length) return null

  const times = hours.flatMap((hour) => minutes.map((minute) => ({ hour, minute })))
  if (times.length > MAX_DAILY_EXPANDED_TIMES) return null

  return times.sort((a, b) => a.hour - b.hour || a.minute - b.minute)
}

const normalizeDow = (token: string) => {
  const upper = token.toUpperCase()
  const named = WEEKDAY_NAMES.indexOf(upper.slice(0, 3))
  if (named >= 0) return named

  const numericValue = Number(token)
  if (!Number.isInteger(numericValue)) return null
  if (numericValue === 7) return 6

  return Math.max(0, Math.min(6, numericValue - 1))
}

const parseWeekdays = (details: CronDetails | null, cron?: string | null) => {
  const weekdays = details?.weekly?.weekdays
  if (Array.isArray(weekdays) && weekdays.length > 0) {
    const parsed = weekdays
      .map((item) => normalizeDow(String((item as { id?: string }).id ?? '')))
      .filter((item): item is number => item !== null)

    if (parsed.length > 0) return new Set(parsed)
  }

  const fields = cron?.trim().split(/\s+/)
  const dowField = fields?.[5]
  if (!dowField || dowField === '*' || dowField === '?') return null

  const values = dowField.split(',').flatMap((part) => {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(normalizeDow)
      if (start === null || end === null) return []

      const range: number[] = []
      for (let value = start; value <= end; value += 1) range.push(value)
      return range
    }

    const normalized = normalizeDow(part)
    return normalized === null ? [] : [normalized]
  })

  return values.length > 0 ? new Set(values) : null
}

const parseMonthDays = (cron?: string | null) => {
  const fields = cronFields(cron)
  const domField = fields?.[3]
  if (!domField || domField === '*' || domField === '?') return null

  if (/^\d+\/\d+$/.test(domField)) {
    const [start, interval] = domField.split('/').map(Number)
    if (interval === 1) return null

    const values: number[] = []
    for (let day = start; day <= 31; day += interval) values.push(day)
    return values.length > 0 ? new Set(values) : null
  }

  const values = domField
    .split(',')
    .map((part) => Number(part))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31)

  return values.length > 0 ? new Set(values) : null
}

const isExpandableCron = (cron?: string | null) => {
  const fields = cronFields(cron)
  if (fields.length < 6) return false
  if (!parseCronTimes(cron)) return false

  const [seconds, minute, hour, dayOfMonth, , dayOfWeek] = fields
  if (seconds !== '0') return false
  if (!parseCronNumberField(minute, 0, 59) || !parseCronNumberField(hour, 0, 23)) return false
  if (/[L#W]/i.test(dayOfMonth) || /[L#W]/i.test(dayOfWeek)) return false
  if (dayOfMonth.includes('/') && !/^\d+\/\d+$/.test(dayOfMonth)) return false
  if (dayOfWeek.includes('/') || dayOfWeek.includes('*')) return false

  return true
}

const shouldUseNextOnly = (details: CronDetails | null, schedule: ProcessSchedule) => {
  const cron = schedule.StartProcessCron ?? ''
  if (cron && !isExpandableCron(cron)) return true
  if (!cron && (details?.type === 0 || details?.type === 1)) return true

  return false
}

const occurrenceTimes = (schedule: ProcessSchedule, details: CronDetails | null): TimePart[] => {
  const cronTimes = parseCronTimes(schedule.StartProcessCron)
  if (cronTimes?.length) return cronTimes

  return [findTimeParts(details) ?? { hour: 0, minute: 0 }]
}

const cloneAtScheduleTime = (
  date: Date,
  time: TimePart,
) => {
  const occurrence = new Date(date)
  occurrence.setHours(time.hour, time.minute, 0, 0)
  return occurrence
}

export const getScheduleSummary = (schedule: ProcessSchedule) => {
  if (schedule.StartProcessCronSummary) return schedule.StartProcessCronSummary
  if (schedule.StartProcessCron) return schedule.StartProcessCron
  return 'No cron summary available'
}

export const isQueueTrigger = (schedule: ProcessSchedule): boolean =>
  schedule.QueueDefinitionId !== null && schedule.QueueDefinitionId !== undefined

export const getAssignedMachineIds = (schedule: ProcessSchedule): number[] =>
  schedule.MachineRobots?.map((mr) => mr.MachineId).filter((id): id is number => id != null) ?? []

export const getAssignedRobotIds = (schedule: ProcessSchedule): number[] =>
  schedule.MachineRobots?.map((mr) => mr.RobotId).filter((id): id is number => id != null) ?? []

// Orchestrator robot names are typically "<account>@<domain>-<type>"
// (e.g. "automationbot@example.com-unattended"). Show just the account portion so the
// label matches the Orchestrator UI's Name column. Domain-agnostic — works for any
// tenant; returns the input unchanged when there is no "@".
export const formatRobotDisplayName = (name: string): string => name.split('@')[0] || name

// Resolve each schedule's effective machine keys: the machines its OWN scheduled jobs
// ran on (direct), falling back to its release's machines (from manual runs) ONLY when
// the schedule has no direct association. Fallback-only keeps the looser process-level
// guess confined to schedules that would otherwise show no machine.
export const buildEffectiveScheduleMachineIds = (
  schedules: ProcessSchedule[],
  direct: Map<number, number[]>,
  releaseFallback: Map<number, number[]>,
): Map<number, number[]> => {
  const effective = new Map<number, number[]>()
  for (const schedule of schedules) {
    const own = direct.get(schedule.Id)
    if (own && own.length) {
      effective.set(schedule.Id, own)
    } else if (schedule.ReleaseId != null) {
      const fallback = releaseFallback.get(schedule.ReleaseId)
      if (fallback && fallback.length) effective.set(schedule.Id, fallback)
    }
  }
  return effective
}

// Robot display names for a schedule: prefer the canonical Robot.Name from Jobs
// ($expand=Robot), shortened to the account part, else the schedule's inline
// RobotUserName, else a synthetic label. Deduped by RobotId. Shared by the detail
// panel and the inventory Robot column.
export const resolveRobotNames = (
  schedule: ProcessSchedule,
  robotNames?: Map<number, string>,
): string[] => {
  const names = new Map<number, string>()
  for (const mr of schedule.MachineRobots ?? []) {
    if (mr.RobotId == null || names.has(mr.RobotId)) continue
    const canonical = robotNames?.get(mr.RobotId)
    names.set(mr.RobotId, canonical ? formatRobotDisplayName(canonical) : (mr.RobotUserName ?? `Robot ${mr.RobotId}`))
  }
  return [...names.values()]
}

// Machine display names for a schedule, from job history (where scheduled runs
// actually executed), keyed by schedule Id and name-resolved via the Jobs-derived
// machineNames map. Shared by the detail panel and the inventory Machine column.
export const resolveMachineNames = (
  scheduleId: number,
  scheduleMachineIds?: Map<number, number[]>,
  machineNames?: Map<number, string>,
): string[] => (scheduleMachineIds?.get(scheduleId) ?? []).map((id) => machineNames?.get(id) ?? `Machine ${id}`)

// Given selected machine keys, return the folders + robots of the schedules that ran
// on those machines — used to auto-narrow the folder + robot pickers on machine select.
export const deriveMachineScopeSelection = (
  schedules: ProcessSchedule[],
  effectiveMachineIds: Map<number, number[]>,
  machineIds: number[],
): { folderIds: string[]; robotIds: number[] } => {
  if (!machineIds.length) return { folderIds: [], robotIds: [] }
  const machineSet = new Set(machineIds)
  const folderIds = new Set<string>()
  const robotIds = new Set<number>()
  for (const schedule of schedules) {
    const machines = effectiveMachineIds.get(schedule.Id) ?? []
    if (!machines.some((id) => machineSet.has(id))) continue
    folderIds.add(String(schedule.folderId))
    for (const id of getAssignedRobotIds(schedule)) robotIds.add(id)
  }
  return { folderIds: [...folderIds], robotIds: [...robotIds] }
}

// Inverse of deriveMachineScopeSelection: given selected folder ids, return the machines
// + robots of the schedules in those folders — used to narrow the machine + robot picker
// OPTION LISTS on folder select (display only; never auto-applies a machine/robot filter,
// which keeps the folder→picker direction acyclic).
export const deriveFolderScopeSelection = (
  schedules: ProcessSchedule[],
  effectiveMachineIds: Map<number, number[]>,
  folderIds: string[],
): { machineIds: number[]; robotIds: number[] } => {
  if (!folderIds.length) return { machineIds: [], robotIds: [] }
  const folderSet = new Set(folderIds)
  const machineIds = new Set<number>()
  const robotIds = new Set<number>()
  for (const schedule of schedules) {
    if (!folderSet.has(String(schedule.folderId))) continue
    for (const id of effectiveMachineIds.get(schedule.Id) ?? []) machineIds.add(id)
    for (const id of getAssignedRobotIds(schedule)) robotIds.add(id)
  }
  return { machineIds: [...machineIds], robotIds: [...robotIds] }
}

// StopProcessDate is the instant Orchestrator auto-disables the trigger, so it cannot run past it.
// Clamping the generation window here (rather than filtering afterwards) makes every consumer
// consistent at once — calendar, Upcoming, Active Today, Collisions and the stale predicate all
// stop projecting runs a trigger can no longer perform.
const effectiveOccurrenceEnd = (schedule: ProcessSchedule, end: Date): Date => {
  if (!schedule.StopProcessDate) return end
  const stopMs = new Date(schedule.StopProcessDate).getTime()
  if (Number.isNaN(stopMs)) return end

  return stopMs < end.getTime() ? new Date(stopMs) : end
}

export const getScheduleOccurrences = (
  schedule: ProcessSchedule,
  start: Date,
  end: Date,
): ScheduleOccurrence[] => {
  if (isQueueTrigger(schedule)) return []
  const effectiveEnd = effectiveOccurrenceEnd(schedule, end)
  if (effectiveEnd.getTime() < start.getTime()) return []
  const details = parseDetails(schedule)
  const nextOccurrence = schedule.StartProcessNextOccurrence
    ? new Date(schedule.StartProcessNextOccurrence)
    : null

  if (shouldUseNextOnly(details, schedule)) {
    if (nextOccurrence && nextOccurrence >= start && nextOccurrence <= effectiveEnd) {
      return [
        {
          id: `${schedule.folderId}-${schedule.Id}-next`,
          schedule,
          date: nextOccurrence,
          timeLabel: timeLabel(nextOccurrence, schedule.TimeZoneIana ?? schedule.TimeZoneId),
          generatedFrom: 'next',
        },
      ]
    }

    return []
  }

  const weekdays = parseWeekdays(details, schedule.StartProcessCron)
  const monthDays = parseMonthDays(schedule.StartProcessCron)
  const times = occurrenceTimes(schedule, details)
  const occurrences: ScheduleOccurrence[] = []
  const cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)

  while (cursor <= effectiveEnd) {
    const matchesWeekday = !weekdays || weekdays.has(cursor.getDay())
    const matchesMonthDay = !monthDays || monthDays.has(cursor.getDate())

    if (matchesWeekday && matchesMonthDay) {
      for (const time of times) {
        const date = cloneAtScheduleTime(cursor, time)
        if (date >= start && date <= effectiveEnd) {
          occurrences.push({
            id: `${schedule.folderId}-${schedule.Id}-${toDateKey(date)}-${time.hour}-${time.minute}`,
            schedule,
            date,
            timeLabel: timeLabel(date),
            generatedFrom: 'cron',
          })
          if (occurrences.length >= MAX_GENERATED_OCCURRENCES) return occurrences
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  if (occurrences.length === 0 && nextOccurrence && nextOccurrence >= start && nextOccurrence <= effectiveEnd) {
    occurrences.push({
      id: `${schedule.folderId}-${schedule.Id}-next`,
      schedule,
      date: nextOccurrence,
      timeLabel: timeLabel(nextOccurrence, schedule.TimeZoneIana ?? schedule.TimeZoneId),
      generatedFrom: 'next',
    })
  }

  return occurrences
}

export const getCachedScheduleOccurrences = (
  schedule: ProcessSchedule,
  start: Date,
  end: Date,
): ScheduleOccurrence[] => {
  const rangeKey = `${start.getTime()}-${end.getTime()}`
  const scheduleCache = occurrenceCache.get(schedule)
  const cachedOccurrences = scheduleCache?.get(rangeKey)
  if (cachedOccurrences) return cachedOccurrences

  const occurrences = getScheduleOccurrences(schedule, start, end)
  if (scheduleCache) {
    scheduleCache.set(rangeKey, occurrences)
  } else {
    occurrenceCache.set(schedule, new Map([[rangeKey, occurrences]]))
  }

  return occurrences
}

export const sortOccurrences = (occurrences: ScheduleOccurrence[]) =>
  [...occurrences].sort((a, b) => a.date.getTime() - b.date.getTime())

const STALE_HORIZON_DAYS = 30
const STALE_HORIZON_MS = STALE_HORIZON_DAYS * 24 * 60 * 60 * 1000

export const isStaleSchedule = (
  schedule: ProcessSchedule,
  nowMs: number = Date.now(),
): boolean => {
  if (!schedule.Enabled) return false
  if (isQueueTrigger(schedule)) return false

  const start = new Date(nowMs)
  const horizonEnd = new Date(nowMs + STALE_HORIZON_MS)
  // Past its stop date the trigger can never run again, so nothing counts as upcoming — including a
  // StartProcessNextOccurrence Orchestrator has not cleared yet. This is what the metric's own
  // description ("...or an expired one-shot schedule") promises.
  if (effectiveOccurrenceEnd(schedule, horizonEnd).getTime() < start.getTime()) return true
  if (getCachedScheduleOccurrences(schedule, start, horizonEnd).length > 0) return false

  if (schedule.StartProcessNextOccurrence) {
    const next = new Date(schedule.StartProcessNextOccurrence).getTime()
    if (!Number.isNaN(next) && next >= nowMs) return false
  }

  return true
}

export type LifecycleStatus = 'expired' | 'expiring-soon' | 'ending'

// StopProcessDate is an absolute trigger-disable date independent of cron cadence — it applies to
// queue triggers too, unlike the isQueueTrigger-gated cron logic elsewhere in this file.
export const getLifecycleStatus = (
  schedule: ProcessSchedule,
  nowMs: number = Date.now(),
): LifecycleStatus | null => {
  if (!schedule.StopProcessDate) return null
  const stopMs = new Date(schedule.StopProcessDate).getTime()
  if (Number.isNaN(stopMs)) return null
  if (stopMs < nowMs) return 'expired'
  if (stopMs - nowMs <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) return 'expiring-soon'
  return 'ending'
}

// The Expiring metric, the 'expiring' attention filter, and every lifecycle marker in the UI all
// gate on this, so "a marker is showing" always means exactly "counted by the Expiring metric".
// 'ending' (a stop date beyond EXPIRING_SOON_DAYS) is deliberately excluded: it is informational,
// surfaced only as the day-details panel's "Ends ... · strategy" text line.
export const isLifecycleAttention = (status: LifecycleStatus | null) =>
  status === 'expired' || status === 'expiring-soon'

// Orchestrator disables a trigger when StopProcessDate passes, so Enabled=false plus a past stop
// date is the strongest signal available that the platform stopped it. It is an inference, not a
// fact: someone who disabled the trigger manually after its stop date passed reads the same way.
export const isAutoDisabledByStopDate = (schedule: ProcessSchedule, nowMs: number = Date.now()) =>
  !schedule.Enabled && getLifecycleStatus(schedule, nowMs) === 'expired'

// Tense follows the date, not the Enabled flag: "Ends 15 Aug" is wrong on 20 Aug whether or not
// Orchestrator has disabled the trigger yet. Also carries the schedule's own timezone, so callers
// cannot accidentally render an absolute stop instant in the viewer's zone.
export const lifecycleEndLabel = (
  schedule: ProcessSchedule,
  date: Date,
  nowMs: number = Date.now(),
) => {
  const when = fullDateTimeLabel(date, scheduleTimeZone(schedule))

  return getLifecycleStatus(schedule, nowMs) === 'expired' ? `Ended on ${when}` : `Ends ${when}`
}
