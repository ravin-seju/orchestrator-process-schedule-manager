import { ChevronLeft, ChevronRight } from 'lucide-react'
import { maxUpcomingItemsPerGroup } from '../constants'
import { formatNumber } from '../formatters'
import type { ProcessDayGroup, RuntimeStats, SelectedDayDetail, UpcomingDisplayGroup } from '../types'
import type { ScheduleOccurrence } from '../scheduleUtils'
import { DayDetailsPanel, UpcomingPill } from './index'

export function UpcomingPanel({
  activeSelectedDayDetail,
  disabledCount,
  enabledCount,
  isExpanded,
  onCloseDayDetails,
  onToggleExpanded,
  onOpenDay,
  onOpenDayDetail,
  selectedDayOccurrences,
  upcomingDisplayGroups,
  runtimeStats,
  robotNames,
  machineNames,
  scheduleMachineIds,
}: {
  activeSelectedDayDetail: SelectedDayDetail | null
  disabledCount: number
  enabledCount: number
  isExpanded: boolean
  onCloseDayDetails: () => void
  onToggleExpanded: () => void
  onOpenDay: (detail: SelectedDayDetail) => void
  onOpenDayDetail: (item: ProcessDayGroup) => void
  selectedDayOccurrences: ScheduleOccurrence[]
  upcomingDisplayGroups: UpcomingDisplayGroup[]
  runtimeStats?: Map<number, RuntimeStats>
  robotNames?: Map<number, string>
  machineNames?: Map<number, string>
  scheduleMachineIds?: Map<number, number[]>
}) {
  if (!isExpanded && !activeSelectedDayDetail) {
    return (
      <aside className="upcoming-panel is-collapsed" aria-label="Upcoming collapsed">
        <button
          aria-label="Expand Upcoming pane"
          className="upcoming-collapsed-button"
          onClick={onToggleExpanded}
          type="button"
        >
          <ChevronLeft size={14} strokeWidth={0.9} aria-hidden="true" />
          <span className="upcoming-collapsed-label">Upcoming</span>
        </button>
      </aside>
    )
  }

  if (activeSelectedDayDetail) {
    return (
      <DayDetailsPanel
        selectedDay={activeSelectedDayDetail}
        occurrences={selectedDayOccurrences}
        onClose={onCloseDayDetails}
        runtimeStats={runtimeStats}
        robotNames={robotNames}
        machineNames={machineNames}
        scheduleMachineIds={scheduleMachineIds}
      />
    )
  }

  return (
    <aside className="upcoming-panel">
      <div className="section-heading">
        <div className="section-title-line">
          <h2>Upcoming</h2>
          <span aria-hidden="true">·</span>
          <span>Next 7 days</span>
        </div>
        <button
          aria-label="Collapse Upcoming pane"
          className="icon-button"
          onClick={onToggleExpanded}
          type="button"
        >
          <ChevronRight size={14} strokeWidth={0.9} aria-hidden="true" />
        </button>
      </div>
      <div className="upcoming-list">
        {upcomingDisplayGroups.length ? (
          upcomingDisplayGroups.map((group) => {
            const visibleItems = group.items.slice(0, maxUpcomingItemsPerGroup)
            const hiddenCount = Math.max(0, group.items.length - visibleItems.length)
            const firstItem = group.items[0]

            return (
              <section className="upcoming-group" key={group.key}>
                <h3>{group.label}</h3>
                <div className="upcoming-group-list">
                  {visibleItems.map((item) => (
                    <UpcomingPill key={`${item.id}-upcoming`} item={item} onOpen={onOpenDayDetail} />
                  ))}
                  {hiddenCount && firstItem ? (
                    <button
                      className="upcoming-more"
                      onClick={() => onOpenDay({ key: group.key, date: firstItem.date, scope: 'day' })}
                      type="button"
                    >
                      +{formatNumber(hiddenCount)} more
                    </button>
                  ) : null}
                </div>
              </section>
            )
          })
        ) : (
          <div className="empty-state">No upcoming triggers match the current filters.</div>
        )}
      </div>
      <div className="status-split">
        <span>{formatNumber(enabledCount)} enabled</span>
        <span>{formatNumber(disabledCount)} disabled</span>
      </div>
    </aside>
  )
}
