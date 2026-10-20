// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { stressFolderRuntimes, stressRobotNames, stressUsage } from '@/features/schedules/stressData'
import { UtilizationView } from '@/features/utilization/components/UtilizationView'
import { buildUtilizationModel, type UtilizationInput } from '@/features/utilization/model'

afterEach(() => cleanup())

const folderNames = new Map([
  [8101, 'Shared'],
  [8102, 'Finance Ops'],
  [8104, 'Customer Ops'],
])

const renderView = (
  overrides: Partial<UtilizationInput> = {},
  { isCapacityLoading = false, isLoading = false } = {},
) =>
  render(
    <TooltipProvider>
      <UtilizationView
        isCapacityLoading={isCapacityLoading}
        isLoading={isLoading}
        model={buildUtilizationModel({
          folderRuntimes: stressFolderRuntimes,
          usage: stressUsage,
          excludedFolderIds: new Set(),
          sinceDays: 30,
          robotNames: stressRobotNames,
          folderNames,
          ...overrides,
        })}
        sinceDays={30}
      />
    </TooltipProvider>,
  )

const tile = (label: string) => screen.getByText(label).closest('.header-metric-item') as HTMLElement

const hintFor = async (label: string) => {
  fireEvent.focus(tile(label))
  return (await screen.findByRole('tooltip')).textContent
}

const tableRows = (caption: string) => {
  const block = screen.getByText(caption).closest('.utilization-table-block') as HTMLElement
  return within(block).getAllByRole('row').slice(1)
}

describe('UtilizationView', () => {
  it('shows the headline tiles, the meter and the runtime capacity badge', () => {
    renderView()

    expect(screen.getByRole('heading', { name: 'Robot utilization' })).toBeInTheDocument()
    expect(screen.getByText('At least 10 runtimes')).toBeInTheDocument()
    expect(tile('Utilization')).toHaveTextContent('41%')
    expect(tile('Capacity')).toHaveTextContent('7,200 h')
    expect(tile('Consumed')).toHaveTextContent('2,952 h')
    expect(tile('Idle')).toHaveTextContent('4,248 h')
    expect(screen.getByRole('meter', { name: 'Utilization' })).toHaveAttribute('aria-valuenow', '41')
    expect(screen.getByText(/Whole tenant · last 30 days/)).toBeInTheDocument()
  })

  it('shows the calculation behind the utilization tile', async () => {
    renderView()
    expect(await hintFor('Utilization')).toContain('2,952 h consumed ÷ 7,200 h capacity = 41.0%')
  })

  it('shows the calculation behind the capacity tile', async () => {
    renderView()
    const hint = await hintFor('Capacity')
    expect(hint).toContain('10 runtimes × 24 h × 30 days = 7,200 h')
    expect(hint).toContain('(Finance Ops)')
  })

  it('shows the calculation behind the consumed tile', async () => {
    renderView()
    const hint = await hintFor('Consumed')
    expect(hint).toContain('Sum of job durations (end − start) over the last 30 days')
    expect(hint).toContain('across 3 folders = 2,952 h')
  })

  it('shows the calculation behind the idle tile', async () => {
    renderView()
    expect(await hintFor('Idle')).toContain('7,200 h capacity − 2,952 h consumed = 4,248 h')
  })

  it('lists robots with counted time by hours, with share bars', () => {
    renderView()

    const rows = tableRows('By robot')
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Bot.Alpha',
      'Bot.Beta',
      'Bot.Gamma',
    ])
    expect(within(rows[0]).getByRole('img', { name: '62% of consumed hours' })).toBeInTheDocument()
  })

  it('shows folder shares as plain percentages', () => {
    renderView()

    const [first] = tableRows('By folder (share of consumed)')
    expect(within(first).getByText('Finance Ops')).toBeInTheDocument()
    expect(within(first).getByText('45%')).toBeInTheDocument()
  })

  it('breaks runtime types down, with uncounted types marked', () => {
    renderView()

    const rows = tableRows('By runtime type').map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
    expect(rows).toEqual([
      ['Unattended (Production)', '8', '2,036 h', 'Yes'],
      ['Cloud Serverless', '3', '650 h', 'Yes'],
      ['Testing', '2', '266 h', 'Yes'],
      ['Development', '2', '12 h', 'No'],
    ])
  })

  it('leaves personal workspaces out and says how much was left out', async () => {
    renderView({ excludedFolderIds: new Set([8101]) })

    expect(tile('Consumed')).toHaveTextContent('2,302 h')
    expect(tableRows('By robot').map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Bot.Alpha',
      'Bot.Beta',
    ])
    expect(await hintFor('Consumed')).toContain('662 h in personal workspaces is left out.')
  })

  it('drops the percentage, meter and idle tile when capacity is unknown', () => {
    renderView({ folderRuntimes: [] })

    expect(screen.getByText('Capacity unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Utilization')).not.toBeInTheDocument()
    expect(screen.queryByText('Capacity')).not.toBeInTheDocument()
    expect(screen.queryByText('Idle')).not.toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    expect(tile('Consumed')).toHaveTextContent('2,952 h')
  })

  it('says capacity is being checked, not unavailable, while runtimes load', () => {
    renderView({ folderRuntimes: [] }, { isCapacityLoading: true })

    expect(screen.getByText('Checking capacity…')).toBeInTheDocument()
    expect(screen.queryByText('Capacity unavailable')).not.toBeInTheDocument()
  })

  it('explains that a robot account can pass 720 hours', () => {
    renderView()
    expect(screen.getByText(/its hours can pass 720 h \(30 days × 24 h\)/)).toBeInTheDocument()
  })

  it('says job history is loading instead of showing empty tables', () => {
    renderView({ folderRuntimes: [], usage: [], robotNames: new Map() }, { isLoading: true })
    expect(screen.getAllByText('Loading job history…')).toHaveLength(3)
  })
})
