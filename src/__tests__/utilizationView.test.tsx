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
  [8103, 'Finance Ops/Onboarding'],
  [8104, 'Customer Ops'],
  [8105, 'IT Operations/Patching'],
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
        runtimesFetchedAt={new Date(2026, 9, 20, 10, 42).getTime()}
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

const tiles = () => document.querySelector('.utilization-tiles') as HTMLElement
const tile = (label: string) => within(tiles()).getByText(label).closest('.header-metric-item') as HTMLElement

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
    expect(hint).toContain('across 4 folders = 2,952 h')
  })

  it('shows the calculation behind the idle tile', async () => {
    renderView()
    expect(await hintFor('Idle')).toContain('7,200 h capacity − 2,952 h consumed = 4,248 h')
  })

  it('lists robots with counted time by hours, with their runtime types and share bars', () => {
    renderView()

    const rows = tableRows('By robot')
    expect(rows.map((row) => within(row).getAllByRole('cell').slice(0, 3).map((cell) => cell.textContent))).toEqual([
      ['Bot.Alpha', 'Unattended+1', '1,830 h'],
      ['Bot.Beta', 'Unattended+1', '738 h'],
      ['Bot.Gamma', 'Unattended', '384 h'],
    ])
    expect(within(rows[0]).getByRole('img', { name: '62% of consumed hours' })).toBeInTheDocument()
  })

  it('lists every runtime type of a robot in a tooltip', async () => {
    renderView()

    const [alpha] = tableRows('By robot')
    fireEvent.focus(within(alpha).getByText('+1').closest('.utilization-type-list') as HTMLElement)
    expect((await screen.findByRole('tooltip')).textContent).toBe('Unattended: 1,180 h · Cloud Serverless: 650 h')
  })

  it('rolls folders up to their root and shows shares as plain percentages', () => {
    renderView()

    const rows = tableRows('By root folder (share of consumed)').map((row) =>
      within(row).getAllByRole('cell').map((cell) => cell.textContent),
    )
    expect(rows).toEqual([
      ['Finance Ops · 2 folders', '10', '1,712 h', '58%'],
      ['Customer Ops', '9', '974 h', '33%'],
      ['Shared', '4', '266 h', '9%'],
      ['IT OperationsIdle', '3', '0 h', '—'],
    ])
  })

  it('puts the runtime type table above the robot and folder tables', () => {
    renderView()

    const captions = [...document.querySelectorAll('.utilization-table-block h3')].map((h) => h.textContent?.trim())
    expect(captions).toEqual(['By runtime type', 'By robot', 'By root folder (share of consumed)'])
  })

  it('breaks runtime types down, with uncounted types marked', () => {
    renderView()

    const rows = tableRows('By runtime type').map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
    expect(rows).toEqual([
      ['Unattended', '8', '7', '1', '2,036 h', 'Yes'],
      ['Cloud Serverless', '3', '3', '0', '650 h', 'Yes'],
      ['Testing', '2', '2', '0', '266 h', 'Yes'],
      ['Development', '2', '1', '1', '12 h', 'No'],
    ])
  })

  it('leaves personal workspaces out and says how much was left out', async () => {
    renderView({ excludedFolderIds: new Set([8101]) })

    expect(tile('Consumed')).toHaveTextContent('2,686 h')
    const active = tableRows('By root folder (share of consumed)').filter((row) => row.getAttribute('data-idle') === 'false')
    expect(active.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['Finance Ops · 2 folders', 'Customer Ops'])
    expect(await hintFor('Consumed')).toContain('278 h in personal workspaces is left out.')
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

  it('explains, behind the robot table info icon, that an account can pass 720 hours', async () => {
    renderView()
    fireEvent.focus(screen.getByRole('img', { name: 'About the robot table' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain('its hours can pass 720 h (30 days × 24 h)')
  })

  it('colours the meter so higher utilization reads better: red, orange, then teal', () => {
    const fill = () => document.querySelector('.utilization-meter-fill') as HTMLElement
    // Stress data: 2,952 h consumed.
    renderView() // 10 runtimes = 7,200 h -> 41%
    expect(fill().style.background).toBe('var(--danger)')
    cleanup()
    renderView({ folderRuntimes: [{ folderId: 8102, runtimeType: 'Unattended', total: 5, connected: 5, available: 0 }] }) // 3,600 h -> 82%
    expect(fill().style.background).toBe('var(--orange)')
    cleanup()
    renderView({ folderRuntimes: [{ folderId: 8102, runtimeType: 'Unattended', total: 4, connected: 4, available: 0 }] }) // 2,880 h -> 103%
    expect(fill().style.background).toBe('var(--teal)')
  })

  it('charts busy runtimes for each hour of the day and labels the peak', async () => {
    renderView()

    expect(document.querySelectorAll('.utilization-hourly-bar')).toHaveLength(24)
    expect(screen.getByText('Peak 02:00 · 85% of capacity')).toBeInTheDocument()
    fireEvent.focus(document.querySelector('.utilization-hourly-bar[data-peak="true"]') as HTMLElement)
    expect((await screen.findByRole('tooltip')).textContent).toBe('02:00–03:00: avg 8.5 of 10 runtimes busy (85%)')
  })

  it('shows live, wait, failed and concentration signals with their calculations', async () => {
    renderView()

    const chips = within(screen.getByRole('list', { name: 'Operational signals' }))
    expect(chips.getByText(/Right now: 4 busy · 5 idle · 1 offline/)).toBeInTheDocument()
    expect(chips.getByText(/Jobs waiting > 5 min: \d+%/)).toHaveTextContent('(avg 2.5 min)')
    expect(chips.getByText(/Failed or stopped runs: 4% of hours/)).toHaveTextContent('(118 h)')
    expect(chips.getByText(/One robot account carries 62% of hours/)).toBeInTheDocument()

    fireEvent.focus(chips.getByText(/Right now/))
    expect((await screen.findByRole('tooltip')).textContent).toContain('From Finance Ops, the folder with the most counted runtimes: 10 deployed.')
  })

  it('does not warn about concentration below 50%', () => {
    renderView({
      usage: stressUsage.map((entry) => (entry.robotId === 201 ? { ...entry, sec: entry.sec / 4, byHour: entry.byHour.map((sec) => sec / 4) } : entry)),
    })
    expect(screen.queryByText(/One robot account carries/)).not.toBeInTheDocument()
  })

  it('names the counted column plainly', () => {
    renderView()
    expect(screen.getByRole('columnheader', { name: 'Counted in utilization' })).toBeInTheDocument()
  })

  it('says job history is loading instead of showing empty tables', () => {
    renderView({ folderRuntimes: [], usage: [], robotNames: new Map() }, { isLoading: true })
    expect(screen.getAllByText('Loading job history…')).toHaveLength(3)
  })
})
