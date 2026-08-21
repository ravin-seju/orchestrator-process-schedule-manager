import { Hourglass, X } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  classifyRecurrenceBucket,
  folderColorVars,
  groupAccentStyle,
  groupOccurrencesBySchedule,
} from '../calendarDisplay'
import { maxDetailTimeChips, maxHighFrequencyDetailTimeChips, maxInlineDetailMachines, recurrenceBucketLabels } from '../constants'
import { formatNumber } from '../formatters'
import {
  getLifecycleStatus,
  lifecycleEndLabel,
  lifecycleMarkerTone,
  resolveMachineNames,
  resolveRobotNames,
  scheduleStopDate,
  shortDateLabel,
  timeLabel,
} from '../scheduleUtils'
import type { ScheduleOccurrence } from '../scheduleUtils'
import type { ProcessDayGroup, RuntimeStats, SelectedDayDetail, UpcomingDisplayItem } from '../types'

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

const runtimeMinutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60))

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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`upcoming-item ${schedule.Enabled ? '' : 'is-disabled'}`}
          onClick={() => onOpen(item)}
          style={groupAccentStyle(item)}
          type="button"
        >
          <div className="upcoming-copy">
            <h3>{schedule.Name}</h3>
            <p>
              {item.bucketLabel} · {schedule.folderName}
            </p>
          </div>
          <time className="upcoming-time">{timingLabel}</time>
        </button>
      </TooltipTrigger>
      <TooltipContent>{`Show exact runs for ${schedule.Name}`}</TooltipContent>
    </Tooltip>
  )
}

export function DayDetailsPanel({
  selectedDay,
  occurrences,
  horizonDays,
  onClose,
  runtimeStats,
  robotNames,
  machineNames,
  scheduleMachineIds,
}: {
  selectedDay: SelectedDayDetail
  occurrences: ScheduleOccurrence[]
  horizonDays?: number
  onClose: () => void
  runtimeStats?: Map<number, RuntimeStats>
  robotNames?: Map<number, string>
  machineNames?: Map<number, string>
  scheduleMachineIds?: Map<number, number[]>
}) {
  // Run info (stats + robot/machine) renders when its maps are present; SchedulePlanner
  // supplies them, so any map being present signals there is run info to show.
  const showRunInfo =
    runtimeStats !== undefined ||
    robotNames !== undefined ||
    machineNames !== undefined ||
    scheduleMachineIds !== undefined
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
            const timeZone = group.schedule.TimeZoneIana ?? group.schedule.TimeZoneId
            const stats = showRunInfo ? runtimeStats?.get(group.schedule.Id) : undefined
            const robots = showRunInfo ? resolveRobotNames(group.schedule, robotNames) : []
            const groupMachines = showRunInfo
              ? resolveMachineNames(group.schedule.Id, scheduleMachineIds, machineNames)
              : []
            const lifecycleStatus = getLifecycleStatus(group.schedule, undefined, horizonDays)
            const lifecycleStopDate = scheduleStopDate(group.schedule)
            const lifecycleTone = lifecycleMarkerTone(group.schedule, undefined, horizonDays)
            const lifecycleIsSoon = lifecycleTone === 'amber'
            // Only label a strategy Orchestrator actually reported. StopStrategy is optional, so a
            // two-way `=== 'Kill'` test would render an unset strategy as a configured "Soft Stop".
            const stopStrategyLabel =
              group.schedule.StopStrategy === 'Kill'
                ? 'Kill'
                : group.schedule.StopStrategy === 'SoftStop'
                  ? 'Soft Stop'
                  : null

            return (
              <section
                className="day-detail-group"
                key={group.key}
                style={folderColorVars(group.schedule.folderName)}
              >
                <div className="day-detail-group-heading">
                  {lifecycleTone && lifecycleStopDate ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`lifecycle-badge lifecycle-${lifecycleStatus}${lifecycleIsSoon ? '' : ' is-later'}`}
                          role="img"
                          aria-label={lifecycleEndLabel(group.schedule, lifecycleStopDate)}
                        >
                          <Hourglass size={12} aria-hidden="true" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{lifecycleEndLabel(group.schedule, lifecycleStopDate)}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <div>
                    <h3>{group.schedule.Name}</h3>
                    <p>{recurrenceBucketLabels[bucket]} · {group.schedule.folderName}</p>
                  </div>
                </div>
                {timeZone || showRunInfo || group.schedule.StopProcessDate ? (
                  <div className="day-detail-meta">
                    {timeZone ? <p>Time zone: {timeZone}</p> : null}
                    {group.schedule.StopProcessDate ? (
                      <p>
                        {lifecycleStatus === 'expired' ? 'Ended on ' : 'Ends '}
                        {shortDateLabel(new Date(group.schedule.StopProcessDate), timeZone)}
                        {stopStrategyLabel ? ` · ${stopStrategyLabel}` : ''}
                      </p>
                    ) : null}
                    {showRunInfo ? (
                      stats ? (
                        <>
                          <p>
                            Runtime · based on {formatNumber(stats.sampleSize)} runs
                          </p>
                          <p className="day-detail-meta-sub">
                            Typical {runtimeMinutes(stats.medianSec)}m · Worst case (p90){' '}
                            {runtimeMinutes(stats.p90Sec)}m
                          </p>
                        </>
                      ) : (
                        <p>No recent run history</p>
                      )
                    ) : null}
                    {robots.length ? <p>Robot: {robots.join(', ')}</p> : null}
                    {groupMachines.length ? (
                      <p>
                        Machine:{' '}
                        {groupMachines.length > maxInlineDetailMachines ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="day-detail-meta-more" type="button">
                                {formatNumber(groupMachines.length)} machines (dynamic pool)
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{groupMachines.join(', ')}</TooltipContent>
                          </Tooltip>
                        ) : (
                          groupMachines.join(', ')
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
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
