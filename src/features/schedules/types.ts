import type { ProcessSchedule, TenantInfo } from './orchestrator'
import type { ScheduleOccurrence } from './scheduleUtils'

export type StatusFilter = 'all' | 'enabled' | 'disabled'
export type AttentionFilter = 'none' | 'duplicates' | 'stale' | 'collisions'
export type CalendarViewMode = 'year' | 'month' | 'week'
export type WorkspaceView = 'calendar' | 'inventory'
export type ViewMode = 'spanBars' | 'timeBlocks'
export type RecurrenceBucket = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'queue' | 'other'
export type TriggerTypeFilter = 'all' | RecurrenceBucket
export type StressScheduleCount = 5 | 10 | 50 | 100
export type DensitySegment = { left: number }
export type TenantOption = TenantInfo & { kind: 'live' | 'stress'; stressCount?: StressScheduleCount }
export type ScheduleSearchEntry = { schedule: ProcessSchedule; searchText: string }

export interface ProcessDayGroup {
  type: 'process-day'
  id: string
  date: Date
  scheduleKey: string
  schedule: ProcessSchedule
  occurrences: ScheduleOccurrence[]
  bucket: RecurrenceBucket
  bucketLabel: string
  patternLabel: string
  firstOccurrence: ScheduleOccurrence
  lastOccurrence: ScheduleOccurrence
  runCount: number
  densitySegments: DensitySegment[]
}

export type CalendarDisplayItem = ProcessDayGroup
export type UpcomingDisplayItem = ProcessDayGroup
export type UpcomingDisplayGroup = {
  key: string
  label: string
  items: UpcomingDisplayItem[]
}

export type CalendarSpanBar = {
  id: string
  item: ProcessDayGroup
  startColumn: number
  spanDays: number
  weekIndex: number
  lane: number
  dayCount: number
  totalRuns: number
  timingLabel: string
}

export type SpanBarLayout = {
  bars: CalendarSpanBar[]
  hiddenCountByDay: Map<string, number>
}

export interface OutlookWeekTimedEvent {
  id: string
  item: ProcessDayGroup
  occurrence: ScheduleOccurrence
  dayKey: string
  startMinute: number
  endMinute: number
  columnIndex: number
  columnCount: number
}

export interface OutlookWeekDenseSummary {
  id: string
  item: ProcessDayGroup
  dayKey: string
}

export interface OutlookWeekDay {
  date: Date
  key: string
  timedEvents: OutlookWeekTimedEvent[]
  denseSummaries: OutlookWeekDenseSummary[]
}

export interface OutlookWeekLayout {
  days: OutlookWeekDay[]
}

export type SelectedDayDetailScope = 'day' | 'schedule' | 'time-range' | 'time-slot'

export type SelectedDayDetail = {
  key: string
  date: Date
  endMinute?: number
  minuteOfDay?: number
  scheduleKey?: string
  scheduleKeys?: string[]
  scope?: SelectedDayDetailScope
  startMinute?: number
}

export interface MachineInventoryEntry {
  id: number
  name: string
  type: string
  state: 'Available' | 'Busy' | 'Disconnected' | 'Unresponsive' | 'Unknown'
  lastReportingTime: string | null
}

export interface RuntimeStats {
  medianSec: number
  p90Sec: number
  sampleSize: number
}
