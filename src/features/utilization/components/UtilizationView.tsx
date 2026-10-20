import type { CSSProperties, ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '@/features/schedules/formatters'
import { utilizationTone, type UtilizationModel, type UtilizationRow } from '../model'

const formatHours = (hours: number) =>
  hours > 0 && hours < 10 ? `${hours.toFixed(1)} h` : `${formatNumber(Math.round(hours))} h`

const formatPct = (pct: number) => `${Math.round(pct)}%`

const toneColor = { low: 'var(--teal)', medium: 'var(--orange)', high: 'var(--danger)' } as const

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: ReactNode }) {
  const tile = (
    <div
      className="header-metric-item"
      style={tone ? ({ '--tile-tone': tone } as CSSProperties) : undefined}
      tabIndex={hint ? 0 : undefined}
    >
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  )
  if (!hint) return tile
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

function SourceBadge({ model }: { model: UtilizationModel }) {
  if (model.source === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="utilization-source" data-source="none" tabIndex={0}>
            Capacity unavailable
          </span>
        </TooltipTrigger>
        <TooltipContent>
          No folder reported deployed Unattended or Serverless runtimes, so there is no capacity to compare against.
          Consumed hours are still shown.
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
      <TooltipContent>
        The most Unattended and Serverless runtimes deployed to any one folder. Folder totals are not added together,
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

export function UtilizationView({
  model,
  sinceDays,
  isLoading,
}: {
  model: UtilizationModel
  sinceDays: number
  isLoading: boolean
}) {
  const tone = model.displayPct != null ? utilizationTone(model.displayPct) : null
  const emptyText = isLoading
    ? 'Loading job history…'
    : `No Unattended or Serverless jobs ran in the last ${sinceDays} days.`

  return (
    <section className="utilization-view" aria-label="Robot utilization">
      <div className="utilization-panel">
        <header className="utilization-header">
          <div className="utilization-title">
            <Gauge size={18} aria-hidden="true" />
            <h2>Robot utilization</h2>
            <SourceBadge model={model} />
          </div>
          <span className="utilization-scope">Whole tenant · last {sinceDays} days · filters don't apply</span>
        </header>

        <div className="header-metric-stats utilization-tiles">
          {model.utilizationPct != null && model.displayPct != null && tone ? (
            <Tile
              label="Utilization"
              value={formatPct(model.displayPct)}
              tone={toneColor[tone]}
              hint={
                model.utilizationPct > 100
                  ? `Raw ${formatPct(model.utilizationPct)}: more hours were used than the capacity floor allows, so real capacity is higher than shown.`
                  : `Raw ${model.utilizationPct.toFixed(1)}% of capacity.`
              }
            />
          ) : null}
          {model.capacityHours != null ? (
            <Tile label="Capacity" value={formatHours(model.capacityHours)} tone="var(--metric-utilization)" />
          ) : null}
          <Tile label="Consumed" value={formatHours(model.consumedHours)} tone="var(--metric-runs)" />
          {model.idleHours != null ? <Tile label="Idle" value={formatHours(model.idleHours)} /> : null}
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
          Consumed counts Unattended and Serverless job time, including faulted and stopped runs, in folders that have
          at least one trigger.
        </p>

        <div className="utilization-tables">
          <UsageTable caption="By robot" emptyText={emptyText} nameHeading="Robot" rows={model.robots} showBars />
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
      </div>
    </section>
  )
}
