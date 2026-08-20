import type { CSSProperties } from 'react'
import { memo, useMemo } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatRunCount } from '../formatters'
import {
  buildDensitySegments,
  groupAccentStyle,
} from '../calendarDisplay'
import { getLifecycleStatus, isLifecycleAttention, lifecycleEndLabel } from '../scheduleUtils'
import type { ScheduleOccurrence } from '../scheduleUtils'
import type { CalendarSpanBar, ProcessDayGroup, ViewMode } from '../types'

export const DetailTimelineTrack = memo(function DetailTimelineTrack({
  occurrences,
}: {
  occurrences: ScheduleOccurrence[]
}) {
  const segments = useMemo(() => buildDensitySegments(occurrences), [occurrences])

  return (
    <span className="detail-timeline-track" aria-hidden="true">
      {segments.map((segment, index) => (
        <span
          key={`${segment.left}-${index}`}
          className="detail-timeline-tick"
          style={{ left: `${segment.left}%` }}
        />
      ))}
    </span>
  )
})

export const ProcessTimelineRow = memo(function ProcessTimelineRow({
  item,
  onOpen,
  viewMode,
  compact = false,
}: {
  item: ProcessDayGroup
  onOpen: (item: ProcessDayGroup) => void
  viewMode: ViewMode
  compact?: boolean
}) {
  const timingLabel = item.runCount > 1 ? formatRunCount(item.runCount) : item.firstOccurrence.timeLabel
  const title = `${item.schedule.Name} · ${item.patternLabel} · ${timingLabel}`
  const rowModeClass = `mode-${viewMode}`
  const lifecycleStatus = getLifecycleStatus(item.schedule)
  const lifecycleStopDate =
    isLifecycleAttention(lifecycleStatus) && item.schedule.StopProcessDate
      ? new Date(item.schedule.StopProcessDate)
      : null
  const lifecycleSuffix = lifecycleStopDate
    ? ` · ${lifecycleEndLabel(item.schedule, lifecycleStopDate)}`
    : ''

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`process-row ${rowModeClass} ${compact ? 'compact' : ''} ${item.schedule.Enabled ? '' : 'is-disabled'}`}
          onClick={() => onOpen(item)}
          style={groupAccentStyle(item)}
          type="button"
        >
          <span className="process-row-copy">
            {lifecycleStopDate ? (
              <span className={`lifecycle-dot lifecycle-${lifecycleStatus}`} aria-hidden="true" />
            ) : null}
            <span className="process-row-title">{item.schedule.Name}</span>
            <span className="process-row-meta">
              <span className="bucket-dot" aria-hidden="true" />
              {item.bucketLabel}
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{`Show exact runs for ${title}${lifecycleSuffix}`}</TooltipContent>
    </Tooltip>
  )
})

export const ProcessSpanBar = memo(function ProcessSpanBar({
  bar,
  onOpen,
}: {
  bar: CalendarSpanBar
  onOpen: (item: ProcessDayGroup) => void
}) {
  const { item } = bar
  const title = `${item.schedule.Name} · ${item.patternLabel} · ${bar.timingLabel}`
  const lifecycleStatus = getLifecycleStatus(item.schedule)
  const lifecycleStopDate =
    isLifecycleAttention(lifecycleStatus) && item.schedule.StopProcessDate
      ? new Date(item.schedule.StopProcessDate)
      : null
  const lifecycleSuffix = lifecycleStopDate
    ? ` · ${lifecycleEndLabel(item.schedule, lifecycleStopDate)}`
    : ''

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`calendar-span-bar ${item.schedule.Enabled ? '' : 'is-disabled'}`}
          onClick={() => onOpen(item)}
          style={
            {
              ...groupAccentStyle(item),
              '--span-offset': `${bar.lane * 18}px`,
              '--week-span-offset': `${bar.lane * 29}px`,
              gridColumn: `${bar.startColumn} / span ${bar.spanDays}`,
              gridRow: `${bar.weekIndex + 2}`,
            } as CSSProperties
          }
          type="button"
        >
          <span className="calendar-span-copy">
            {lifecycleStopDate ? (
              <span className={`lifecycle-dot lifecycle-${lifecycleStatus}`} aria-hidden="true" />
            ) : null}
            <span className="calendar-span-title">{item.schedule.Name}</span>
            <span className="calendar-span-meta">{item.bucketLabel}</span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{`Show exact runs for ${title}${lifecycleSuffix}`}</TooltipContent>
    </Tooltip>
  )
})
