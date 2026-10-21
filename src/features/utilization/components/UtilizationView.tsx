import { useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, Gauge, Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '@/features/schedules/formatters'
import {
  CONCENTRATION_WARNING_PCT,
  utilizationTone,
  type RobotRow,
  type RootFolderRow,
  type RuntimeTypeRow,
  type UtilizationModel,
  type WaitSummary,
} from '../model'

const formatHours = (hours: number) =>
  hours > 0 && hours < 10 ? `${hours.toFixed(1)} h` : `${formatNumber(Math.round(hours))} h`

const formatPct = (pct: number) => `${Math.round(pct)}%`

// Higher is better: idle robot capacity is what schedules should be using. Low utilization is red
// (schedules need work), the middle band orange, and high utilization the app's teal accent.
const toneColor = { low: 'var(--danger)', medium: 'var(--orange)', high: 'var(--teal)' } as const

// Explanations sit behind an info icon so the whole view fits the screen without scrolling. In a
// table's summary line, clicking the icon mustn't open or close the table.
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={label}
          className="utilization-info"
          onClick={(event) => event.preventDefault()}
          role="img"
          tabIndex={0}
        >
          <Info size={13} aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="utilization-hint">{children}</TooltipContent>
    </Tooltip>
  )
}

const COUNTED_TYPES_TEXT = 'production and testing runtimes (Unattended, Cloud VM, Cloud Serverless, Non-production and the Testing types)'

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="header-metric-item"
          style={tone ? ({ '--tile-tone': tone } as CSSProperties) : undefined}
          tabIndex={0}
        >
          <strong>{value}</strong>
          <small>{label}</small>
        </div>
      </TooltipTrigger>
      <TooltipContent className="utilization-hint">{hint}</TooltipContent>
    </Tooltip>
  )
}

function SourceBadge({ model, isLoading }: { model: UtilizationModel; isLoading: boolean }) {
  // Runtimes come from one request per folder, which takes tens of seconds on a large tenant.
  // Until they arrive, "unavailable" would read as a failure.
  if (model.source === null && isLoading) {
    return (
      <span className="utilization-source" data-source="loading" aria-live="polite">
        Checking capacity…
      </span>
    )
  }
  if (model.source === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="utilization-source" data-source="none" tabIndex={0}>
            Capacity unavailable
          </span>
        </TooltipTrigger>
        <TooltipContent className="utilization-hint">
          No folder reported deployed {COUNTED_TYPES_TEXT}, so there is no capacity to compare against. Consumed hours
          are still shown.
        </TooltipContent>
      </Tooltip>
    )
  }
  const runtimes = model.capacityRuntimes ?? 0
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="utilization-source" data-source="runtimes" tabIndex={0}>
          At least {formatNumber(runtimes)} {runtimes === 1 ? 'runtime' : 'runtimes'}
        </span>
      </TooltipTrigger>
      <TooltipContent className="utilization-hint">
        The most {COUNTED_TYPES_TEXT} deployed to any one folder
        {model.capacityFolderName ? ` (${model.capacityFolderName})` : ''}. A machine template counts the runtimes of
        every host connected through it when runtimes were read. Folder totals are not added together, because a
        machine shared by several folders appears in each of them, so the real capacity can be higher.
      </TooltipContent>
    </Tooltip>
  )
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td className="utilization-empty" colSpan={colSpan}>
        {text}
      </td>
    </tr>
  )
}

function RobotRuntimeTypes({ types }: { types: RobotRow['runtimeTypes'] }) {
  const [first, ...rest] = types
  if (!first) return <>—</>
  if (rest.length === 0) return <>{first.label}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="utilization-type-list" tabIndex={0}>
          <span className="utilization-type-label">{first.label}</span>
          <span className="table-more">+{rest.length}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="utilization-hint">
        {types.map((type) => `${type.label}: ${formatHours(type.hours)}`).join(' · ')}
      </TooltipContent>
    </Tooltip>
  )
}

function RobotTable({ rows, emptyText }: { rows: RobotRow[]; emptyText: string }) {
  return (
    <table className="inventory-table utilization-table">
      <colgroup>
        <col style={{ width: '36%' }} />
        <col style={{ width: '26%' }} />
        <col style={{ width: '14%' }} />
        <col style={{ width: '24%' }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Robot</th>
          <th scope="col">Runtime type</th>
          <th scope="col">Hours</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={4} text={emptyText} />
        ) : (
          rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>
                <RobotRuntimeTypes types={row.runtimeTypes} />
              </td>
              <td className="table-number">{formatHours(row.hours)}</td>
              <td>
                <span
                  aria-label={`${formatPct(row.sharePct)} of consumed hours`}
                  className="utilization-share-bar"
                  role="img"
                >
                  <span style={{ width: `${Math.min(100, row.sharePct)}%` }} />
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function RootFolderTable({ rows, emptyText }: { rows: RootFolderRow[]; emptyText: string }) {
  return (
    <table className="inventory-table utilization-table">
      <colgroup>
        <col style={{ width: '44%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '20%' }} />
        <col style={{ width: '20%' }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Root folder</th>
          <th scope="col">Runtimes</th>
          <th scope="col">Hours</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={4} text={emptyText} />
        ) : (
          rows.map((row) => (
            <tr key={row.name} data-idle={row.idle}>
              <td>
                {row.name}
                {row.folderCount > 1 ? (
                  <span className="utilization-folder-count"> · {formatNumber(row.folderCount)} folders</span>
                ) : null}
                {row.idle ? <span className="utilization-idle-tag">Idle</span> : null}
              </td>
              <td className="table-number">{row.runtimes > 0 ? formatNumber(row.runtimes) : '—'}</td>
              <td className="table-number">{formatHours(row.hours)}</td>
              <td>{row.idle ? '—' : formatPct(row.sharePct)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function RuntimeTypeTable({ rows, emptyText }: { rows: RuntimeTypeRow[]; emptyText: string }) {
  return (
    <table className="inventory-table utilization-table">
      <colgroup>
        <col style={{ width: '30%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '13%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '22%' }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Runtime type</th>
          <th scope="col">Runtimes</th>
          <th scope="col">Connected</th>
          <th scope="col">Offline</th>
          <th scope="col">Hours</th>
          <th scope="col">Counted in utilization</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="utilization-empty" colSpan={6}>
              {emptyText}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.type ?? 'unknown'} data-counted={row.counted}>
              <td>{row.label}</td>
              <td className="table-number">{row.runtimes > 0 ? formatNumber(row.runtimes) : '—'}</td>
              <td className="table-number">{row.runtimes > 0 ? formatNumber(row.connected) : '—'}</td>
              <td className="table-number">{row.runtimes > 0 ? formatNumber(row.offline) : '—'}</td>
              <td className="table-number">{row.hours > 0 ? formatHours(row.hours) : '—'}</td>
              <td>{row.counted ? 'Yes' : 'No'}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`

const formatRuntimes = (value: number) => (value >= 10 ? formatNumber(Math.round(value)) : value.toFixed(1))

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Labels for the wait bands in WAIT_BUCKET_LIMITS_SEC, long for tooltips and short for the axis.
const WAIT_BAND_LABELS = ['Under 1 min', '1–5 min', '5–15 min', '15–60 min', 'Over 60 min']
const WAIT_BAND_AXIS = ['<1m', '1–5m', '5–15m', '15–60m', '>60m']

const dayDate = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

// Busy runtimes as a share of capacity when capacity is known, otherwise as a count.
const busyStat = (avgBusy: number, pctOfCapacity: number | null) =>
  pctOfCapacity != null ? formatPct(pctOfCapacity) : `${formatRuntimes(avgBusy)} busy`

const busyHint = (avgBusy: number, pctOfCapacity: number | null, capacity: number | null) =>
  `avg ${formatRuntimes(avgBusy)}${capacity ? ` of ${formatNumber(capacity)}` : ''} runtimes busy${
    pctOfCapacity != null ? ` (${formatPct(pctOfCapacity)})` : ''
  }`

function ChartCard({
  title,
  info,
  stat,
  axis,
  axisClassName,
  children,
}: {
  title: string
  info: ReactNode
  stat: string
  axis: ReactNode
  axisClassName?: string
  children: ReactNode
}) {
  return (
    <div className="utilization-chart" role="group" aria-label={title}>
      <div className="utilization-chart-head">
        <span>
          {title} <InfoTip label={`About ${title}`}>{info}</InfoTip>
        </span>
        <strong>{stat}</strong>
      </div>
      {children}
      <div className={`utilization-chart-axis${axisClassName ? ` ${axisClassName}` : ''}`} aria-hidden="true">
        {axis}
      </div>
    </div>
  )
}

function ChartBar({ height, mark, hint }: { height: number; mark?: 'peak' | 'low' | 'warn'; hint: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="utilization-chart-bar" data-mark={mark} style={{ height: `${Math.max(2, height)}%` }} tabIndex={-1} />
      </TooltipTrigger>
      <TooltipContent className="utilization-hint">{hint}</TooltipContent>
    </Tooltip>
  )
}

// Dashed line at capacity. Charts scale to whichever is taller, capacity or the tallest bar, so a
// bar above the capacity floor still fits.
function CapacityLine({ capacity, scaleMax }: { capacity: number | null; scaleMax: number }) {
  if (!capacity) return null
  return <span className="utilization-chart-capacity" style={{ bottom: `${(capacity / scaleMax) * 100}%` }} aria-hidden="true" />
}

const HOUR_AXIS = ['00', '06', '12', '18', '23'].map((label) => <span key={label}>{label}</span>)

// Average busy runtimes for each hour of the day across the window, against capacity. The 30-day
// average hides peaks; this shows when the fleet is actually full.
function HourlyChart({ model, sinceDays }: { model: UtilizationModel; sinceDays: number }) {
  const peak = model.peakHour
  if (!peak) return null
  const capacity = model.capacityRuntimes
  const scaleMax = Math.max(capacity ?? 0, peak.avgBusy) || 1
  return (
    <ChartCard
      axis={HOUR_AXIS}
      info={
        <>
          Each bar is the average number of runtimes busy in that hour across the last {sinceDays} days: the job time in
          that hour ÷ ({sinceDays} days × 1 h). The dashed line is capacity. Hours are in your browser's time zone.
        </>
      }
      stat={`Peak ${hourLabel(peak.hour)} · ${busyStat(peak.avgBusy, peak.pctOfCapacity)}`}
      title="Busy by hour"
    >
      <div className="utilization-chart-bars">
        <CapacityLine capacity={capacity} scaleMax={scaleMax} />
        {model.hourly.map((bucket) => (
          <ChartBar
            key={bucket.hour}
            height={(bucket.avgBusy / scaleMax) * 100}
            hint={`${hourLabel(bucket.hour)}–${hourLabel((bucket.hour + 1) % 24)}: ${busyHint(bucket.avgBusy, bucket.pctOfCapacity, capacity)}`}
            mark={bucket.hour === peak.hour ? 'peak' : undefined}
          />
        ))}
      </div>
    </ChartCard>
  )
}

// The hourly profile split by weekday: a job that runs only on Mondays shows at full strength on
// Monday instead of a seventh of it on every day. The quiet cells are where triggers can move.
function WeekChart({ model, sinceDays }: { model: UtilizationModel; sinceDays: number }) {
  const quiet = model.quietestSlot
  if (!quiet) return null
  const capacity = model.capacityRuntimes
  const scaleMax = Math.max(capacity ?? 0, ...model.week.map((slot) => slot.avgBusy)) || 1
  // Five shades only: a slot seen four times in the window rather than five shouldn't read as a
  // real difference.
  const shade = (avgBusy: number) =>
    avgBusy > 0
      ? `color-mix(in srgb, var(--teal) ${20 + Math.round(Math.min(1, avgBusy / scaleMax) * 4) * 20}%, var(--surface-soft))`
      : undefined
  return (
    <ChartCard
      axis={HOUR_AXIS}
      axisClassName="utilization-chart-axis-week"
      info={
        <>
          Each cell is the average number of runtimes busy in that hour of that weekday across the last {sinceDays}{' '}
          days: the job time in the cell ÷ the hours it covers. Darker is busier, against capacity. The outlined cell is
          the quietest hour of the week. Hours are in your browser's time zone.
        </>
      }
      stat={`Quietest ${WEEKDAY_LABELS[quiet.weekday]} ${hourLabel(quiet.hour)} · ${busyStat(quiet.avgBusy, quiet.pctOfCapacity)}`}
      title="Weekday × hour"
    >
      <div className="utilization-week">
        {WEEKDAY_LABELS.map((label, weekday) => (
          <div key={label} className="utilization-week-row">
            <span className="utilization-week-day" aria-hidden="true">
              {label.charAt(0)}
            </span>
            {model.week.slice(weekday * 24, weekday * 24 + 24).map((slot) => (
              <Tooltip key={slot.hour}>
                <TooltipTrigger asChild>
                  <span
                    className="utilization-week-cell"
                    data-quiet={slot === quiet}
                    style={{ background: shade(slot.avgBusy) }}
                    tabIndex={-1}
                  />
                </TooltipTrigger>
                <TooltipContent className="utilization-hint">
                  {label} {hourLabel(slot.hour)}–{hourLabel((slot.hour + 1) % 24)}:{' '}
                  {busyHint(slot.avgBusy, slot.pctOfCapacity, capacity)}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

const shortDate = (day: string) => dayDate(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// One bar per day of the window. A drop shows an outage or a missed schedule; a rise, a new
// process.
function DailyChart({ model, sinceDays }: { model: UtilizationModel; sinceDays: number }) {
  const low = model.lowestDay
  const first = model.daily[0]
  const last = model.daily[model.daily.length - 1]
  if (!low || !first || !last) return null
  const capacity = model.capacityRuntimes
  const scaleMax = Math.max(capacity ?? 0, ...model.daily.map((day) => day.avgBusy)) || 1
  return (
    <ChartCard
      axis={
        <>
          <span>{shortDate(first.day)}</span>
          <span>{shortDate(last.day)}</span>
        </>
      }
      info={
        <>
          Each bar is one day: the job time that day ÷ the hours of the day inside the window = the average number of
          runtimes busy. The first and last days are partial. The red bar is the quietest full day.
        </>
      }
      stat={`Lowest ${shortDate(low.day)} · ${busyStat(low.avgBusy, low.pctOfCapacity)}`}
      title={`Daily · last ${sinceDays} days`}
    >
      <div className="utilization-chart-bars">
        <CapacityLine capacity={capacity} scaleMax={scaleMax} />
        {model.daily.map((day) => (
          <ChartBar
            key={day.day}
            height={(day.avgBusy / scaleMax) * 100}
            hint={`${dayDate(day.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${
              day.full ? '' : ' (part of the day)'
            }: ${formatHours(day.hours)}, ${busyHint(day.avgBusy, day.pctOfCapacity, capacity)}`}
            mark={day === low ? 'low' : undefined}
          />
        ))}
      </div>
    </ChartCard>
  )
}

// How long jobs waited between creation and start, by band. The bands from 5 minutes up are
// orange: those jobs queued for a free robot.
function WaitChart({ wait, sinceDays }: { wait: WaitSummary | null; sinceDays: number }) {
  if (!wait) return null
  const scaleMax = Math.max(...wait.bands) || 1
  return (
    <ChartCard
      axis={WAIT_BAND_AXIS.map((label) => <span key={label}>{label}</span>)}
      axisClassName="utilization-chart-axis-even"
      info={
        <>
          Time from job creation to start for {formatNumber(wait.jobCount)} jobs on counted runtimes over the last{' '}
          {sinceDays} days, by band. Bars from 5 minutes up are orange: those jobs waited for a free robot.
        </>
      }
      stat={`${formatPct(wait.over5MinPct)} wait > 5 min`}
      title="Wait before start"
    >
      <div className="utilization-chart-bars utilization-chart-bars-wide">
        {wait.bands.map((count, band) => (
          <ChartBar
            key={band}
            height={(count / scaleMax) * 100}
            hint={`${WAIT_BAND_LABELS[band]}: ${formatNumber(count)} ${count === 1 ? 'job' : 'jobs'} (${formatPct((count / wait.jobCount) * 100)})`}
            mark={band >= 2 ? 'warn' : undefined}
          />
        ))}
      </div>
    </ChartCard>
  )
}

function Chip({ children, hint, warn = false }: { children: ReactNode; hint: ReactNode; warn?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="utilization-chip" data-warn={warn} tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="utilization-hint">{hint}</TooltipContent>
    </Tooltip>
  )
}

function SignalChips({ model, fetchedAt, sinceDays }: { model: UtilizationModel; fetchedAt: number | null; sinceDays: number }) {
  const { live, wait, concentration } = model
  const asOf = fetchedAt != null ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  const chips: ReactNode[] = []
  if (live && asOf) {
    chips.push(
      <Chip
        key="live"
        hint={
          <>
            From {live.folderName}, the folder with the most counted runtimes: {formatNumber(live.total)} deployed.
            Busy = connected − available; offline = deployed − connected, so those runtimes have no host online and
            can't take work. Read at {asOf}; refreshed every 4 hours.
          </>
        }
      >
        Right now: {formatNumber(live.busy)} busy · {formatNumber(live.idle)} idle · {formatNumber(live.offline)} offline{' '}
        <span className="utilization-chip-muted">(as of {asOf})</span>
      </Chip>,
    )
  }
  if (wait) {
    chips.push(
      <Chip
        key="wait"
        hint={
          <>
            Time from job creation to start for {formatNumber(wait.jobCount)} jobs on counted runtimes over the last{' '}
            {sinceDays} days. Long waits mean jobs queued for a free robot, even when the average utilization is low.
          </>
        }
      >
        Jobs waiting &gt; 5 min: {formatPct(wait.over5MinPct)}{' '}
        <span className="utilization-chip-muted">(avg {wait.avgWaitMin.toFixed(1)} min)</span>
      </Chip>,
    )
  }
  if (model.consumedHours > 0) {
    chips.push(
      <Chip
        key="failed"
        hint={
          <>
            {formatHours(model.failedHours)} of {formatHours(model.consumedHours)} consumed went to runs that ended Faulted
            or Stopped. That robot time produced no finished work.
          </>
        }
      >
        Failed or stopped runs: {formatPct(model.failedPct)} of hours{' '}
        <span className="utilization-chip-muted">({formatHours(model.failedHours)})</span>
      </Chip>,
    )
  }
  if (concentration) {
    chips.push(
      <Chip
        key="concentration"
        warn
        hint={
          <>
            {concentration.name} ran {formatPct(concentration.sharePct)} of consumed hours. If that account's credentials
            or license lapse, most automation stops. Warning shown at {CONCENTRATION_WARNING_PCT}% or more.
          </>
        }
      >
        <AlertTriangle size={12} aria-hidden="true" /> One robot account carries {formatPct(concentration.sharePct)} of hours
      </Chip>,
    )
  }
  if (chips.length === 0) return null
  return (
    <div className="utilization-chips" role="list" aria-label="Operational signals">
      {chips.map((chip, index) => (
        <span key={index} role="listitem">
          {chip}
        </span>
      ))}
    </div>
  )
}

type TableId = 'types' | 'robots' | 'folders'

// Which tables this browser left open. Storage can be unavailable (private windows, blocked site
// data); the tables then start collapsed and still open and close for the visit.
const OPEN_TABLES_STORAGE_KEY = 'process-schedule-manager.utilization.open-tables'

const readOpenTables = (): Set<TableId> => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OPEN_TABLES_STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(stored) ? (stored as TableId[]) : [])
  } catch {
    return new Set()
  }
}

function useOpenTables() {
  const [openTables, setOpenTables] = useState<ReadonlySet<TableId>>(readOpenTables)
  const setTableOpen = (id: TableId, isOpen: boolean) => {
    if (openTables.has(id) === isOpen) return
    const next = new Set(openTables)
    if (isOpen) next.add(id)
    else next.delete(id)
    setOpenTables(next)
    try {
      localStorage.setItem(OPEN_TABLES_STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      // Not remembered; the table still opens for this visit.
    }
  }
  return [openTables, setTableOpen] as const
}

// "4 types · 1 offline": the count shown on a collapsed table, or why it's empty.
const rowsSummary = (count: number, noun: string, emptyText: string, detail: string | null) =>
  count === 0
    ? emptyText
    : `${formatNumber(count)} ${count === 1 ? noun : `${noun}s`}${detail ? ` · ${detail}` : ''}`

// Tables start collapsed so the charts above them fit the screen; each opens on its own.
function TableBlock({
  id,
  title,
  info,
  infoLabel,
  summary,
  isOpen,
  onToggle,
  children,
}: {
  id: TableId
  title: string
  info: ReactNode
  infoLabel: string
  summary: string
  isOpen: boolean
  onToggle: (id: TableId, isOpen: boolean) => void
  children: ReactNode
}) {
  return (
    <details
      className="utilization-table-block"
      onToggle={(event) => onToggle(id, event.currentTarget.open)}
      open={isOpen}
    >
      <summary className="utilization-table-summary">
        <h3>{title}</h3>
        <InfoTip label={infoLabel}>{info}</InfoTip>
        <span className="utilization-table-summary-text">{summary}</span>
      </summary>
      <div className="utilization-table-scroll">{children}</div>
    </details>
  )
}

export function UtilizationView({
  model,
  sinceDays,
  isLoading,
  isCapacityLoading,
  runtimesFetchedAt,
}: {
  model: UtilizationModel
  sinceDays: number
  isLoading: boolean
  isCapacityLoading: boolean
  runtimesFetchedAt: number | null
}) {
  const tone = model.displayPct != null ? utilizationTone(model.displayPct) : null
  const emptyText = isLoading ? 'Loading job history…' : `No production or testing jobs ran in the last ${sinceDays} days.`
  const consumed = formatHours(model.consumedHours)
  const capacity = model.capacityHours != null ? formatHours(model.capacityHours) : null
  const folderCount = `${formatNumber(model.consumedFolderCount)} ${model.consumedFolderCount === 1 ? 'folder' : 'folders'}`
  const [openTables, setTableOpen] = useOpenTables()
  const typesOffline = model.runtimeTypes.reduce((sum, row) => sum + row.offline, 0)
  const idleRoots = model.rootFolders.filter((row) => row.idle).length

  return (
    <section className="utilization-view" aria-label="Robot utilization">
      <div className="utilization-panel">
        <header className="utilization-header">
          <div className="utilization-title">
            <Gauge size={18} aria-hidden="true" />
            <h2>Robot utilization</h2>
            <SourceBadge isLoading={isCapacityLoading} model={model} />
          </div>
          <span className="utilization-scope">
            Whole tenant · last {sinceDays} days · filters don't apply{' '}
            <InfoTip label="What is counted">
              Consumed counts job time on {COUNTED_TYPES_TEXT}, including faulted and stopped runs, in folders that have
              at least one trigger. Personal workspaces are left out.
            </InfoTip>
          </span>
        </header>

        <div className="header-metric-stats utilization-tiles">
          {model.utilizationPct != null && model.displayPct != null && tone && capacity ? (
            <Tile
              label="Utilization"
              value={formatPct(model.displayPct)}
              tone={toneColor[tone]}
              hint={
                <>
                  {consumed} consumed ÷ {capacity} capacity = {model.utilizationPct.toFixed(1)}%.
                  {model.utilizationPct > 100
                    ? ' Shown as 100%: capacity is a lower bound, so the real capacity is higher than shown.'
                    : null}
                </>
              }
            />
          ) : null}
          {model.capacityHours != null && model.capacityRuntimes != null && capacity ? (
            <Tile
              label="Capacity"
              value={capacity}
              tone="var(--metric-utilization)"
              hint={
                <>
                  {formatNumber(model.capacityRuntimes)} runtimes × 24 h × {sinceDays} days = {capacity}. The{' '}
                  {formatNumber(model.capacityRuntimes)} is the most {COUNTED_TYPES_TEXT} deployed to any one folder
                  {model.capacityFolderName ? ` (${model.capacityFolderName})` : ''}.
                </>
              }
            />
          ) : null}
          <Tile
            label="Consumed"
            value={consumed}
            tone="var(--metric-runs)"
            hint={
              <>
                Sum of job durations (end − start) over the last {sinceDays} days for jobs on {COUNTED_TYPES_TEXT} that
                ended Successful, Faulted or Stopped, across {folderCount} = {consumed}.
                {model.excludedHours > 0
                  ? ` ${formatHours(model.excludedHours)} in personal workspaces is left out.`
                  : null}
              </>
            }
          />
          {model.idleHours != null && capacity ? (
            <Tile
              label="Idle"
              value={formatHours(model.idleHours)}
              hint={
                <>
                  {capacity} capacity − {consumed} consumed = {formatHours(model.idleHours)}
                  {model.consumedHours > (model.capacityHours ?? 0)
                    ? '. Consumed is above the capacity floor, so idle shows as 0 h.'
                    : '.'}
                </>
              }
            />
          ) : null}
        </div>

        {model.displayPct != null && tone ? (
          <div className="utilization-meter-block">
            <div
              aria-label="Utilization"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(model.displayPct)}
              className="utilization-meter"
              role="meter"
            >
              <span
                className="utilization-meter-fill"
                data-tone={tone}
                style={{ width: `${model.displayPct}%`, background: toneColor[tone] }}
              />
              <span className="utilization-meter-tick" style={{ left: '50%' }} aria-hidden="true" />
              <span className="utilization-meter-tick" style={{ left: '85%' }} aria-hidden="true" />
            </div>
            <div className="utilization-meter-scale" aria-hidden="true">
              <span style={{ left: '0%' }}>0%</span>
              <span style={{ left: '50%' }}>50%</span>
              <span style={{ left: '85%' }}>85%</span>
              <span style={{ left: '100%' }}>100%</span>
            </div>
          </div>
        ) : null}

        {model.peakHour || model.wait ? (
          <div className="utilization-charts">
            <HourlyChart model={model} sinceDays={sinceDays} />
            <WeekChart model={model} sinceDays={sinceDays} />
            <DailyChart model={model} sinceDays={sinceDays} />
            <WaitChart sinceDays={sinceDays} wait={model.wait} />
          </div>
        ) : null}

        <SignalChips fetchedAt={runtimesFetchedAt} model={model} sinceDays={sinceDays} />

        <div className="utilization-body">
          <TableBlock
            id="types"
            infoLabel="About the runtime type table"
            info={
              <>
                Runtimes is the most of that type deployed to any one folder. Counted types make up the capacity and
                consumed figures; the others are shown for reference only.
              </>
            }
            isOpen={openTables.has('types')}
            onToggle={setTableOpen}
            summary={rowsSummary(model.runtimeTypes.length, 'type', emptyText, typesOffline > 0 ? `${formatNumber(typesOffline)} offline` : null)}
            title="By runtime type"
          >
            <RuntimeTypeTable emptyText={emptyText} rows={model.runtimeTypes} />
          </TableBlock>
          <TableBlock
            id="robots"
            infoLabel="About the robot table"
            info={
              <>
                Hours are per robot account. One account can run on several runtimes at once, so its hours can pass{' '}
                {formatNumber(sinceDays * 24)} h ({sinceDays} days × 24 h).
              </>
            }
            isOpen={openTables.has('robots')}
            onToggle={setTableOpen}
            summary={rowsSummary(
              model.robots.length,
              'account',
              emptyText,
              model.robots[0] ? `top ${formatPct(model.robots[0].sharePct)} of hours` : null,
            )}
            title="By robot"
          >
            <RobotTable emptyText={emptyText} rows={model.robots} />
          </TableBlock>
          <TableBlock
            id="folders"
            infoLabel="About the root folder table"
            info={
              <>
                Sub-folders roll up into their root folder. Runtimes is the most counted runtimes deployed to any one
                folder in the root; a pool shared with other folders appears in each, so these don't add up to the
                headline capacity. Idle roots have runtimes deployed but ran no counted jobs in the window.
              </>
            }
            isOpen={openTables.has('folders')}
            onToggle={setTableOpen}
            summary={rowsSummary(model.rootFolders.length, 'root folder', emptyText, idleRoots > 0 ? `${formatNumber(idleRoots)} idle` : null)}
            title="By root folder (share of consumed)"
          >
            <RootFolderTable emptyText={emptyText} rows={model.rootFolders} />
          </TableBlock>
        </div>
      </div>
    </section>
  )
}
