import { memo } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { folderColorVars, yearDayTitle } from '../calendarDisplay'
import { weekdayLabels, yearMonthFormatter } from '../constants'
import { formatNumber } from '../formatters'
import {
  dateKey,
  getCalendarDays,
} from '../scheduleUtils'
import type { CalendarDisplayItem, SelectedDayDetail } from '../types'

export const YearCalendar = memo(function YearCalendar({
  months,
  calendarItemsByDay,
  todayKey,
  onOpenDay,
  onOpenMonth,
}: {
  months: Date[]
  calendarItemsByDay: Map<string, CalendarDisplayItem[]>
  todayKey: string
  onOpenDay: (day: SelectedDayDetail) => void
  onOpenMonth: (month: Date) => void
}) {
  return (
    <div className="year-grid" aria-label="Year calendar">
      {months.map((month) => {
        const days = getCalendarDays(month)

        return (
          <Tooltip key={`${month.getFullYear()}-${month.getMonth()}`}>
            <TooltipTrigger asChild>
              <section
                className="year-month"
                onClick={() => onOpenMonth(month)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpenMonth(month)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <h3>{yearMonthFormatter.format(month)}</h3>
                <div className="year-weekdays" aria-hidden="true">
                  {weekdayLabels.map((label) => (
                    <span key={`${month.getMonth()}-${label}`}>{label.slice(0, 1)}</span>
                  ))}
                </div>
                <div className="year-month-grid">
                  {days.map((day) => {
                    const key = dateKey(day)
                    const items = calendarItemsByDay.get(key) ?? []
                    const isMuted = day.getMonth() !== month.getMonth()
                    const hasItems = !isMuted && items.length > 0
                    const isToday = key === todayKey
                    const dayClassName = `year-day ${isMuted ? 'muted' : ''} ${isToday ? 'today' : ''} ${hasItems ? 'has-events' : ''}`
                    const dayContent = (
                      <>
                        <span className="year-day-number">{isMuted ? '' : day.getDate()}</span>
                        {hasItems ? (
                          <span className="year-day-markers" aria-hidden="true">
                            {items.slice(0, 3).map((item) => (
                              // Decorative dots are aria-hidden and the densest site (~3/day);
                              // kept as native title (no a11y value) to avoid per-dot Tooltip cost.
                              <i
                                key={item.id}
                                title={item.schedule.folderName}
                                style={folderColorVars(item.schedule.folderName)}
                              />
                            ))}
                            {items.length > 3 ? <b>+{formatNumber(items.length - 3)}</b> : null}
                          </span>
                        ) : null}
                      </>
                    )

                    return hasItems ? (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <button
                            className={dayClassName}
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenDay({ key, date: day, scope: 'day' })
                            }}
                            type="button"
                          >
                            {dayContent}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{yearDayTitle(day, items)}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <div className={dayClassName} key={key}>
                        {dayContent}
                      </div>
                    )
                  })}
                </div>
              </section>
            </TooltipTrigger>
            <TooltipContent>{`Open ${yearMonthFormatter.format(month)} ${month.getFullYear()}`}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})
