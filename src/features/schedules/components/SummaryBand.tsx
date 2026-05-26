import type { ReactNode } from 'react'
import { StatTile } from './StatTile'
import type { SummaryMetricKey } from '../summaryMetrics'

export type SummaryMetric = {
  description?: string
  icon: ReactNode
  key: SummaryMetricKey
  label: string
  tone: string
  value: number
}

export function SummaryBand({ metrics }: { metrics: SummaryMetric[] }) {
  return (
    <section className="summary-band" aria-label="Summary">
      {metrics.map((metric) => (
        <StatTile
          key={metric.label}
          icon={metric.icon}
          label={metric.label}
          description={metric.description}
          value={metric.value}
          tone={metric.tone}
        />
      ))}
    </section>
  )
}
