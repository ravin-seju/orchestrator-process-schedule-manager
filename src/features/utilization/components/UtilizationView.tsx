import type { CSSProperties, ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '@/features/schedules/formatters'
import { utilizationTone, type RuntimeTypeRow, type UtilizationModel, type UtilizationRow } from '../model'

const formatHours = (hours: number) =>
  hours > 0 && hours < 10 ? `${hours.toFixed(1)} h` : `${formatNumber(Math.round(hours))} h`

const formatPct = (pct: number) => `${Math.round(pct)}%`

const toneColor = { low: 'var(--teal)', medium: 'var(--orange)', high: 'var(--danger)' } as const

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

function UsageTable({
  caption,
  nameHeading,
  rows,
  showBars,
  emptyText,
}: {
  caption: string
  nameHeading: string
  rows: UtilizationRow[]
  showBars: boolean
  emptyText: string
}) {
  return (
    <div className="utilization-table-block">
      <h3>{caption}</h3>
      <div className="utilization-table-scroll">
        <table className="inventory-table utilization-table">
          <colgroup>
            <col style={{ width: showBars ? '44%' : '52%' }} />
            <col style={{ width: showBars ? '20%' : '26%' }} />
            <col style={{ width: showBars ? '36%' : '22%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{nameHeading}</th>
              <th scope="col">Hours</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="utilization-empty" colSpan={3}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="table-number">{formatHours(row.hours)}</td>
                  <td>
                    {showBars ? (
                      <span
                        aria-label={`${formatPct(row.sharePct)} of consumed hours`}
                        className="utilization-share-bar"
                        role="img"
                      >
                        <span style={{ width: `${Math.min(100, row.sharePct)}%` }} />
                      </span>
                    ) : (
                      formatPct(row.sharePct)
                    )}
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

function RuntimeTypeTable({ rows, emptyText }: { rows: RuntimeTypeRow[]; emptyText: string }) {
  return (
    <div className="utilization-table-block">
      <h3>By runtime type</h3>
      <div className="utilization-table-scroll">
        <table className="inventory-table utilization-table">
          <colgroup>
            <col style={{ width: '40%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Runtime type</th>
              <th scope="col">Runtimes</th>
              <th scope="col">Hours</th>
              <th scope="col">In headline</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="utilization-empty" colSpan={4}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.type ?? 'unknown'} data-counted={row.counted}>
                  <td>{row.label}</td>
                  <td className="table-number">{row.runtimes > 0 ? formatNumber(row.runtimes) : '—'}</td>
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

export function UtilizationView({
  model,
  sinceDays,
  isLoading,
  isCapacityLoading,
}: {
  model: UtilizationModel
  sinceDays: number
  isLoading: boolean
  isCapacityLoading: boolean
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
          <span className="utilization-scope">Whole tenant · last {sinceDays} days · filters don't apply</span>
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

        <p className="utilization-caveat">
          Consumed counts job time on {COUNTED_TYPES_TEXT}, including faulted and stopped runs, in folders that have at
          least one trigger. Personal workspaces are left out.
        </p>

        <div className="utilization-tables">
          <div className="utilization-table-column">
            <UsageTable caption="By robot" emptyText={emptyText} nameHeading="Robot" rows={model.robots} showBars />
            <p className="utilization-caveat">
              Hours are per robot account. One account can run on several runtimes at once, so its hours can pass{' '}
              {formatNumber(sinceDays * 24)} h ({sinceDays} days × 24 h).
            </p>
          </div>
          <div className="utilization-table-column">
            <UsageTable
              caption="By folder (share of consumed)"
              emptyText={emptyText}
              nameHeading="Folder"
              rows={model.folders}
              showBars={false}
            />
            <p className="utilization-caveat">
              Capacity is not split by folder: machines are shared across folders, so per-folder capacity would count
              them more than once.
            </p>
          </div>
        </div>

        <div className="utilization-table-column">
          <RuntimeTypeTable emptyText={emptyText} rows={model.runtimeTypes} />
          <p className="utilization-caveat">
            Runtimes is the most of that type deployed to any one folder. Types marked No are shown for reference and are
            not in the headline.
          </p>
        </div>
      </div>
    </section>
  )
}
