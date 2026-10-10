import { classifyRecurrenceBucket } from './calendarDisplay'
import { recurrenceBucketLabels } from './constants'
import type { ProcessSchedule } from './orchestrator'
import {
  getLifecycleStatus,
  isAutoDisabledByStopDate,
  isoDateInZone,
  isoDateTimeInZone,
  isQueueTrigger,
  patternLabel,
  processLabel,
  resolveMachineNames,
  resolveRobotNames,
  scheduleStopDate,
  scheduleTimeZone,
  stopStrategyLabel,
} from './scheduleUtils'

// CSV export of the inventory, built from the same `schedules` array the table receives — never
// from the DOM. That array is already filtered (search, folders, machines, robots, trigger type,
// status, attention chip, horizon), and reading it rather than the rendered rows is what keeps the
// file complete: ScheduleTable virtualizes past 80 rows, so the DOM only ever holds a window.

export const inventoryExportColumns = [
  'Name',
  'Process',
  'Folder',
  'Machine',
  'Robot',
  'Trigger Type',
  'Pattern',
  'Ends',
  'Status',
  'Time zone',
  'Next run',
  'Stop strategy',
] as const

type ExportContext = {
  robotNames?: Map<number, string>
  machineNames?: Map<number, string>
  scheduleMachineIds?: Map<number, number[]>
}

const statusLabel = (schedule: ProcessSchedule) => {
  if (isAutoDisabledByStopDate(schedule)) return 'Auto-disabled'

  return schedule.Enabled ? 'Enabled' : 'Disabled'
}

// Orchestrator's own next-occurrence field, but only when the trigger can actually run then. It is
// not always cleared once a stop date passes, so a disabled or expired trigger, a value already in
// the past, or one beyond the stop date would all project a run that cannot happen — the same rule
// the calendar's occurrence clamping follows. A queue trigger fires on queue items, not a clock, so
// it never has a scheduled next run; the calendar shows no time-based occurrences for one either.
const nextRunCell = (schedule: ProcessSchedule, nowMs: number) => {
  if (!schedule.Enabled || !schedule.StartProcessNextOccurrence) return ''
  if (isQueueTrigger(schedule)) return ''
  if (getLifecycleStatus(schedule, nowMs) === 'expired') return ''

  const nextMs = new Date(schedule.StartProcessNextOccurrence).getTime()
  if (Number.isNaN(nextMs) || nextMs < nowMs) return ''

  const stop = scheduleStopDate(schedule)
  if (stop && nextMs > stop.getTime()) return ''

  return isoDateTimeInZone(new Date(nextMs), scheduleTimeZone(schedule))
}

export const buildInventoryRows = (
  schedules: ProcessSchedule[],
  { robotNames, machineNames, scheduleMachineIds }: ExportContext = {},
  nowMs: number = Date.now(),
): string[][] => {
  // Same gate as ScheduleTable: with no machine/robot data at all, the table shows a dash rather
  // than guessing, and so does the file. resolveRobotNames would otherwise fall back to the raw
  // RobotUserName and the two would disagree.
  const showMachineRobot =
    robotNames !== undefined || machineNames !== undefined || scheduleMachineIds !== undefined

  const rows = schedules.map((schedule) => {
    const stop = scheduleStopDate(schedule)
    const timeZone = scheduleTimeZone(schedule)

    return [
      schedule.Name,
      processLabel(schedule),
      schedule.folderName,
      showMachineRobot ? resolveMachineNames(schedule.Id, scheduleMachineIds, machineNames).join('; ') : '',
      showMachineRobot ? resolveRobotNames(schedule, robotNames).join('; ') : '',
      recurrenceBucketLabels[classifyRecurrenceBucket(schedule)],
      patternLabel(schedule) ?? '',
      stop ? isoDateInZone(stop, timeZone) : '',
      statusLabel(schedule),
      timeZone ?? '',
      nextRunCell(schedule, nowMs),
      stopStrategyLabel(schedule) ?? '',
    ]
  })

  return [[...inventoryExportColumns], ...rows]
}

// Formula injection (CWE-1236). Names come straight from Orchestrator, written by whoever configured
// the tenant, so a trigger called `=HYPERLINK(...)` would run as a formula when the file is opened in
// Excel or Sheets. A leading apostrophe makes the cell text. No exported column is numeric, so this
// can never mangle a real value.
const formulaTrigger = /^[=+\-@\t\r]/

export const escapeCsvCell = (value: string) => {
  const safe = formulaTrigger.test(value) ? `'${value}` : value

  // RFC 4180. Pattern text routinely contains commas ("At 10:00 AM, day 13 of every month").
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// The BOM is what makes Excel on Windows read the file as UTF-8 instead of Windows-1252, which
// would otherwise mangle accented folder and process names. CRLF line endings per RFC 4180.
export const toCsv = (rows: string[][]) =>
  `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`

export const inventoryExportFilename = (tenantName: string, now: Date = new Date()) => {
  const slug =
    tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tenant'

  // Viewer's local date — the day the file was made, not any trigger's zone.
  return `process-schedules-${slug}-${isoDateInZone(now)}.csv`
}

// The only impure part, kept apart so tests can stub it. The link must be in the document for
// Firefox to honour the click; the object URL is revoked on the next tick, once the download began.
export const downloadCsv = (filename: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
