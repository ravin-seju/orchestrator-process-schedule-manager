import { X } from 'lucide-react'
import {
  classifyRecurrenceBucket,
  folderColorVars,
  groupAccentStyle,
  groupOccurrencesBySchedule,
} from '../calendarDisplay'
import { maxDetailTimeChips, maxHighFrequencyDetailTimeChips, recurrenceBucketLabels } from '../constants'
import { formatNumber } from '../formatters'
import { shortDateLabel, timeLabel } from '../scheduleUtils'
import type { ScheduleOccurrence } from '../scheduleUtils'
import type { ProcessDayGroup, SelectedDayDetail, UpcomingDisplayItem } from '../types'

const scopedDetailTitle = (selectedDay: SelectedDayDetail) => {
  if (selectedDay.scope === 'schedule' || selectedDay.scheduleKey) return 'Trigger Details'
  if (selectedDay.scope === 'time-slot' || typeof selectedDay.minuteOfDay === 'number') return 'Time Slot'
  if (
    selectedDay.scope === 'time-range' ||
    (typeof selectedDay.startMinute === 'number' && typeof selectedDay.endMinute === 'number')
  ) {
    return 'Dense Window'
  }

  return 'Day Details'
}

const minuteLabel = (date: Date, minuteOfDay: number) => {
  const minuteDate = new Date(date)
  minuteDate.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0)
  return timeLabel(minuteDate)
}

const scopedDetailContext = (selectedDay: SelectedDayDetail) => {
  const dateLabel = shortDateLabel(selectedDay.date)

  if (typeof selectedDay.minuteOfDay === 'number') {
    return `${dateLabel} · ${minuteLabel(selectedDay.date, selectedDay.minuteOfDay)}`
  }

  if (typeof selectedDay.startMinute === 'number' && typeof selectedDay.endMinute === 'number') {
    return `${dateLabel} · ${minuteLabel(selectedDay.date, selectedDay.startMinute)}-${minuteLabel(
      selectedDay.date,
      selectedDay.endMinute,
    )}`
  }

  return dateLabel
}

export function UpcomingPill({
  item,
  onOpen,
}: {
  item: UpcomingDisplayItem
  onOpen: (item: ProcessDayGroup) => void
}) {
  const { schedule } = item
  const timingLabel = item.runCount > 1 ? `Next ${item.firstOccurrence.timeLabel}` : item.firstOccurrence.timeLabel

  return (
    <button
      className={`upcoming-item ${schedule.Enabled ? '' : 'is-disabled'}`}
      onClick={() => onOpen(item)}
      style={groupAccentStyle(item)}
      type="button"
      title={`Show exact runs for ${schedule.Name}`}
    >
      <div className="upcoming-copy">
        <h3>{schedule.Name}</h3>
        <p>
          {item.bucketLabel} · {schedule.folderName}
        </p>
      </div>
      <time className="upcoming-time">{timingLabel}</time>
    </button>
  )
}

export function DayDetailsPanel({
  selectedDay,
  occurrences,
  onClose,
}: {
  selectedDay: SelectedDayDetail
  occurrences: ScheduleOccurrence[]
  onClose: () => void
}) {
  const groups = groupOccurrencesBySchedule(occurrences).sort((a, b) => {
    if (a.key === selectedDay.scheduleKey) return -1
    if (b.key === selectedDay.scheduleKey) return 1
    return a.occurrences[0].date.getTime() - b.occurrences[0].date.getTime()
  })
  const title = scopedDetailTitle(selectedDay)
  const context = scopedDetailContext(selectedDay)

  return (
    <aside className="upcoming-panel day-detail-panel">
      <div className="section-heading">
        <div className="section-title-line">
          <h2>{title}</h2>
          <span aria-hidden="true">·</span>
          <span>{context}</span>
        </div>
        <button className="icon-button detail-close-button" onClick={onClose} type="button" aria-label="Close details">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="day-detail-list">
        {groups.length ? (
          groups.map((group) => {
            const bucket = classifyRecurrenceBucket(group.schedule, group.occurrences)
            const visibleTimeLimit =
              bucket === 'minute' || bucket === 'hourly' ? maxHighFrequencyDetailTimeChips : maxDetailTimeChips
            const visibleOccurrences = group.occurrences.slice(0, visibleTimeLimit)
            const hiddenOccurrenceCount = Math.max(0, group.occurrences.length - visibleOccurrences.length)

            return (
              <section
                className="day-detail-group"
                key={group.key}
                style={folderColorVars(group.schedule.folderName)}
              >
                <div className="day-detail-group-heading">
                  <div>
                    <h3>{group.schedule.Name}</h3>
                    <p>{recurrenceBucketLabels[bucket]} · {group.schedule.folderName}</p>
                  </div>
                </div>
                <div className="time-chip-list">
                  {visibleOccurrences.map((occurrence) => (
                    <span key={`${occurrence.id}-detail`}>{occurrence.timeLabel}</span>
                  ))}
                  {hiddenOccurrenceCount ? (
                    <span className="time-chip-overflow">+{formatNumber(hiddenOccurrenceCount)} more</span>
                  ) : null}
                </div>
              </section>
            )
          })
        ) : (
          <div className="empty-state">No triggers match this selection.</div>
        )}
      </div>
      <button className="text-button return-button" onClick={onClose} type="button">
        Back to Upcoming
      </button>
    </aside>
  )
}
