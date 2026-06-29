// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../../components/ui/tooltip'
import { FilterToolbar } from '../components/FilterToolbar'
import type { MachineOption } from '../types'

// Radix tooltips throw without a provider; the app supplies one at the root.
const render = (ui: ReactElement, options?: Parameters<typeof baseRender>[1]) =>
  baseRender(ui, { wrapper: TooltipProvider, ...options })

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}

afterEach(() => cleanup())

const makeMachine = (id: number, name: string): MachineOption => ({ id, name })

const renderToolbar = (props: {
  machines?: MachineOption[]
  robotOptions?: { id: number; name: string }[]
}) =>
  render(
    <FilterToolbar
      query=""
      setQuery={vi.fn()}
      selectedFolderIds={[]}
      setSelectedFolderIds={vi.fn()}
      setStatusFilter={vi.fn()}
      setTriggerTypeFilter={vi.fn()}
      setWorkspaceView={vi.fn()}
      statusFilter="enabled"
      statusAwareFolders={[]}
      triggerTypeFilter="all"
      workspaceView="calendar"
      machines={props.machines}
      selectedMachineIds={props.machines ? [] : undefined}
      setSelectedMachineIds={props.machines ? vi.fn() : undefined}
      robotOptions={props.robotOptions}
      selectedRobotIds={props.robotOptions ? [] : undefined}
      setSelectedRobotIds={props.robotOptions ? vi.fn() : undefined}
    />,
  )

describe('FilterToolbar machine picker search', () => {
  it('renders a search box only when the machine count exceeds the threshold', async () => {
    const machines = [
      ...Array.from({ length: 8 }, (_, i) => makeMachine(i + 1, `prod-${String(i + 1).padStart(2, '0')}`)),
      makeMachine(9, 'staging-01'),
      makeMachine(10, 'staging-02'),
    ]
    renderToolbar({ machines })

    fireEvent.click(screen.getByRole('button', { name: 'Machine filter' }))

    expect(await screen.findByRole('textbox', { name: 'Search machine options' })).toBeInTheDocument()
  })

  it('omits the search box when the machine count is within the threshold', async () => {
    const machines = Array.from({ length: 5 }, (_, i) => makeMachine(i + 1, `prod-${i + 1}`))
    renderToolbar({ machines })

    fireEvent.click(screen.getByRole('button', { name: 'Machine filter' }))

    expect(await screen.findByText('prod-1')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search machine options' })).not.toBeInTheDocument()
  })

  it('filters the machine list by a case-insensitive substring and shows a no-match message', async () => {
    const machines = [
      ...Array.from({ length: 8 }, (_, i) => makeMachine(i + 1, `prod-${String(i + 1).padStart(2, '0')}`)),
      makeMachine(9, 'staging-01'),
      makeMachine(10, 'staging-02'),
    ]
    renderToolbar({ machines })

    fireEvent.click(screen.getByRole('button', { name: 'Machine filter' }))
    const searchBox = await screen.findByRole('textbox', { name: 'Search machine options' })

    fireEvent.change(searchBox, { target: { value: 'STAGING' } })
    expect(screen.getByText('staging-01')).toBeInTheDocument()
    expect(screen.getByText('staging-02')).toBeInTheDocument()
    expect(screen.queryByText('prod-01')).not.toBeInTheDocument()

    fireEvent.change(searchBox, { target: { value: 'zzz-no-host' } })
    expect(screen.getByText('No machines match this search.')).toBeInTheDocument()
  })

  it('resets the machine search when the picker closes', async () => {
    const machines = [
      ...Array.from({ length: 8 }, (_, i) => makeMachine(i + 1, `prod-${String(i + 1).padStart(2, '0')}`)),
      makeMachine(9, 'staging-01'),
      makeMachine(10, 'staging-02'),
    ]
    renderToolbar({ machines })

    const trigger = screen.getByRole('button', { name: 'Machine filter' })
    fireEvent.click(trigger)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search machine options' }), {
      target: { value: 'staging' },
    })
    expect(screen.queryByText('prod-01')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.click(trigger)

    expect(await screen.findByText('prod-01')).toBeInTheDocument()
  })
})

describe('FilterToolbar robot picker search', () => {
  it('omits the search box for a single-robot tenant', async () => {
    renderToolbar({ robotOptions: [{ id: 1, name: 'rparobot' }] })

    fireEvent.click(screen.getByRole('button', { name: 'Robot filter' }))

    expect(await screen.findByText('rparobot')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search robot options' })).not.toBeInTheDocument()
  })

  it('renders and filters the robot search when the robot count exceeds the threshold', async () => {
    const robotOptions = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `bot-${String(i + 1).padStart(2, '0')}` })),
      { id: 9, name: 'special-bot' },
    ]
    renderToolbar({ robotOptions })

    fireEvent.click(screen.getByRole('button', { name: 'Robot filter' }))
    const searchBox = await screen.findByRole('textbox', { name: 'Search robot options' })

    fireEvent.change(searchBox, { target: { value: 'special' } })
    expect(screen.getByText('special-bot')).toBeInTheDocument()
    expect(screen.queryByText('bot-01')).not.toBeInTheDocument()
  })
})
