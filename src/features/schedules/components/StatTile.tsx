import type { CSSProperties, ReactNode } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatNumber } from '../formatters'

export function StatTile({
  description,
  icon,
  label,
  value,
  tone,
}: {
  description?: string
  icon: ReactNode
  label: string
  value: number | string
  tone: string
}) {
  const formattedValue = typeof value === 'number' ? formatNumber(value) : value
  const tile = (
    <div
      aria-label={description ? `${label}: ${formattedValue}. ${description}` : `${label}: ${formattedValue}`}
      className="stat-tile"
      style={{ '--tile-tone': tone } as CSSProperties}
      tabIndex={description ? 0 : undefined}
    >
      <span className="stat-icon">{icon}</span>
      <span>
        <strong>{formattedValue}</strong>
        <small>{label}</small>
      </span>
    </div>
  )

  if (!description) return tile

  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent className="metric-tooltip-content">
        {description}
      </TooltipContent>
    </Tooltip>
  )
}
