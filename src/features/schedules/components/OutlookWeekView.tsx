import type { CSSProperties } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp } from 'lucide-react'
import {
  buildOutlookWeekLayout,
  groupAccentStyle,
} from '../calendarDisplay'
import { formatNumber, formatRunCount } from '../formatters'
import { weekdayLabels } from '../constants'
import { getLifecycleStatus, isLifecycleAttention, lifecycleEndLabel, scheduleStopDate, timeLabel } from '../scheduleUtils'
import type { CalendarDisplayItem, OutlookWeekTimedEvent, ProcessDayGroup, RuntimeStats, SelectedDayDetail } from '../types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const outlookHourHeight = 64
const initialScrollHour = 8
const hours = Array.from({ length: 24 }, (_, hour) => hour)
const maxAllDayVisibleBlocks = 2
const maxExpandedAllDayVisibleLanes = 6
const maxSameTimeVisibleBlocks = 2
const denseTimedClusterWindowMinutes = 60
const denseTimedClusterEventThreshold = 8
const denseTimedClusterOverflowThreshold = 3
const denseTimedClusterLaneThreshold = 2
const minTimedEventHeight = 17
const minReadableTimedChipWidth = 96
const timedOverflowLabelWidth = 44
const timedOverflowEdgeOffset = 2
const timedOverflowReservedWidth = timedOverflowLabelWidth + timedOverflowEdgeOffset

type OutlookAllDaySpan = {
  id: string
  item: ProcessDayGroup
  startColumn: number
  spanDays: number
  lane: number
  totalRuns: number
}

type TimedEventStack = {
  id: string
  hiddenCount: number
  hiddenEvents: OutlookWeekTimedEvent[]
  events: OutlookWeekTimedEvent[]
  timeKey: string
  visibleEvents: OutlookWeekTimedEvent[]
  startMinute: number
  endMinute: number
  columnIndex: number
  columnSpan: number
  columnCount: number
  isSameTimeStack: boolean
  isDenseCluster: boolean
  stackColumnCount: number
}

type LaidOutTimedEventStack = TimedEventStack & {
  laneColumnCount: number
  laneColumnIndex: number
}

const hourLabel = (hour: number) => {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`
}

const dayHeaderLabel = (date: Date) => weekdayLabels[date.getDay()]

const stackMinuteLabel = (stack: TimedEventStack, minuteOfDay: number) => {
  const date = new Date(stack.events[0].occurrence.date)
  date.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0)
  return timeLabel(date)
}

const stackTimeRangeLabel = (stack: TimedEventStack) =>
  `${stackMinuteLabel(stack, stack.startMinute)} to ${stackMinuteLabel(stack, stack.endMinute)}`

const compactStackTimeRangeLabel = (stack: TimedEventStack) =>
  `${stackMinuteLabel(stack, stack.startMinute)}-${stackMinuteLabel(stack, stack.endMinute)}`

const stackBlockHeightPixels = (stack: {
  endMinute: number
  startMinute: number
}) =>
  Math.max(
    minTimedEventHeight,
    ((stack.endMinute - stack.startMinute) / 60) * outlookHourHeight,
  )

const stackHeightPixels = (stack: { endMinute: number; startMinute: number }) => stackBlockHeightPixels(stack)

const stackCollisionEndMinute = (stack: {
  endMinute: number
  startMinute: number
}) => stack.endMinute

const layoutTimedEventStacks = <T extends {
  endMinute: number
  hiddenCount: number
  startMinute: number
}>(stacks: T[]) => {
  const laidOutStacks: Array<T & { laneColumnCount: number; laneColumnIndex: number }> = []

  const flushCluster = (cluster: T[]) => {
    const laneEnds: number[] = []
    const assigned = cluster.map((stack) => {
      const reusableLane = laneEnds.findIndex((endMinute) => stack.startMinute >= endMinute)
      const laneColumnIndex = reusableLane === -1 ? laneEnds.length : reusableLane
      laneEnds[laneColumnIndex] = stackCollisionEndMinute(stack)

      return { laneColumnIndex, stack }
    })
    const laneColumnCount = Math.max(1, laneEnds.length)

    for (const { laneColumnIndex, stack } of assigned) {
      laidOutStacks.push({ ...stack, laneColumnCount, laneColumnIndex })
    }
  }

  let cluster: T[] = []
  let clusterEndMinute = -1

  for (const stack of stacks) {
    if (cluster.length > 0 && stack.startMinute >= clusterEndMinute) {
      flushCluster(cluster)
      cluster = []
      clusterEndMinute = -1
    }

    cluster.push(stack)
    clusterEndMinute = Math.max(clusterEndMinute, stackCollisionEndMinute(stack))
  }

  if (cluster.length > 0) flushCluster(cluster)

  return laidOutStacks
}

const buildSameTimeEventStacks = (events: OutlookWeekTimedEvent[]): TimedEventStack[] => {
  const slotGroups = new Map<string, OutlookWeekTimedEvent[]>()

  for (const event of events) {
    const slotKey = `${event.startMinute}-${event.endMinute}`
    const slotEvents = slotGroups.get(slotKey) ?? []
    slotEvents.push(event)
    slotGroups.set(slotKey, slotEvents)
  }

  return Array.from(slotGroups.entries())
    .map(([slotKey, slotEvents]) => {
      const sortedEvents = [...slotEvents].sort(
        (a, b) =>
          a.item.schedule.Name.localeCompare(b.item.schedule.Name) ||
          a.occurrence.id.localeCompare(b.occurrence.id),
      )
      const firstEvent = sortedEvents[0]
      const isSameTimeStack = sortedEvents.length > 1
      const visibleEvents = isSameTimeStack
        ? sortedEvents.slice(0, maxSameTimeVisibleBlocks)
        : sortedEvents
      const hiddenEvents = isSameTimeStack
        ? sortedEvents.slice(maxSameTimeVisibleBlocks)
        : []
      const hiddenCount = hiddenEvents.length
      const stackColumnCount = visibleEvents.length
      const columnIndex = Math.min(...sortedEvents.map((event) => event.columnIndex))
      const maxColumnIndex = Math.max(...sortedEvents.map((event) => event.columnIndex))
      const columnCount = Math.max(...sortedEvents.map((event) => event.columnCount))

      return {
        id: `${firstEvent.dayKey}-${slotKey}`,
        hiddenCount,
        hiddenEvents,
        events: sortedEvents,
        timeKey: slotKey,
        visibleEvents,
        startMinute: firstEvent.startMinute,
        endMinute: firstEvent.endMinute,
        columnIndex,
        columnSpan: maxColumnIndex - columnIndex + 1,
        columnCount,
        isSameTimeStack,
        isDenseCluster: false,
        stackColumnCount,
      }
    })
    .sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        a.endMinute - b.endMinute ||
        a.events[0].item.schedule.Name.localeCompare(b.events[0].item.schedule.Name),
    )
}

const denseTimedClusterLabel = (cluster: TimedEventStack[]) => {
  const firstStack = cluster[0]
  const lastStack = cluster[cluster.length - 1]

  return `${firstStack.events[0].occurrence.timeLabel}-${lastStack.events[0].occurrence.timeLabel}`
}

const denseTimedCluster = (cluster: TimedEventStack[]): TimedEventStack => {
  const events = cluster
    .flatMap((stack) => stack.events)
    .sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        a.item.schedule.Name.localeCompare(b.item.schedule.Name) ||
        a.occurrence.id.localeCompare(b.occurrence.id),
    )
  const firstEvent = events[0]
  const startMinute = Math.min(...cluster.map((stack) => stack.startMinute))
  const endMinute = Math.max(...cluster.map((stack) => stack.endMinute))

  return {
    id: `${firstEvent.dayKey}-${startMinute}-${endMinute}-dense-cluster-${denseTimedClusterLabel(cluster)}`,
    hiddenCount: events.length,
    hiddenEvents: events,
    events,
    timeKey: `${startMinute}-${endMinute}-dense-cluster`,
    visibleEvents: [],
    startMinute,
    endMinute,
    columnIndex: 0,
    columnSpan: 1,
    columnCount: 1,
    isSameTimeStack: true,
    isDenseCluster: true,
    stackColumnCount: 1,
  }
}

const getSmallestReadableChipWidth = (
  laidOutStacks: LaidOutTimedEventStack[],
  dayColumnWidth: number | null,
) => {
  if (!dayColumnWidth || dayColumnWidth <= 0) return Number.POSITIVE_INFINITY

  return laidOutStacks.reduce((smallestWidth, stack) => {
    if (stack.events.length <= 1) return smallestWidth

    const visibleColumnCount = Math.max(1, stack.stackColumnCount)
    const stackWidth = dayColumnWidth / Math.max(1, stack.laneColumnCount) - 8
    const overflowWidth = stack.hiddenCount > 0 ? timedOverflowReservedWidth : 0
    const gapWidth = Math.max(0, visibleColumnCount - 1)
    const chipWidth = (stackWidth - overflowWidth - gapWidth) / visibleColumnCount

    return Math.min(smallestWidth, chipWidth)
  }, Number.POSITIVE_INFINITY)
}

const shouldDensifyTimedCluster = (
  cluster: TimedEventStack[],
  dayColumnWidth: number | null,
) => {
  const laidOut = layoutTimedEventStacks(cluster)
  const laneColumnCount = Math.max(...laidOut.map((stack) => stack.laneColumnCount))
  const eventCount = cluster.reduce((total, stack) => total + stack.events.length, 0)
  const overflowStackCount = cluster.filter((stack) => stack.hiddenCount > 0).length
  const smallestChipWidth = getSmallestReadableChipWidth(laidOut, dayColumnWidth)

  return (
    (eventCount >= 3 && smallestChipWidth < minReadableTimedChipWidth) ||
    eventCount >= denseTimedClusterEventThreshold ||
    overflowStackCount >= denseTimedClusterOverflowThreshold ||
    laneColumnCount > denseTimedClusterLaneThreshold ||
    (cluster.length >= denseTimedClusterOverflowThreshold && eventCount >= denseTimedClusterEventThreshold)
  )
}

const buildTimedEventStacks = (
  events: OutlookWeekTimedEvent[],
  dayColumnWidth: number | null,
): LaidOutTimedEventStack[] => {
  const stacks = buildSameTimeEventStacks(events)
  const layoutItems: LaidOutTimedEventStack[] = []

  const flushCluster = (cluster: TimedEventStack[]) => {
    if (cluster.length === 0) return

    if (shouldDensifyTimedCluster(cluster, dayColumnWidth)) {
      layoutItems.push({
        ...denseTimedCluster(cluster),
        laneColumnCount: 1,
        laneColumnIndex: 0,
      })
      return
    }

    layoutItems.push(...layoutTimedEventStacks(cluster))
  }

  let cluster: TimedEventStack[] = []
  let clusterStartMinute = -1
  let clusterEndMinute = -1
  let previousStartMinute = -1

  for (const stack of stacks) {
    const isOverlapping = cluster.length > 0 && stack.startMinute < clusterEndMinute
    const isNearbyDenseCandidate =
      cluster.length > 0 &&
      stack.startMinute < clusterStartMinute + denseTimedClusterWindowMinutes &&
      stack.startMinute - previousStartMinute <= stack.endMinute - stack.startMinute

    if (cluster.length > 0 && !isOverlapping && !isNearbyDenseCandidate) {
      flushCluster(cluster)
      cluster = []
      clusterStartMinute = -1
      clusterEndMinute = -1
    }

    if (cluster.length === 0) {
      clusterStartMinute = stack.startMinute
    }

    cluster.push(stack)
    clusterEndMinute = Math.max(clusterEndMinute, stack.endMinute)
    previousStartMinute = stack.startMinute
  }

  flushCluster(cluster)

  return layoutItems
}

const buildAllDaySpans = (days: ReturnType<typeof buildOutlookWeekLayout>['days']) => {
  const denseItemsBySchedule = new Map<string, Map<string, ProcessDayGroup>>()
  const dayKeys = days.map((day) => day.key)

  for (const day of days) {
    for (const summary of day.denseSummaries) {
      let itemsByDay = denseItemsBySchedule.get(summary.item.scheduleKey)
      if (!itemsByDay) {
        itemsByDay = new Map<string, ProcessDayGroup>()
        denseItemsBySchedule.set(summary.item.scheduleKey, itemsByDay)
      }
      itemsByDay.set(day.key, summary.item)
    }
  }

  const segments: Array<Omit<OutlookAllDaySpan, 'lane'>> = []
  for (const [scheduleKey, itemsByDay] of denseItemsBySchedule) {
    let dayIndex = 0
    while (dayIndex < dayKeys.length) {
      const firstItem = itemsByDay.get(dayKeys[dayIndex])
      if (!firstItem) {
        dayIndex += 1
        continue
      }

      const segmentItems = [firstItem]
      let endIndex = dayIndex + 1
      while (endIndex < dayKeys.length) {
        const nextItem = itemsByDay.get(dayKeys[endIndex])
        if (!nextItem) break
        segmentItems.push(nextItem)
        endIndex += 1
      }

      segments.push({
        id: `${scheduleKey}-${dayKeys[dayIndex]}-${dayKeys[endIndex - 1]}-all-day-span`,
        item: firstItem,
        startColumn: dayIndex + 1,
        spanDays: segmentItems.length,
        totalRuns: segmentItems.reduce((total, item) => total + item.runCount, 0),
      })

      dayIndex = endIndex
    }
  }

  segments.sort(
    (a, b) =>
      b.spanDays - a.spanDays ||
      a.startColumn - b.startColumn ||
      a.item.firstOccurrence.date.getTime() - b.item.firstOccurrence.date.getTime() ||
      a.item.schedule.Name.localeCompare(b.item.schedule.Name),
  )

  const laneEnds: number[] = []
  return segments.map((segment) => {
    const segmentEnd = segment.startColumn + segment.spanDays
    const reusableLane = laneEnds.findIndex((endColumn) => segment.startColumn >= endColumn)
    const lane = reusableLane === -1 ? laneEnds.length : reusableLane
    laneEnds[lane] = segmentEnd

    return { ...segment, lane }
  })
}

const DenseSummaryChip = memo(function DenseSummaryChip({
  span,
  onOpenDayDetail,
  horizonDays,
}: {
  span: OutlookAllDaySpan
  onOpenDayDetail: (item: ProcessDayGroup) => void
  horizonDays?: number
}) {
  const title = `${span.item.schedule.Name} - ${span.item.bucketLabel} - ${formatRunCount(span.item.runCount)}/day - ${formatRunCount(span.totalRuns)} total`
  const lifecycleStatus = getLifecycleStatus(span.item.schedule, undefined, horizonDays)
  const lifecycleStopDate = scheduleStopDate(span.item.schedule)
  const isSoon = isLifecycleAttention(lifecycleStatus)
  const lifecycleSuffix = lifecycleStopDate
    ? ` · ${lifecycleEndLabel(span.item.schedule, lifecycleStopDate)}`
    : ''

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={`Show exact runs for ${title}${lifecycleSuffix}`}
          className={`outlook-all-day-chip ${span.item.schedule.Enabled ? '' : 'is-disabled'}`}
          onClick={() => onOpenDayDetail(span.item)}
          style={
            {
              ...groupAccentStyle(span.item),
              '--span-days': span.spanDays,
              '--span-lane': span.lane + 1,
              '--span-start': span.startColumn,
            } as CSSProperties
          }
          type="button"
        >
          <span className="outlook-event-copy">
            {lifecycleStopDate ? (
              <span
                className={`lifecycle-dot lifecycle-${lifecycleStatus}${isSoon ? '' : ' is-later'}`}
                aria-hidden="true"
              />
            ) : null}
            <span className="outlook-event-title">{span.item.schedule.Name}</span>
            <span className="outlook-event-meta">{span.item.bucketLabel}</span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{`Show exact runs for ${title}${lifecycleSuffix}`}</TooltipContent>
    </Tooltip>
  )
})

export const OutlookWeekView = memo(function OutlookWeekView({
  calendarDays,
  calendarItemsByDay,
  horizonDays,
  onOpenDayDetail,
  onOpenTimeSlot,
  runtimeStats,
  todayKey,
}: {
  calendarDays: Date[]
  calendarItemsByDay: Map<string, CalendarDisplayItem[]>
  horizonDays?: number
  onOpenDayDetail: (item: ProcessDayGroup) => void
  onOpenTimeSlot: (detail: SelectedDayDetail) => void
  runtimeStats?: Map<number, RuntimeStats>
  todayKey: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const timeGridRef = useRef<HTMLDivElement | null>(null)
  const [isAllDayExpanded, setIsAllDayExpanded] = useState(false)
  const [dayColumnWidth, setDayColumnWidth] = useState<number | null>(null)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)
  const layout = useMemo(
    () => buildOutlookWeekLayout(calendarDays, calendarItemsByDay, undefined, runtimeStats),
    [calendarDays, calendarItemsByDay, runtimeStats],
  )
  const allDaySpans = useMemo(() => buildAllDaySpans(layout.days), [layout.days])
  const visibleAllDaySpans = isAllDayExpanded
    ? allDaySpans
    : allDaySpans.filter((span) => span.lane < maxAllDayVisibleBlocks)
  const hiddenAllDayCount = Math.max(0, allDaySpans.length - visibleAllDaySpans.length)
  const hasExpandedAllDay = isAllDayExpanded && allDaySpans.length > maxAllDayVisibleBlocks
  const visibleAllDayLaneCount =
    visibleAllDaySpans.length > 0
      ? Math.max(...visibleAllDaySpans.map((span) => span.lane)) + 1
      : 1
  const visibleAllDayViewportLanes = hasExpandedAllDay
    ? Math.min(visibleAllDayLaneCount, maxExpandedAllDayVisibleLanes)
    : visibleAllDayLaneCount
  const allDayGridLaneCount = hasExpandedAllDay ? visibleAllDayViewportLanes + 1 : visibleAllDayViewportLanes

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = initialScrollHour * outlookHourHeight
  }, [layout])

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const updateScrollbarWidth = () => {
      setScrollbarWidth(Math.max(0, scrollElement.offsetWidth - scrollElement.clientWidth))
    }

    updateScrollbarWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateScrollbarWidth)
      return () => window.removeEventListener('resize', updateScrollbarWidth)
    }

    const resizeObserver = new ResizeObserver(updateScrollbarWidth)
    resizeObserver.observe(scrollElement)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const gridElement = timeGridRef.current
    if (!gridElement) return

    const updateDayColumnWidth = () => {
      const dayColumn = gridElement.querySelector<HTMLElement>('.outlook-week-day-column')
      const nextWidth = dayColumn?.clientWidth ?? null
      setDayColumnWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth))
    }

    updateDayColumnWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateDayColumnWidth)
      return () => window.removeEventListener('resize', updateDayColumnWidth)
    }

    const resizeObserver = new ResizeObserver(updateDayColumnWidth)
    resizeObserver.observe(gridElement)
    return () => resizeObserver.disconnect()
  }, [layout])

  const timedStacksByDay = useMemo(
    () =>
      new Map(
        layout.days.map((day) => [
          day.key,
          buildTimedEventStacks(day.timedEvents, dayColumnWidth),
        ]),
      ),
    [dayColumnWidth, layout.days],
  )

  return (
    <div
      className="outlook-week"
      style={
        {
          '--outlook-hour-height': `${outlookHourHeight}px`,
          '--outlook-scrollbar-gutter': `${scrollbarWidth}px`,
          '--week-timed-overflow-offset': `${timedOverflowEdgeOffset}px`,
          '--week-timed-overflow-reserved': `${timedOverflowReservedWidth}px`,
          '--week-timed-overflow-width': `${timedOverflowLabelWidth}px`,
        } as CSSProperties
      }
    >
      <div className="outlook-week-header">
        <div className="outlook-week-corner" aria-hidden="true" />
        {layout.days.map((day) => {
          const isToday = day.key === todayKey

          return (
            <div className={`outlook-week-day-heading ${isToday ? 'today' : ''}`} key={`${day.key}-heading`}>
              <span>{dayHeaderLabel(day.date)}</span>
              <b>{day.date.getDate()}</b>
            </div>
          )
        })}
      </div>

      <div
        className={`outlook-week-all-day ${hasExpandedAllDay ? 'is-expanded' : ''}`}
        style={
          {
            '--all-day-collapse-row': visibleAllDayLaneCount + 1,
            '--all-day-lanes': allDayGridLaneCount,
          } as CSSProperties
        }
      >
        <div className="outlook-week-all-day-label">All Day</div>
        <div className="outlook-week-all-day-spans">
          {visibleAllDaySpans.map((span) => (
            <DenseSummaryChip
              key={span.id}
              span={span}
              onOpenDayDetail={onOpenDayDetail}
              horizonDays={horizonDays}
            />
          ))}
          {allDaySpans.length > maxAllDayVisibleBlocks ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={isAllDayExpanded ? 'Collapse all-day triggers' : undefined}
                  className={`outlook-all-day-more ${isAllDayExpanded ? 'is-collapse' : ''}`}
                  onClick={() => setIsAllDayExpanded((currentValue) => !currentValue)}
                  type="button"
                >
                  {isAllDayExpanded ? (
                    <ChevronUp size={12} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <span className="overflow-label-text">+{formatNumber(hiddenAllDayCount)} more</span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{isAllDayExpanded ? 'Collapse all-day triggers' : 'Show all all-day triggers'}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="outlook-week-scroll" ref={scrollRef}>
        <div className="outlook-week-time-grid" ref={timeGridRef}>
          <div className="outlook-week-time-gutter" aria-hidden="true">
            {hours.map((hour) => (
              <span
                className="outlook-week-hour-label"
                key={hour}
                style={{ top: `${hour * outlookHourHeight}px` }}
              >
                {hourLabel(hour)}
              </span>
            ))}
          </div>

          {layout.days.map((day) => (
            <div className="outlook-week-day-column" key={`${day.key}-timed`}>
              {(timedStacksByDay.get(day.key) ?? []).map((stack) => {
                const stackHeight = stackHeightPixels(stack)
                const baseHeight = stack.isDenseCluster ? stackHeight : stackBlockHeightPixels(stack)
                const top = (stack.startMinute / 60) * outlookHourHeight
                const left = `calc(${(stack.laneColumnIndex / stack.laneColumnCount) * 100}% + 4px)`
                const width = `calc(${(1 / stack.laneColumnCount) * 100}% - 8px)`
                const openStackTimeRange = () =>
                  onOpenTimeSlot({
                    key: stack.events[0].dayKey,
                    date: stack.events[0].item.date,
                    scope: 'time-range',
                    startMinute: stack.startMinute,
                    endMinute: stack.endMinute,
                    scheduleKeys: [...new Set(stack.events.map((e) => e.item.scheduleKey))],
                  })
                const stackRangeLabel = stack.isDenseCluster ? stackTimeRangeLabel(stack) : stack.events[0].occurrence.timeLabel
                const overflowDetailLabel = stack.isDenseCluster
                  ? `in the ${stackRangeLabel} range`
                  : `at ${stack.events[0].occurrence.timeLabel}`
                const denseClusterLabel = `${formatNumber(stack.events.length)} triggers · ${compactStackTimeRangeLabel(stack)}`
                const denseClusterTitle = `Show ${formatNumber(stack.events.length)} triggers from ${stackRangeLabel}`

                return (
                  <div
                    className={`outlook-week-event-stack ${stack.isSameTimeStack ? 'is-same-time-stack' : ''} ${stack.isDenseCluster ? 'is-dense-cluster' : ''} ${stack.hiddenCount > 0 ? 'has-overflow' : ''}`}
                    key={stack.id}
                    style={
                      {
                        '--stack-columns': stack.stackColumnCount,
                        '--stack-height': `${stackHeight}px`,
                        '--stack-left': left,
                        '--stack-top': `${top}px`,
                        '--stack-width': width,
                        '--event-height': `${baseHeight}px`,
                        gridTemplateColumns: `repeat(${stack.stackColumnCount}, minmax(0, 1fr))`,
                      } as CSSProperties
                    }
                  >
                    {stack.isDenseCluster ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            aria-label={denseClusterTitle}
                            className="outlook-week-cluster-summary"
                            onClick={openStackTimeRange}
                            type="button"
                          >
                            <span className="overflow-label-text">{denseClusterLabel}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{denseClusterTitle}</TooltipContent>
                      </Tooltip>
                    ) : null}
                    {stack.visibleEvents.map((event) => {
                      const eventHeight = baseHeight
                      const title = `${event.item.schedule.Name} - ${event.item.bucketLabel} - ${event.occurrence.timeLabel}`
                      const stats = runtimeStats?.get(event.item.schedule.Id)
                      const typMinutes = stats ? Math.max(1, Math.ceil(stats.medianSec / 60)) : null
                      const p90Minutes = stats ? Math.max(1, Math.ceil(stats.p90Sec / 60)) : null
                      const lifecycleStatus = getLifecycleStatus(event.item.schedule, undefined, horizonDays)
                      const lifecycleStopDate = scheduleStopDate(event.item.schedule)
                      const lifecycleIsSoon = isLifecycleAttention(lifecycleStatus)
                      const lifecycleSuffix = lifecycleStopDate
                        ? ` · ${lifecycleEndLabel(event.item.schedule, lifecycleStopDate)}`
                        : ''

                      return (
                        <Tooltip key={event.id}>
                          <TooltipTrigger asChild>
                            <button
                              className={`outlook-week-event ${event.item.schedule.Enabled ? '' : 'is-disabled'}`}
                              onClick={
                                stack.isDenseCluster
                                  ? openStackTimeRange
                                  : () =>
                                      onOpenTimeSlot({
                                        key: event.dayKey,
                                        date: event.item.date,
                                        minuteOfDay: event.startMinute,
                                        scheduleKey: event.item.scheduleKey,
                                        scope: 'schedule',
                                      })
                              }
                              style={
                                {
                                  ...groupAccentStyle(event.item),
                                  '--event-height': `${eventHeight}px`,
                                } as CSSProperties
                              }
                              aria-label={`Show exact runs for ${title}${lifecycleSuffix}`}
                              type="button"
                            >
                              <span className="outlook-event-copy">
                                {lifecycleStopDate ? (
                                  <span
                                    className={`lifecycle-dot lifecycle-${lifecycleStatus}${lifecycleIsSoon ? '' : ' is-later'}`}
                                    aria-hidden="true"
                                  />
                                ) : null}
                                <span className="outlook-event-title">{event.item.schedule.Name}</span>
                                {typMinutes !== null && (
                                  <span className="outlook-event-meta">Typical {typMinutes}m</span>
                                )}
                              </span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="tooltip-name">{event.item.schedule.Name}</p>
                            {stats ? (
                              <>
                                <p>Typical (median): {typMinutes}m</p>
                                <p>Worst case (p90): {p90Minutes}m</p>
                                <p>Based on {stats.sampleSize} runs</p>
                              </>
                            ) : (
                              <p>No recent run history</p>
                            )}
                            {lifecycleStopDate ? (
                              <p>{lifecycleEndLabel(event.item.schedule, lifecycleStopDate)}</p>
                            ) : null}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                    {stack.hiddenCount > 0 && !stack.isDenseCluster ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            aria-label={`Show ${formatNumber(stack.hiddenCount)} more trigger${stack.hiddenCount === 1 ? '' : 's'} ${overflowDetailLabel}`}
                            className="outlook-week-overflow-link"
                            onClick={() =>
                              onOpenTimeSlot({
                                key: stack.events[0].dayKey,
                                date: stack.events[0].item.date,
                                ...(stack.isDenseCluster
                                  ? {
                                      scope: 'time-range' as const,
                                      startMinute: stack.startMinute,
                                      endMinute: stack.endMinute,
                                      scheduleKeys: [...new Set(stack.events.map((e) => e.item.scheduleKey))],
                                    }
                                  : { scope: 'time-slot' as const, minuteOfDay: stack.startMinute }),
                              })
                            }
                            type="button"
                          >
                            <span className="overflow-label-text">+{formatNumber(stack.hiddenCount)} more</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{`Show ${formatNumber(stack.hiddenCount)} more trigger${stack.hiddenCount === 1 ? '' : 's'} ${overflowDetailLabel}`}</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
