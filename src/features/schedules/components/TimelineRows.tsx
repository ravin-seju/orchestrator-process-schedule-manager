import type { CSSProperties } from 'react'
import { memo, useMemo } from 'react'
import { formatRunCount } from '../formatters'
import {
  buildDensitySegments,
  groupAccentStyle,
} from '../calendarDisplay'
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

  return (
    <button
      className={`process-row ${rowModeClass} ${compact ? 'compact' : ''} ${item.schedule.Enabled ? '' : 'is-disabled'}`}
      onClick={() => onOpen(item)}
      style={groupAccentStyle(item)}
      type="button"
      title={`Show exact runs for ${title}`}
    >
      <span className="process-row-copy">
        <span className="process-row-title">{item.schedule.Name}</span>
        <span className="process-row-meta">
          <span className="bucket-dot" aria-hidden="true" />
          {item.bucketLabel}
        </span>
      </span>
    </button>
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

  return (
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
      title={`Show exact runs for ${title}`}
    >
      <span className="calendar-span-copy">
        <span className="calendar-span-title">{item.schedule.Name}</span>
        <span className="calendar-span-meta">{item.bucketLabel}</span>
      </span>
    </button>
  )
})
