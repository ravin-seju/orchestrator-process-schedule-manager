// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { stressCapacityRuntimes, stressRobotNames, stressRobotUsage } from '@/features/schedules/stressData'
import { UtilizationView } from '@/features/utilization/components/UtilizationView'
import { buildUtilizationModel } from '@/features/utilization/model'

afterEach(() => cleanup())

const folderNames = new Map([
  [8101, 'Shared'],
  [8102, 'Finance Ops'],
  [8104, 'Customer Ops'],
])

const renderView = (capacityRuntimes: number | null, isLoading = false) =>
  render(
    <TooltipProvider>
      <UtilizationView
        isLoading={isLoading}
        model={buildUtilizationModel({
          capacityRuntimes,
          usage: stressRobotUsage,
          sinceDays: 30,
          robotNames: stressRobotNames,
          folderNames,
        })}
        sinceDays={30}
      />
    </TooltipProvider>,
  )

const tile = (label: string) => screen.getByText(label).closest('.header-metric-item')

describe('UtilizationView', () => {
  it('shows the headline tiles, the meter and the runtime capacity badge', () => {
    renderView(stressCapacityRuntimes)

    expect(screen.getByRole('heading', { name: 'Robot utilization' })).toBeInTheDocument()
    expect(screen.getByText('At least 10 runtimes')).toBeInTheDocument()
    expect(tile('Utilization')).toHaveTextContent('41%')
    expect(tile('Capacity')).toHaveTextContent('7,200 h')
    expect(tile('Consumed')).toHaveTextContent('2,952 h')
    expect(tile('Idle')).toHaveTextContent('4,248 h')
    expect(screen.getByRole('meter', { name: 'Utilization' })).toHaveAttribute('aria-valuenow', '41')
    expect(screen.getByText(/Whole tenant · last 30 days/)).toBeInTheDocument()
  })

  it('lists robots by hours with share bars, including an idle robot', () => {
    renderView(stressCapacityRuntimes)

    const table = screen.getByText('By robot').closest('.utilization-table-block') as HTMLElement
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Bot.Alpha',
      'Bot.Beta',
      'Bot.Gamma',
      'Bot.Delta',
    ])
    expect(within(rows[0]).getByRole('img', { name: '62% of consumed hours' })).toBeInTheDocument()
    expect(within(rows[3]).getByText('0 h')).toBeInTheDocument()
  })

  it('shows folder shares as plain percentages', () => {
    renderView(stressCapacityRuntimes)

    const table = screen.getByText('By folder (share of consumed)').closest('.utilization-table-block') as HTMLElement
    const firstRow = within(table).getAllByRole('row')[1]
    expect(within(firstRow).getByText('Finance Ops')).toBeInTheDocument()
    expect(within(firstRow).getByText('45%')).toBeInTheDocument()
    expect(within(table).queryByRole('img')).not.toBeInTheDocument()
  })

  it('drops the percentage, meter and idle tile when capacity is unknown', () => {
    renderView(null)

    expect(screen.getByText('Capacity unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Utilization')).not.toBeInTheDocument()
    expect(screen.queryByText('Capacity')).not.toBeInTheDocument()
    expect(screen.queryByText('Idle')).not.toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    expect(tile('Consumed')).toHaveTextContent('2,952 h')
  })

  it('says job history is loading instead of showing empty tables', () => {
    render(
      <TooltipProvider>
        <UtilizationView
          isLoading
          model={buildUtilizationModel({
            capacityRuntimes: null,
            usage: { totalSec: 0, byRobot: new Map(), byFolder: new Map() },
            sinceDays: 30,
            robotNames: new Map(),
            folderNames,
          })}
          sinceDays={30}
        />
      </TooltipProvider>,
    )

    expect(screen.getAllByText('Loading job history…')).toHaveLength(2)
  })
})
