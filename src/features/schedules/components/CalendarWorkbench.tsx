import { ChevronLeft, ChevronRight } from 'lucide-react'
import { memo } from 'react'
import type { CSSProperties, RefObject } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  monthSpanLaneStepPx,
  viewModeDescriptions,
  viewModeLabels,
  viewModes,
  weekdayLabels,
} from '../constants'
import { formatNumber } from '../formatters'
import { dateKey } from '../scheduleUtils'
import type {
  CalendarDisplayItem,
  CalendarSpanBar,
  CalendarViewMode,
  ProcessDayGroup,
  RuntimeStats,
  SelectedDayDetail,
  ViewMode,
} from '../types'
import { OutlookWeekView } from './OutlookWeekView'
import { ProcessSpanBar, ProcessTimelineRow, YearCalendar } from './index'

const CalendarDayCell = memo(function CalendarDayCell({
  calendarMode,
  calendarRenderMode,
  day,
  dayDisplayItems,
  dayKey,
  onOpenDayDetail,
  setSelectedDayDetail,
  shouldRenderSpanBars,
  todayKey,
  viewDate,
  visibleSpanLaneLimit,
}: {
  calendarMode: CalendarViewMode
  calendarRenderMode: ViewMode
  day: Date
  dayDisplayItems: CalendarDisplayItem[]
  dayKey: string
  onOpenDayDetail: (item: ProcessDayGroup) => void
  setSelectedDayDetail: (detail: SelectedDayDetail) => void
  shouldRenderSpanBars: boolean
  todayKey: string
  viewDate: Date
  visibleSpanLaneLimit: number
}) {
  const visibleItems =
    shouldRenderSpanBars
      ? []
      : calendarMode === 'week'
        ? dayDisplayItems
        : dayDisplayItems.slice(0, visibleSpanLaneLimit)
  const hiddenItemCount =
    shouldRenderSpanBars
      ? Math.max(0, dayDisplayItems.length - visibleSpanLaneLimit)
      : calendarMode === 'month'
        ? Math.max(0, dayDisplayItems.length - visibleSpanLaneLimit)
        : 0
  const isOutsideMonth = calendarMode === 'month' && day.getMonth() !== viewDate.getMonth()
  const isToday = dayKey === todayKey

  return (
    <div className={`calendar-day ${isOutsideMonth ? 'muted' : ''} ${isToday ? 'today' : ''}`}>
      <div className="day-number">{day.getDate()}</div>
      <div className="day-events">
        {visibleItems.map((item) => (
          <ProcessTimelineRow
            compact={calendarMode === 'month'}
            item={item}
            key={item.id}
            onOpen={onOpenDayDetail}
            viewMode={calendarRenderMode}
          />
        ))}
        {hiddenItemCount > 0 ? (
          <button
            className="more-count"
            onClick={() => setSelectedDayDetail({ key: dayKey, date: day, scope: 'day' })}
            type="button"
          >
            <span className="overflow-label-text">+{formatNumber(hiddenItemCount)} more</span>
          </button>
        ) : null}
      </div>
    </div>
  )
})

export const CalendarWorkbench = memo(function CalendarWorkbench({
  calendarDays,
  calendarGridRef,
  calendarItemsByDay,
  calendarMode,
  calendarRenderMode,
  calendarTitle,
  calendarWeekCount,
  moveCalendar,
  navigationUnitLabel,
  onOpenDayDetail,
  onOpenMonthFromYear,
  runtimeStats,
  setCalendarMode,
  setSelectedDayDetail,
  setViewMode,
  setViewDate,
  shouldRenderSpanBars,
  spanBars,
  todayKey,
  viewMode,
  viewDate,
  visibleSpanLaneLimit,
  yearMonths,
}: {
  calendarDays: Date[]
  calendarGridRef: RefObject<HTMLDivElement | null>
  calendarItemsByDay: Map<string, CalendarDisplayItem[]>
  calendarMode: CalendarViewMode
  calendarRenderMode: ViewMode
  calendarTitle: string
  calendarWeekCount: number
  moveCalendar: (delta: number) => void
  navigationUnitLabel: string
  onOpenDayDetail: (item: ProcessDayGroup) => void
  onOpenMonthFromYear: (month: Date) => void
  runtimeStats?: Map<number, RuntimeStats>
  setCalendarMode: (mode: CalendarViewMode) => void
  setSelectedDayDetail: (detail: SelectedDayDetail) => void
  setViewMode: (mode: ViewMode) => void
  setViewDate: (date: Date) => void
  shouldRenderSpanBars: boolean
  spanBars: CalendarSpanBar[]
  todayKey: string
  viewMode: ViewMode
  viewDate: Date
  visibleSpanLaneLimit: number
  yearMonths: Date[]
}) {
  const shouldRenderOutlookWeek = calendarMode === 'week'
  const spanMoreTop = 22 + visibleSpanLaneLimit * monthSpanLaneStepPx

  return (
    <div className="calendar-panel">
      <div className="calendar-toolbar">
          <div className="calendar-toolbar-copy">
            <div className="section-title-line">
              <button
                className="title-nav-button"
                onClick={() => moveCalendar(-1)}
                type="button"
                aria-label={`Previous ${navigationUnitLabel}`}
              >
                <ChevronLeft size={12} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <h2>{calendarTitle}</h2>
              <button
                className="title-nav-button"
                onClick={() => moveCalendar(1)}
                type="button"
                aria-label={`Next ${navigationUnitLabel}`}
              >
                <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="calendar-toolbar-actions">
            {calendarMode !== 'year' && !shouldRenderOutlookWeek ? (
              <div className="view-mode-control">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="View mode info"
                      className="view-mode-help"
                      type="button"
                    />
                  </TooltipTrigger>
                  <TooltipContent className="view-mode-tooltip-content" align="start">
                    {viewModes.map((mode) => (
                      <span className="view-mode-tooltip-row" key={mode}>
                        <b>{viewModeLabels[mode]}</b>
                        <span>{viewModeDescriptions[mode]}</span>
                      </span>
                    ))}
                  </TooltipContent>
                </Tooltip>
                <span className="view-mode-label">Layout:</span>
                <Select value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
                  <SelectTrigger
                    aria-label="Trigger layout"
                    className="view-mode-select-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {viewModes.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {viewModeLabels[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <ToggleGroup
              aria-label="Calendar view"
              className="calendar-view-toggle"
              onValueChange={(value) => {
                if (value) setCalendarMode(value as CalendarViewMode)
              }}
              type="single"
              value={calendarMode}
            >
              {(['year', 'month', 'week'] as CalendarViewMode[]).map((mode) => (
                <ToggleGroupItem
                  key={mode}
                  value={mode}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="month-actions">
              <button
                className="text-button today-button"
                onClick={() => setViewDate(new Date())}
                type="button"
              >
                Today
              </button>
            </div>
          </div>
        </div>

      {calendarMode === 'year' ? (
        <YearCalendar
          months={yearMonths}
          calendarItemsByDay={calendarItemsByDay}
          todayKey={todayKey}
          onOpenDay={(detail) => {
            setViewDate(detail.date)
            setCalendarMode('week')
            setSelectedDayDetail(detail)
          }}
          onOpenMonth={onOpenMonthFromYear}
        />
      ) : shouldRenderOutlookWeek ? (
        <OutlookWeekView
          calendarDays={calendarDays}
          calendarItemsByDay={calendarItemsByDay}
          onOpenDayDetail={onOpenDayDetail}
          onOpenTimeSlot={setSelectedDayDetail}
          runtimeStats={runtimeStats}
          todayKey={todayKey}
        />
      ) : (
        <div
          ref={calendarGridRef}
          className={`calendar-grid ${calendarMode} view-${calendarRenderMode}`}
          style={
            {
              '--calendar-week-count': String(calendarWeekCount),
              '--calendar-week-size': `${100 / calendarWeekCount}%`,
              '--span-more-top': `${spanMoreTop}px`,
            } as CSSProperties
          }
        >
          {calendarDays.slice(0, 7).map((day, index) => (
            <div
              className="weekday"
              key={`${calendarMode}-${dateKey(day)}-heading`}
            >
              <span>{weekdayLabels[index]}</span>
            </div>
          ))}
          {calendarDays.map((day) => {
            const key = dateKey(day)
            const dayDisplayItems = calendarItemsByDay.get(key) ?? []

            return (
              <CalendarDayCell
                calendarMode={calendarMode}
                calendarRenderMode={calendarRenderMode}
                day={day}
                dayDisplayItems={dayDisplayItems}
                dayKey={key}
                key={key}
                onOpenDayDetail={onOpenDayDetail}
                setSelectedDayDetail={setSelectedDayDetail}
                shouldRenderSpanBars={shouldRenderSpanBars}
                todayKey={todayKey}
                viewDate={viewDate}
                visibleSpanLaneLimit={visibleSpanLaneLimit}
              />
            )
          })}
          {shouldRenderSpanBars
            ? spanBars.map((bar) => (
                <ProcessSpanBar bar={bar} key={bar.id} onOpen={onOpenDayDetail} />
              ))
            : null}
        </div>
      )}
    </div>
  )
})
