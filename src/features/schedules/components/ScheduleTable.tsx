import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Hourglass } from 'lucide-react'
import {
  classifyRecurrenceBucket,
  folderAccentStyle,
  recurrenceAccentStyle,
} from '../calendarDisplay'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { defaultLifecycleHorizonDays, recurrenceBucketLabels } from '../constants'
import { formatNumber } from '../formatters'
import type { ProcessSchedule } from '../orchestrator'
import {
  everyStopDateIsPast,
  getLifecycleStatus,
  getScheduleSummary,
  isAutoDisabledByStopDate,
  isQueueTrigger,
  lifecycleEndLabel,
  lifecycleMarkerTone,
  resolveMachineNames,
  resolveRobotNames,
  scheduleStopDate,
  stopDateLabel,
} from '../scheduleUtils'

const inventoryRowHeight = 36
// The colSpan of the virtual-scroll spacer rows — must equal the real column count, or the
// spacers span too few columns and the virtualized layout skews once the list passes 80 rows.
const inventoryColumnCount = 10
const inventoryOverscan = 8
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
// Number + status + type (fixed-ish) plus the fixed-percent Machine/Robot/Ends columns;
// the remainder is shared by the text-weighted name/process/folder/pattern columns.
// Keep this in step with the fixed --inventory-*-width values below (2.4 + 9.5 + 10.5 + 11 + 9 + 9),
// or the dynamic columns are handed more space than is left and the row overflows.
const reservedColumnPercent = 51.4
const textWidth = (value: string | null | undefined, min: number, max: number) =>
  clamp((value?.length ?? 0) * 7.6 + 34, min, max)

const maxTextWidth = (values: Array<string | null | undefined>, min: number, max: number) =>
  values.reduce((width, value) => Math.max(width, textWidth(value, min, max)), min)

const toPercent = (value: number) => `${value.toFixed(2)}%`

export function ScheduleTable({
  schedules,
  className = '',
  horizonDays = defaultLifecycleHorizonDays,
  robotNames,
  machineNames,
  scheduleMachineIds,
}: {
  schedules: ProcessSchedule[]
  className?: string
  horizonDays?: number
  robotNames?: Map<number, string>
  machineNames?: Map<number, string>
  scheduleMachineIds?: Map<number, number[]>
}) {
  // Any of the machine/robot maps being present signals the columns have data to show;
  // a schedule with no associated machine/robot still renders an em dash per cell.
  const showMachineRobot =
    robotNames !== undefined || machineNames !== undefined || scheduleMachineIds !== undefined
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 })
  const updateViewport = useCallback(() => {
    const node = scrollRef.current
    if (!node) return

    setViewport((current) => {
      const next = {
        height: node.clientHeight,
        scrollTop: node.scrollTop,
      }

      return current.height === next.height && current.scrollTop === next.scrollTop
        ? current
        : next
    })
  }, [])
  useEffect(() => {
    updateViewport()

    const node = scrollRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined

    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(node)

    return () => resizeObserver.disconnect()
  }, [updateViewport])

  const visibleRange = useMemo(() => {
    if (!viewport.height || schedules.length <= 80) {
      return {
        endIndex: schedules.length,
        startIndex: 0,
      }
    }

    const visibleRowCount = Math.ceil(viewport.height / inventoryRowHeight)
    const startIndex = Math.max(0, Math.floor(viewport.scrollTop / inventoryRowHeight) - inventoryOverscan)
    const endIndex = Math.min(schedules.length, startIndex + visibleRowCount + inventoryOverscan * 2)

    return { endIndex, startIndex }
  }, [schedules.length, viewport.height, viewport.scrollTop])
  const visibleSchedules = schedules.slice(visibleRange.startIndex, visibleRange.endIndex)
  const topSpacerHeight = visibleRange.startIndex * inventoryRowHeight
  const bottomSpacerHeight = Math.max(0, (schedules.length - visibleRange.endIndex) * inventoryRowHeight)
  const columnWidths = useMemo(() => {
    const patterns = schedules.map((schedule) => getScheduleSummary(schedule))
    const numberWidth = `clamp(38px, 2.4%, ${clamp(formatNumber(Math.max(1, schedules.length)).length * 8 + 30, 42, 56)}px)`
    const nameWeight = maxTextWidth(schedules.map((schedule) => schedule.Name), 170, 300)
    const processWidth = maxTextWidth(
      schedules.map((schedule) => schedule.ReleaseName ?? schedule.PackageName ?? 'Unknown'),
      240,
      420,
    )
    const folderWeight = maxTextWidth(schedules.map((schedule) => schedule.folderName), 190, 390)
    const patternWeight = maxTextWidth(patterns, 260, 430)
    const dynamicTotal = nameWeight + processWidth + folderWeight + patternWeight
    const availablePercent = 100 - reservedColumnPercent
    const widthFor = (weight: number) => toPercent((weight / dynamicTotal) * availablePercent)

    return {
      style: {
        // A plain percentage, NOT a clamp. table-layout is fixed, so a px floor that exceeds its
        // own percentage at narrow widths over-subscribes the table past 100% and the browser
        // shrinks every column to compensate — clamp(84px, 7%, 104px) measured 46px at 980px wide.
        // 9% is 88px there, and "Aug 24, 2026" needs 85px including padding at --font-xs.
        '--inventory-ends-width': '9%',
        '--inventory-folder-width': widthFor(folderWeight),
        '--inventory-machine-width': '11%',
        '--inventory-name-width': widthFor(nameWeight),
        '--inventory-number-width': numberWidth,
        '--inventory-pattern-width': widthFor(patternWeight),
        '--inventory-process-width': widthFor(processWidth),
        '--inventory-robot-width': '9%',
        // Wide enough for "Auto-disabled"; .status truncates with an ellipsis, so 6.5% clipped it.
        '--inventory-status-width': '9.5%',
        '--inventory-type-width': '10.5%',
      } as CSSProperties,
    }
  }, [schedules])

  // "Ended" once every stop date on screen is already past — the Disabled view's normal state.
  const endsHeading = everyStopDateIsPast(schedules) ? 'Ended' : 'Ends'

  // Machine/Robot cell: first value inline, "+N" overflow badge with the full list on
  // hover; a single value renders plain; no data renders an em dash.
  const resourceCell = (names: string[], cls: string) => {
    if (!showMachineRobot || names.length === 0) return <td className={cls}>—</td>
    if (names.length === 1) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <td className={cls}>{names[0]}</td>
          </TooltipTrigger>
          <TooltipContent>{names[0]}</TooltipContent>
        </Tooltip>
      )
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <td className={cls}>
            <span className="table-resource-name">{names[0]}</span>{' '}
            <span className="table-more">+{names.length - 1}</span>
          </td>
        </TooltipTrigger>
        <TooltipContent>{names.join(', ')}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <section className={`table-section ${className}`.trim()} aria-label="Triggers">
      <div className="schedule-table" onScroll={updateViewport} ref={scrollRef}>
        <table className="inventory-table" style={columnWidths.style}>
          <colgroup>
            <col className="number-column" />
            <col className="name-column" />
            <col className="process-column" />
            <col className="folder-column" />
            <col className="machine-column" />
            <col className="robot-column" />
            <col className="type-column" />
            <col className="pattern-column" />
            <col className="ends-column" />
            <col className="status-column" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Process</th>
              <th>Folder</th>
              <th>Machine</th>
              <th>Robot</th>
              <th>Trigger Type</th>
              <th>Pattern</th>
              <th>{endsHeading}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight ? (
              <tr className="table-spacer" aria-hidden="true">
                <td colSpan={inventoryColumnCount} style={{ height: topSpacerHeight }} />
              </tr>
            ) : null}
            {visibleSchedules.map((schedule, visibleIndex) => {
              const index = visibleRange.startIndex + visibleIndex
              const bucket = classifyRecurrenceBucket(schedule)
              const triggerTypeLabel = recurrenceBucketLabels[bucket]
              const processLabel = schedule.ReleaseName ?? schedule.PackageName ?? 'Unknown'
              const isQueue = isQueueTrigger(schedule)
              const patternLabel = isQueue ? '—' : getScheduleSummary(schedule)
              const patternTitle = isQueue ? 'Queue-driven trigger — no time-based pattern' : patternLabel
              const lifecycleStatus = getLifecycleStatus(schedule, undefined, horizonDays)
              const lifecycleStopDate = scheduleStopDate(schedule)
              // null for a disabled trigger — see lifecycleMarkerTone. The Ends date still shows.
              const markerTone = lifecycleMarkerTone(schedule, undefined, horizonDays)
              const isSoon = markerTone === 'amber'

              return (
                <tr key={`${schedule.folderId}-${schedule.Id}`} style={folderAccentStyle(schedule.folderName)}>
                  <td className="table-number">{formatNumber(index + 1)}</td>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <td className="table-name">{schedule.Name}</td>
                    </TooltipTrigger>
                    <TooltipContent>{schedule.Name}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <td className="table-process">{processLabel}</td>
                    </TooltipTrigger>
                    <TooltipContent>{processLabel}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <td className="table-folder">{schedule.folderName}</td>
                    </TooltipTrigger>
                    <TooltipContent>{schedule.folderName}</TooltipContent>
                  </Tooltip>
                  {resourceCell(
                    showMachineRobot ? resolveMachineNames(schedule.Id, scheduleMachineIds, machineNames) : [],
                    'table-machine',
                  )}
                  {resourceCell(showMachineRobot ? resolveRobotNames(schedule, robotNames) : [], 'table-robot')}
                  <td>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="schedule-type-chip" style={recurrenceAccentStyle(bucket)}>
                          {triggerTypeLabel}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{triggerTypeLabel}</TooltipContent>
                    </Tooltip>
                  </td>
                  <td className="table-pattern">
                    <span className="table-pattern-cell">
                      {markerTone && lifecycleStopDate ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={`lifecycle-badge lifecycle-${lifecycleStatus}${isSoon ? '' : ' is-later'}`}
                              role="img"
                              aria-label={lifecycleEndLabel(schedule, lifecycleStopDate)}
                            >
                              <Hourglass size={12} aria-hidden="true" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{lifecycleEndLabel(schedule, lifecycleStopDate)}</TooltipContent>
                        </Tooltip>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="table-pattern-text">{patternLabel}</span>
                        </TooltipTrigger>
                        <TooltipContent>{patternTitle}</TooltipContent>
                      </Tooltip>
                    </span>
                  </td>
                  <td className={`table-ends${isSoon ? ' is-soon' : ''}`}>
                    {lifecycleStopDate ? stopDateLabel(schedule, lifecycleStopDate) : '—'}
                  </td>
                  <td>
                    {isAutoDisabledByStopDate(schedule) ? (
                      <span className="status auto-disabled">Auto-disabled</span>
                    ) : (
                      <span className={schedule.Enabled ? 'status enabled' : 'status disabled'}>
                        {schedule.Enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {bottomSpacerHeight ? (
              <tr className="table-spacer" aria-hidden="true">
                <td colSpan={inventoryColumnCount} style={{ height: bottomSpacerHeight }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
