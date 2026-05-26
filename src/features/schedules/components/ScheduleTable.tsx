import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  classifyRecurrenceBucket,
  folderAccentStyle,
  recurrenceAccentStyle,
} from '../calendarDisplay'
import { recurrenceBucketLabels } from '../constants'
import { formatNumber } from '../formatters'
import type { ProcessSchedule } from '../orchestrator'
import { getScheduleSummary, isQueueTrigger } from '../scheduleUtils'

const inventoryRowHeight = 36
const inventoryOverscan = 8
const inventoryColumnCount = 7
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const reservedColumnPercent = 19.5
const textWidth = (value: string | null | undefined, min: number, max: number) =>
  clamp((value?.length ?? 0) * 7.6 + 34, min, max)

const maxTextWidth = (values: Array<string | null | undefined>, min: number, max: number) =>
  values.reduce((width, value) => Math.max(width, textWidth(value, min, max)), min)

const toPercent = (value: number) => `${value.toFixed(2)}%`

export function ScheduleTable({
  schedules,
  className = '',
}: {
  schedules: ProcessSchedule[]
  className?: string
}) {
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
        '--inventory-folder-width': widthFor(folderWeight),
        '--inventory-name-width': widthFor(nameWeight),
        '--inventory-number-width': numberWidth,
        '--inventory-pattern-width': widthFor(patternWeight),
        '--inventory-process-width': widthFor(processWidth),
        '--inventory-status-width': '6.5%',
        '--inventory-type-width': '10.5%',
      } as CSSProperties,
    }
  }, [schedules])

  return (
    <section className={`table-section ${className}`.trim()} aria-label="Triggers">
      <div className="schedule-table" onScroll={updateViewport} ref={scrollRef}>
        <table className="inventory-table" style={columnWidths.style}>
          <colgroup>
            <col className="number-column" />
            <col className="name-column" />
            <col className="process-column" />
            <col className="folder-column" />
            <col className="type-column" />
            <col className="pattern-column" />
            <col className="status-column" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Process</th>
              <th>Folder</th>
              <th>Trigger Type</th>
              <th>Pattern</th>
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

              return (
                <tr key={`${schedule.folderId}-${schedule.Id}`} style={folderAccentStyle(schedule.folderId)}>
                  <td className="table-number">{formatNumber(index + 1)}</td>
                  <td className="table-name" title={schedule.Name}>{schedule.Name}</td>
                  <td className="table-process" title={processLabel}>{processLabel}</td>
                  <td className="table-folder" title={schedule.folderName}>{schedule.folderName}</td>
                  <td>
                    <span className="schedule-type-chip" style={recurrenceAccentStyle(bucket)} title={triggerTypeLabel}>
                      {triggerTypeLabel}
                    </span>
                  </td>
                  <td className="table-pattern" title={patternTitle}>{patternLabel}</td>
                  <td>
                    <span className={schedule.Enabled ? 'status enabled' : 'status disabled'}>
                      {schedule.Enabled ? 'Enabled' : 'Disabled'}
                    </span>
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
