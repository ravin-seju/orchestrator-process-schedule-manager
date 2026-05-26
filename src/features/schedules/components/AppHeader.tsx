import type { CSSProperties } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Moon, PlugZap, RefreshCcw, Sun, X } from 'lucide-react'
import { BrandGlyph } from '@/components/BrandGlyph'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { formatNumber } from '../formatters'
import { iconSize } from '../constants'
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
])

const chipNoun = (key: SummaryMetricKey, value: number): string => {
  if (key === 'duplicateSchedules') return value === 1 ? 'duplicate' : 'duplicates'
  if (key === 'stale') return value === 1 ? 'stale trigger' : 'stale triggers'
  if (key === 'collisions') return value === 1 ? 'collision' : 'collisions'
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
  isLoading,
  metrics,
  nextThemeLabel,
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
  isLoading: boolean
  metrics?: SummaryMetric[]
  nextThemeLabel: string
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
            <span className="version-badge title-version-badge" title="Application version 1.0">
              v1.0
            </span>
            <span className={`env-badge env-${environmentDisplayLabel.toLowerCase()}`} title={`Environment: ${environmentDisplayLabel}`}>
              {environmentDisplayLabel}
            </span>
            <span className="tenant-badge" title={`Tenant: ${activeTenantName}`}>
              {activeTenantName}
            </span>
            {selectedStressCount ? (
              <span
                className="stress-badge"
                title="Generated local fixture data for visual stress testing. This bypasses live Orchestrator reads."
              >
                Stress: {formatNumber(selectedStressCount)}
              </span>
            ) : null}
            <span className={`connection-badge ${connectionState}`} title={connectionTitle}>
              <span aria-hidden="true" />
              {connectionLabel}
            </span>
            {headerFilterChips.map((chip) => (
              <button
                className="filter-chip header-filter-chip"
                key={chip.label}
                onClick={chip.onClear}
                title={`Clear ${chip.label}`}
                type="button"
              >
                {chip.label}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="top-actions">
        {onManageConnection ? (
          <button
            className="text-button connection-manage-button"
            onClick={onManageConnection}
            type="button"
            aria-label="Manage UiPath connection"
            title="Manage remembered UiPath connection settings"
          >
            <PlugZap size={iconSize} aria-hidden="true" />
            Connection
          </button>
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
        <button
          className="icon-button theme-cycle-button"
          onClick={() => setThemeMode(nextTheme)}
          type="button"
          aria-label={nextThemeLabel}
          title={`${nextThemeLabel}. The app starts from your system theme on load.`}
        >
          {resolvedTheme === 'dark' ? <Sun size={iconSize} aria-hidden="true" /> : <Moon size={iconSize} aria-hidden="true" />}
        </button>
        <button className="icon-button" onClick={refresh} type="button" aria-label="Refresh">
          {isLoading ? <Loader2 className="spin" size={iconSize} aria-hidden="true" /> : <RefreshCcw size={iconSize} aria-hidden="true" />}
        </button>
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
            {showActions ? (
              <div className="header-metric-actions" role="group" aria-label="Trigger issues">
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
                      <button
                        key={metric.key}
                        className={`header-alert-chip${isActive ? ' is-active' : ''}`}
                        onClick={() => onMetricClick?.(metric.key)}
                        style={{ '--tile-tone': metric.tone } as CSSProperties}
                        type="button"
                        aria-pressed={isActive}
                        title={metric.description}
                      >
                        <AlertTriangle size={14} aria-hidden="true" />
                        <strong>{formatNumber(metric.value)}</strong>
                        <span>{chipNoun(metric.key, metric.value)}</span>
                      </button>
                    )
                  })
                )}
              </div>
            ) : null}
          </div>
        )
      })() : null}
    </header>
  )
}

export type { HeaderFilterChip }
