import type { CSSProperties, ReactNode } from 'react'
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
} from '../model'

const formatHours = (hours: number) =>
  hours > 0 && hours < 10 ? `${hours.toFixed(1)} h` : `${formatNumber(Math.round(hours))} h`

const formatPct = (pct: number) => `${Math.round(pct)}%`

// Higher is better: idle robot capacity is what schedules should be using. Low utilization is red
// (schedules need work), the middle band orange, and high utilization the app's teal accent.
const toneColor = { low: 'var(--danger)', medium: 'var(--orange)', high: 'var(--teal)' } as const

// Explanations sit behind an info icon so the whole view fits the screen without scrolling.
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={label} className="utilization-info" role="img" tabIndex={0}>
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
        {model.capacityFolderName ? ` (${model.capacityFolderName})` : ''}. Folder totals are not added together,
        because a machine shared by several folders appears in each of them, so the real capacity can be higher.
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

function RobotTable({ rows, emptyText, info }: { rows: RobotRow[]; emptyText: string; info: ReactNode }) {
  return (
    <div className="utilization-table-block">
      <h3>
        By robot <InfoTip label="About the robot table">{info}</InfoTip>
      </h3>
      <div className="utilization-table-scroll">
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
      </div>
    </div>
  )
}

function RootFolderTable({ rows, emptyText, info }: { rows: RootFolderRow[]; emptyText: string; info: ReactNode }) {
  return (
    <div className="utilization-table-block">
      <h3>
        By root folder (share of consumed) <InfoTip label="About the root folder table">{info}</InfoTip>
      </h3>
      <div className="utilization-table-scroll">
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
      </div>
    </div>
  )
}

function RuntimeTypeTable({ rows, emptyText, info }: { rows: RuntimeTypeRow[]; emptyText: string; info: ReactNode }) {
  return (
    <div className="utilization-table-block utilization-types">
      <h3>
        By runtime type <InfoTip label="About the runtime type table">{info}</InfoTip>
      </h3>
      <div className="utilization-table-scroll">
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
      </div>
    </div>
  )
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`

const formatRuntimes = (value: number) => (value >= 10 ? formatNumber(Math.round(value)) : value.toFixed(1))

// Average busy runtimes for each hour of the day across the window, against capacity. The 30-day
// average hides peaks; this shows when the fleet is actually full.
function HourlyChart({ model }: { model: UtilizationModel }) {
  const peak = model.peakHour
  if (!peak) return null
  const capacity = model.capacityRuntimes
  // Scale to whichever is taller, so a peak above the capacity floor still fits.
  const scaleMax = Math.max(capacity ?? 0, peak.avgBusy) || 1
  const peakText =
    peak.pctOfCapacity != null
      ? `Peak ${hourLabel(peak.hour)} · ${formatPct(peak.pctOfCapacity)} of capacity`
      : `Peak ${hourLabel(peak.hour)} · avg ${formatRuntimes(peak.avgBusy)} runtimes busy`
  return (
    <div className="utilization-hourly" role="group" aria-label="Busy runtimes by hour of day">
      <div className="utilization-hourly-head">
        <span>
          Busy runtimes by hour of day{' '}
          <InfoTip label="About the hourly chart">
            Each bar is the average number of runtimes busy in that hour across the last 30 days: the job time in that
            hour ÷ (30 days × 1 h). The dashed line is capacity. Hours are in your browser's time zone.
          </InfoTip>
        </span>
        <strong>{peakText}</strong>
      </div>
      <div className="utilization-hourly-bars">
        {capacity ? (
          <span className="utilization-hourly-capacity" style={{ bottom: `${(capacity / scaleMax) * 100}%` }} aria-hidden="true" />
        ) : null}
        {model.hourly.map((bucket) => (
          <Tooltip key={bucket.hour}>
            <TooltipTrigger asChild>
              <span
                className="utilization-hourly-bar"
                data-peak={bucket.hour === peak.hour}
                style={{ height: `${Math.max(2, (bucket.avgBusy / scaleMax) * 100)}%` }}
                tabIndex={-1}
              />
            </TooltipTrigger>
            <TooltipContent className="utilization-hint">
              {hourLabel(bucket.hour)}–{hourLabel((bucket.hour + 1) % 24)}: avg {formatRuntimes(bucket.avgBusy)}
              {capacity ? ` of ${formatNumber(capacity)}` : ''} runtimes busy
              {bucket.pctOfCapacity != null ? ` (${formatPct(bucket.pctOfCapacity)})` : ''}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="utilization-hourly-axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
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

        <div className="utilization-headline">
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
        <HourlyChart model={model} />
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

        <SignalChips fetchedAt={runtimesFetchedAt} model={model} sinceDays={sinceDays} />

        <div className="utilization-body">
        <RuntimeTypeTable
          emptyText={emptyText}
          info={
            <>
              Runtimes is the most of that type deployed to any one folder. Counted types make up the capacity and
              consumed figures; the others are shown for reference only.
            </>
          }
          rows={model.runtimeTypes}
        />

        <div className="utilization-tables">
          <RobotTable
            emptyText={emptyText}
            info={
              <>
                Hours are per robot account. One account can run on several runtimes at once, so its hours can pass{' '}
                {formatNumber(sinceDays * 24)} h ({sinceDays} days × 24 h).
              </>
            }
            rows={model.robots}
          />
          <RootFolderTable
            emptyText={emptyText}
            info={
              <>
                Sub-folders roll up into their root folder. Runtimes is the most counted runtimes deployed to any one
                folder in the root; a pool shared with other folders appears in each, so these don't add up to the
                headline capacity. Idle roots have runtimes deployed but ran no counted jobs in the window.
              </>
            }
            rows={model.rootFolders}
          />
        </div>
        </div>
      </div>
    </section>
  )
}
