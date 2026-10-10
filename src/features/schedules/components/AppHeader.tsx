import type { CSSProperties } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Moon, PlugZap, RefreshCcw, Sun, X } from 'lucide-react'
import { BrandGlyph } from '@/components/BrandGlyph'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { APP_VERSION } from '@/whatsNew'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatNumber } from '../formatters'
import { defaultLifecycleHorizonDays, iconSize, lifecycleHorizonOptions } from '../constants'
import type { TenantOption } from '../types'
import type { SummaryMetricKey } from '../summaryMetrics'
import type { SummaryMetric } from './SummaryBand'

type HeaderFilterChip = {
  label: string
  onClear: () => void
}

const ACTIONABLE_METRIC_KEYS: ReadonlySet<SummaryMetricKey> = new Set([
  'duplicateSchedules',
  'stale',
  'collisions',
  'expiring',
])

const chipNoun = (key: SummaryMetricKey, value: number): string => {
  if (key === 'duplicateSchedules') return value === 1 ? 'duplicate' : 'duplicates'
  if (key === 'stale') return value === 1 ? 'stale trigger' : 'stale triggers'
  if (key === 'collisions') return value === 1 ? 'collision' : 'collisions'
  if (key === 'expiring') return value === 1 ? 'expiring trigger' : 'expiring triggers'
  return ''
}

export function AppHeader({
  activeMetricKey,
  activeTenantName,
  connectionLabel,
  connectionState,
  connectionTitle,
  environmentDisplayLabel,
  headerFilterChips,
  horizonDays,
  isLoading,
  isRevalidating,
  metrics,
  nextThemeLabel,
  onHorizonChange,
  onManageConnection,
  onMetricClick,
  onTenantChange,
  refresh,
  resolvedTheme,
  selectedStressCount,
  selectedTenant,
  setThemeMode,
  tenantOptions,
}: {
  activeMetricKey?: SummaryMetricKey | null
  activeTenantName: string
  connectionLabel: string
  connectionState: 'connected' | 'syncing' | 'issue'
  connectionTitle: string
  environmentDisplayLabel: string
  headerFilterChips: HeaderFilterChip[]
  horizonDays?: number
  isLoading: boolean
  isRevalidating?: boolean
  metrics?: SummaryMetric[]
  nextThemeLabel: string
  onHorizonChange?: (days: number) => void
  onManageConnection?: () => void
  onMetricClick?: (key: SummaryMetricKey) => void
  onTenantChange: (tenantName: string) => void
  refresh: () => void
  resolvedTheme: 'light' | 'dark'
  selectedStressCount: number | null
  selectedTenant: string
  setThemeMode: (theme: 'light' | 'dark') => void
  tenantOptions: TenantOption[]
}) {
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

  return (
    <header className="top-bar">
      <div className="title-block">
        <div className="title-heading">
          <BrandGlyph />
          <h1>Process Schedule Manager</h1>
          <div className="header-badges" aria-label="Application context">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="version-badge title-version-badge">
                  v{APP_VERSION}
                </span>
              </TooltipTrigger>
              <TooltipContent>Application version {APP_VERSION}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`env-badge env-${environmentDisplayLabel.toLowerCase()}`}>
                  {environmentDisplayLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent>{`Environment: ${environmentDisplayLabel}`}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="tenant-badge">
                  {activeTenantName}
                </span>
              </TooltipTrigger>
              <TooltipContent>{`Tenant: ${activeTenantName}`}</TooltipContent>
            </Tooltip>
            {selectedStressCount ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="stress-badge">
                    Stress: {formatNumber(selectedStressCount)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Generated local fixture data for visual stress testing. This bypasses live Orchestrator reads.
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`connection-badge ${connectionState}`}>
                  <span aria-hidden="true" />
                  {connectionLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent>{connectionTitle}</TooltipContent>
            </Tooltip>
            {headerFilterChips.map((chip) => (
              <Tooltip key={chip.label}>
                <TooltipTrigger asChild>
                  <button
                    className="filter-chip header-filter-chip"
                    onClick={chip.onClear}
                    type="button"
                  >
                    {chip.label}
                    <X size={12} aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{`Clear ${chip.label}`}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
      <div className="top-actions">
        {onManageConnection ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="text-button connection-manage-button"
                onClick={onManageConnection}
                type="button"
                aria-label="Manage UiPath connection"
              >
                <PlugZap size={iconSize} aria-hidden="true" />
                Connection
              </button>
            </TooltipTrigger>
            <TooltipContent>Manage remembered UiPath connection settings</TooltipContent>
          </Tooltip>
        ) : null}
        <div className="tenant-control">
          <Select value={selectedTenant} onValueChange={onTenantChange}>
            <SelectTrigger
              aria-label={`Change tenant. Current tenant: ${activeTenantName}`}
              className="tenant-select-trigger"
            >
              <span>Change Tenant</span>
            </SelectTrigger>
            <SelectContent>
              {tenantOptions.map((tenant) => (
                <SelectItem key={tenant.name} value={tenant.name}>
                  {tenant.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="icon-button theme-cycle-button"
              onClick={() => setThemeMode(nextTheme)}
              type="button"
              aria-label={nextThemeLabel}
            >
              {resolvedTheme === 'dark' ? <Sun size={iconSize} aria-hidden="true" /> : <Moon size={iconSize} aria-hidden="true" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{`${nextThemeLabel}. The app starts from your system theme on load.`}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="icon-button"
              onClick={refresh}
              type="button"
              aria-label={isRevalidating ? 'Updating' : 'Refresh'}
            >
              {isLoading || isRevalidating ? <Loader2 className="spin" size={iconSize} aria-hidden="true" /> : <RefreshCcw size={iconSize} aria-hidden="true" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isRevalidating ? 'Updating…' : 'Refresh'}</TooltipContent>
        </Tooltip>
      </div>
      {metrics && metrics.length > 0 ? (() => {
        const stats = metrics.filter(
          (m) => !ACTIONABLE_METRIC_KEYS.has(m.key) || !onMetricClick,
        )
        const actionable = metrics.filter(
          (m) => ACTIONABLE_METRIC_KEYS.has(m.key) && Boolean(onMetricClick),
        )
        const issuesPresent = actionable.filter((m) => m.value > 0)
        const showActions = actionable.length > 0

        return (
          <div className="header-metrics" aria-label="Summary metrics">
            <div className="header-metric-stats">
              {stats.map((metric) => (
                <div
                  key={metric.key}
                  className="header-metric-item"
                  style={{ '--tile-tone': metric.tone } as CSSProperties}
                >
                  <strong>{formatNumber(metric.value)}</strong>
                  <small>{metric.label}</small>
                </div>
              ))}
            </div>
            {showActions || onHorizonChange ? (
              <div className="header-metric-actions">
                {showActions ? (
                <div className="header-alert-chips" role="group" aria-label="Trigger issues">
                {issuesPresent.length === 0 ? (
                  <span
                    className="header-alert-chip is-clear"
                    aria-label="No trigger issues — all healthy"
                  >
                    <CheckCircle2 size={14} aria-hidden="true" />
                    <span>All clear</span>
                  </span>
                ) : (
                  issuesPresent.map((metric) => {
                    const isActive = metric.key === activeMetricKey
                    return (
                      <Tooltip key={metric.key}>
                        <TooltipTrigger asChild>
                          <button
                            className={`header-alert-chip${isActive ? ' is-active' : ''}`}
                            onClick={() => onMetricClick?.(metric.key)}
                            style={{ '--tile-tone': metric.tone } as CSSProperties}
                            type="button"
                            aria-pressed={isActive}
                          >
                            <AlertTriangle size={14} aria-hidden="true" />
                            <strong>{formatNumber(metric.value)}</strong>
                            <span>{chipNoun(metric.key, metric.value)}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{metric.description}</TooltipContent>
                      </Tooltip>
                    )
                  })
                )}
                </div>
                ) : null}
                {/* Deliberately outside the chip block above: that block collapses to a single
                    "All clear" pill when no metric has a non-zero value, so a horizon control
                    nested inside it would disappear in exactly the case you need it — zero
                    triggers expiring in 14 days, and no way to widen the window to find the ones
                    ending in six months. Gated on its own handler, not on showActions, which also
                    depends on onMetricClick. */}
                {onHorizonChange ? (
                  <div className="header-horizon">
                    <span className="header-horizon-label" aria-hidden="true">
                      Expiring within
                    </span>
                    <ToggleGroup
                      aria-label="Expiring within"
                      onValueChange={(value) => {
                        // Radix emits '' when the active item is pressed again. There is no
                        // "no horizon" state, so ignore it rather than clearing the window.
                        if (value) onHorizonChange(Number(value))
                      }}
                      type="single"
                      value={String(horizonDays ?? defaultLifecycleHorizonDays)}
                    >
                      {lifecycleHorizonOptions.map((option) => (
                        <ToggleGroupItem key={option.days} value={String(option.days)}>
                          {option.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })() : null}
    </header>
  )
}

export type { HeaderFilterChip }
