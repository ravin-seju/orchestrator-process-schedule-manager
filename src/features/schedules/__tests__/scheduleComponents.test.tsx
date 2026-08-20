// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render as baseRender, renderHook, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../../components/ui/tooltip'
import {
  buildProcessDayGroups,
  buildSpanBarLayout,
  getYearMonths,
  scheduleKey,
} from '../calendarDisplay'
import { CalendarWorkbench } from '../components/CalendarWorkbench'
import { FilterToolbar } from '../components/FilterToolbar'
import { ScheduleTable } from '../components/ScheduleTable'
import { SummaryBand } from '../components/SummaryBand'
import { UpcomingPanel } from '../components/UpcomingPanel'
import { getEnvironmentDisplayLabel } from '../constants'
import { buildFolderTree, getStatusAwareFolders, pruneSelectedFolderIdsForStatus } from '../folderOptions'
import { buildCalendarItemsByDay, groupOccurrencesByDay, useCalendarModel } from '../hooks/useCalendarModel'
import { useScheduleFilters } from '../hooks/useScheduleFilters'
import type { Folder, ProcessSchedule } from '../orchestrator'
import {
  dateKey,
  getCalendarDays,
  getScheduleOccurrences,
  getVisibleWeekRange,
  getVisibleMonthRange,
  getWeekDays,
  monthLabel,
  sortOccurrences,
} from '../scheduleUtils'
import type { CalendarViewMode, ViewMode } from '../types'

// Components under test now render Radix tooltips, which throw without a
// TooltipProvider ancestor (the app supplies one at the root in App.tsx). Wrap
// every render so isolated component tests share that context. TooltipProvider
// renders no DOM, so container/baseElement assertions are unaffected.
const render = (ui: ReactElement, options?: Parameters<typeof baseRender>[1]) =>
  baseRender(ui, { wrapper: TooltipProvider, ...options })

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}

const openRadixSelect = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
}

afterEach(() => cleanup())

describe('environment display labels', () => {
  it('derives the header environment from the selected connection host', () => {
    expect(getEnvironmentDisplayLabel('https://staging.uipath.com/ravinseju/Demo')).toBe('Staging')
    expect(getEnvironmentDisplayLabel('https://cloud.uipath.com/ravinseju/Demo')).toBe('Cloud')
    expect(getEnvironmentDisplayLabel('https://cloud.uipath.com/stagingorg/Demo')).toBe('Cloud')
    expect(getEnvironmentDisplayLabel('https://alpha.uipath.com/ravinseju/Demo')).toBe('Alpha')
  })
})

const baseSchedule = (overrides: Partial<ProcessSchedule>): ProcessSchedule => ({
  Id: 1,
  Name: 'Process A',
  Enabled: true,
  ReleaseName: 'WeeklyFactoryUtilization_UpdateUploadReport_Performer_Main.xaml',
  PackageName: 'WeeklyFactoryUtilization',
  StartProcessCron: '0 0 10 1/1 * ?',
  StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 10, atMinute: 0 } }),
  StartProcessCronSummary: 'At 10:00 AM',
  StartProcessNextOccurrence: null,
  TimeZoneId: 'Central Standard Time',
  TimeZoneIana: 'America/Chicago',
  folderId: 8101,
  folderName: 'Shared',
  ...overrides,
})

const baseFolder = (overrides: Partial<Folder>): Folder => ({
  DisplayName: 'Shared',
  FullyQualifiedName: 'Shared',
  Id: 8101,
  Key: 'shared-key',
  ...overrides,
})

const buildMonthScenario = () => {
  const viewDate = new Date(2026, 4, 6)
  const calendarDays = getCalendarDays(viewDate)
  const range = getVisibleMonthRange(viewDate)
  const schedules = [
    baseSchedule({
      Id: 1,
      Name: 'Process A',
    }),
    baseSchedule({
      Id: 2,
      Name: 'Hourly Process',
      ReleaseName: 'Download.File',
      StartProcessCron: '0 0 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every hour',
    }),
    baseSchedule({
      Id: 3,
      Name: 'Process C',
      ReleaseName: 'Daily_CheckIn.xaml',
      StartProcessCron: '0 0 8 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 8, atMinute: 0 } }),
      StartProcessCronSummary: 'At 08:00 AM',
    }),
  ]
  const occurrences = sortOccurrences(
    schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
  )
  const occurrencesByDay = groupOccurrencesByDay(occurrences)
  const calendarItemsByDay = buildCalendarItemsByDay(occurrencesByDay)
  const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 2)

  return {
    calendarDays,
    calendarItemsByDay,
    occurrences,
    schedules,
    spanBarLayout,
    viewDate,
  }
}

const renderCalendarWorkbench = ({
  calendarMode = 'month',
  viewMode = 'spanBars',
  overrides = {},
}: {
  calendarMode?: CalendarViewMode
  viewMode?: ViewMode
  overrides?: Partial<Parameters<typeof CalendarWorkbench>[0]>
} = {}) => {
  const scenario = buildMonthScenario()
  const props: Parameters<typeof CalendarWorkbench>[0] = {
    calendarDays: scenario.calendarDays,
    calendarGridRef: createRef<HTMLDivElement>(),
    calendarItemsByDay: scenario.calendarItemsByDay,
    calendarMode,
    calendarRenderMode: viewMode,
    calendarTitle: monthLabel(scenario.viewDate),
    calendarWeekCount: Math.ceil(scenario.calendarDays.length / 7),
    moveCalendar: vi.fn(),
    navigationUnitLabel: 'month',
    onOpenDayDetail: vi.fn(),
    onOpenMonthFromYear: vi.fn(),
    setCalendarMode: vi.fn(),
    setSelectedDayDetail: vi.fn(),
    setViewMode: vi.fn(),
    setViewDate: vi.fn(),
    shouldRenderSpanBars: calendarMode !== 'year' && viewMode === 'spanBars',
    spanBars: scenario.spanBarLayout.bars,
    viewMode,
    todayKey: dateKey(scenario.viewDate),
    viewDate: scenario.viewDate,
    visibleSpanLaneLimit: 2,
    yearMonths: getYearMonths(scenario.viewDate),
    ...overrides,
  }

  return {
    ...render(<CalendarWorkbench {...props} />),
    props,
    scenario,
  }
}

const dayRange = (date: Date) => {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

const hourlyGroupForDay = () => {
  const schedule = baseSchedule({
    Id: 10,
    Name: 'Hourly Process',
    ReleaseName: 'Download.File',
    StartProcessCron: '0 0 * 1/1 * ?',
    StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
    StartProcessCronSummary: 'Every hour',
  })
  const date = new Date(2026, 4, 6)
  const { start, end } = dayRange(date)
  const occurrences = getScheduleOccurrences(schedule, start, end)
  const group = buildProcessDayGroups(occurrences)[0]

  return { date, group, occurrences, schedule }
}

const robotGroupForDay = () => {
  const schedule = baseSchedule({
    Id: 10,
    Name: 'Hourly Process',
    ReleaseName: 'Download.File',
    StartProcessCron: '0 0 * 1/1 * ?',
    StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
    StartProcessCronSummary: 'Every hour',
    MachineRobots: [
      { MachineId: 501, MachineName: 'ROBOT-VM-01', RobotId: 201, RobotUserName: 'Bot.Alpha', SessionId: null, SessionName: null },
    ],
  })
  const date = new Date(2026, 4, 6)
  const { start, end } = dayRange(date)
  const occurrences = getScheduleOccurrences(schedule, start, end)
  const group = buildProcessDayGroups(occurrences)[0]

  return { date, group, occurrences, schedule }
}

describe('SummaryBand component', () => {
  it('renders the filter-aware summary metric labels and formatted values', () => {
    render(
      <SummaryBand
        metrics={[
          { icon: <span aria-hidden="true" />, key: 'triggers', label: 'Triggers', tone: '#2563eb', value: 1_200 },
          { icon: <span aria-hidden="true" />, key: 'enabled', label: 'Enabled', tone: '#0f766e', value: 1_100 },
          { icon: <span aria-hidden="true" />, key: 'duplicateSchedules', label: 'High Frequency', tone: '#4f46e5', value: 25 },
          { icon: <span aria-hidden="true" />, key: 'activeToday', label: 'Runs Today', tone: '#0891b2', value: 9_876 },
        ]}
      />,
    )

    expect(screen.getByText('Triggers')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('High Frequency')).toBeInTheDocument()
    expect(screen.getByText('Runs Today')).toBeInTheDocument()
    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('1,100')).toBeInTheDocument()
    expect(screen.getByText('9,876')).toBeInTheDocument()
  })
})

describe('FilterToolbar component', () => {
  it('keeps All folders visible and renders the provided status-aware folders', async () => {
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
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 8101 }),
          baseFolder({ DisplayName: 'HR Automation', FullyQualifiedName: 'HR Automation', Id: 8103 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))

    expect(await screen.findByRole('button', { name: 'All folders' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shared' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HR Automation' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finance Ops' })).not.toBeInTheDocument()
  })

  it('supports selecting multiple status-aware folders with OR semantics', async () => {
    const setSelectedFolderIds = vi.fn()

    render(
      <FilterToolbar
        query=""
        setQuery={vi.fn()}
        selectedFolderIds={['8101']}
        setSelectedFolderIds={setSelectedFolderIds}
        setStatusFilter={vi.fn()}
        setTriggerTypeFilter={vi.fn()}
        setWorkspaceView={vi.fn()}
        statusFilter="enabled"
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 8101 }),
          baseFolder({ DisplayName: 'HR Automation', FullyQualifiedName: 'HR Automation', Id: 8103 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))
    fireEvent.click(await screen.findByRole('button', { name: 'HR Automation' }))

    expect(setSelectedFolderIds).toHaveBeenCalledWith(['8101', '8103'])
  })

  it('clears selected folders when All folders is clicked', async () => {
    const setSelectedFolderIds = vi.fn()

    render(
      <FilterToolbar
        query=""
        setQuery={vi.fn()}
        selectedFolderIds={['8101', '8103']}
        setSelectedFolderIds={setSelectedFolderIds}
        setStatusFilter={vi.fn()}
        setTriggerTypeFilter={vi.fn()}
        setWorkspaceView={vi.fn()}
        statusFilter="enabled"
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 8101 }),
          baseFolder({ DisplayName: 'HR Automation', FullyQualifiedName: 'HR Automation', Id: 8103 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    expect(screen.getByRole('button', { name: 'Folder filter' })).toHaveTextContent('2 folders')
    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))
    fireEvent.click(await screen.findByRole('button', { name: 'All folders' }))

    expect(setSelectedFolderIds).toHaveBeenCalledWith([])
  })

  it('keeps full long folder names available while the picker can truncate visible text', async () => {
    const longFolderName = 'TAM_Automations/Team 8/Starter Process/Very Long Folder Name For Customer Operations'

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
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Very Long Folder Name For Customer Operations', FullyQualifiedName: longFolderName, Id: 8109 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))

    const longFolderOption = await screen.findByRole('button', { name: 'Very Long Folder Name For Customer Operations' })
    expect(longFolderOption.querySelector('span:last-child')).toHaveTextContent('Very Long Folder Name For Customer Operations')
    // Full path is preserved in the tooltip (shown on hover/focus) rather than a native title.
    fireEvent.focus(longFolderOption)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(longFolderName)
  })

  it('selects all eligible child and sub-child folders when a parent folder is clicked', async () => {
    const setSelectedFolderIds = vi.fn()

    render(
      <FilterToolbar
        query=""
        setQuery={vi.fn()}
        selectedFolderIds={[]}
        setSelectedFolderIds={setSelectedFolderIds}
        setStatusFilter={vi.fn()}
        setTriggerTypeFilter={vi.fn()}
        setWorkspaceView={vi.fn()}
        statusFilter="enabled"
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Starter Process', FullyQualifiedName: 'TAM_Automations/Team 8/Starter Process', Id: 8109 }),
          baseFolder({ DisplayName: 'Monthly Close', FullyQualifiedName: 'TAM_Automations/Team 8/Monthly Close', Id: 8110 }),
          baseFolder({ DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 8101 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))
    fireEvent.click(await screen.findByRole('button', { name: 'TAM_Automations' }))

    expect(setSelectedFolderIds).toHaveBeenCalledWith(['8109', '8110'])
  })

  it('marks a parent folder indeterminate when only some descendants are selected', async () => {
    render(
      <FilterToolbar
        query=""
        setQuery={vi.fn()}
        selectedFolderIds={['8109']}
        setSelectedFolderIds={vi.fn()}
        setStatusFilter={vi.fn()}
        setTriggerTypeFilter={vi.fn()}
        setWorkspaceView={vi.fn()}
        statusFilter="enabled"
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Starter Process', FullyQualifiedName: 'TAM_Automations/Team 8/Starter Process', Id: 8109 }),
          baseFolder({ DisplayName: 'Monthly Close', FullyQualifiedName: 'TAM_Automations/Team 8/Monthly Close', Id: 8110 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))

    expect((await screen.findByRole('button', { name: 'TAM_Automations' })).querySelector('.folder-option-check')).toHaveClass('is-indeterminate')
  })

  it('keeps hierarchy context visible when folder option search matches a child folder', async () => {
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
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Starter Process', FullyQualifiedName: 'TAM_Automations/Team 8/Starter Process', Id: 8109 }),
          baseFolder({ DisplayName: 'Finance Ops', FullyQualifiedName: 'Finance Ops', Id: 8102 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search folder options' }), {
      target: { value: 'starter' },
    })

    expect(screen.getByRole('button', { name: 'TAM_Automations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Team 8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Starter Process' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finance Ops' })).not.toBeInTheDocument()
  })

  it('reveals matching child folders while search is active even when the parent was collapsed', async () => {
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
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Starter Process', FullyQualifiedName: 'TAM_Automations/Team 8/Starter Process', Id: 8109 }),
          baseFolder({ DisplayName: 'Monthly Close', FullyQualifiedName: 'TAM_Automations/Team 8/Monthly Close', Id: 8110 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Folder filter' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse TAM_Automations' }))

    expect(screen.queryByRole('button', { name: 'Team 8' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search folder options' }), {
      target: { value: 'starter' },
    })

    expect(screen.getByRole('button', { name: 'TAM_Automations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Team 8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Starter Process' })).toBeInTheDocument()
  })

  it('resets folder option search when the folder picker closes', async () => {
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
        statusAwareFolders={[
          baseFolder({ DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 8101 }),
          baseFolder({ DisplayName: 'HR Automation', FullyQualifiedName: 'HR Automation', Id: 8103 }),
        ]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    const folderTrigger = screen.getByRole('button', { name: 'Folder filter' })
    fireEvent.click(folderTrigger)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search folder options' }), {
      target: { value: 'hr' },
    })

    expect(screen.queryByRole('button', { name: 'Shared' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HR Automation' })).toBeInTheDocument()

    fireEvent.click(folderTrigger)
    fireEvent.click(folderTrigger)

    expect(await screen.findByRole('button', { name: 'Shared' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HR Automation' })).toBeInTheDocument()
  })

  it('renders trigger type options from the recurrence legend and updates selection', async () => {
    const setTriggerTypeFilter = vi.fn()

    render(
      <FilterToolbar
        query=""
        setQuery={vi.fn()}
        selectedFolderIds={[]}
        setSelectedFolderIds={vi.fn()}
        setStatusFilter={vi.fn()}
        setTriggerTypeFilter={setTriggerTypeFilter}
        setWorkspaceView={vi.fn()}
        statusFilter="enabled"
        statusAwareFolders={[]}
        triggerTypeFilter="all"
        workspaceView="calendar"
      />,
    )

    const triggerTypeSelect = screen.getByRole('combobox', { name: 'Trigger type' })
    openRadixSelect(triggerTypeSelect)
    expect(await screen.findByRole('option', { name: 'All trigger types' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Minute-by-minute' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Hourly' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Daily' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Weekly' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Monthly' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'One-time/Other' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'Hourly' }))

    expect(setTriggerTypeFilter).toHaveBeenCalledWith('hourly')
  })
})

describe('status-aware folder derivation', () => {
  const folders = [
    baseFolder({ DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 8101 }),
    baseFolder({ DisplayName: 'Finance Ops', FullyQualifiedName: 'Finance Ops', Id: 8102 }),
    baseFolder({ DisplayName: 'HR Automation', FullyQualifiedName: 'HR Automation', Id: 8103 }),
    baseFolder({ DisplayName: 'Empty Folder', FullyQualifiedName: 'Empty Folder', Id: 8104 }),
  ]
  const schedules = [
    baseSchedule({ Enabled: true, folderId: 8101, folderName: 'Shared', Id: 1 }),
    baseSchedule({ Enabled: false, folderId: 8102, folderName: 'Finance Ops', Id: 2 }),
    baseSchedule({ Enabled: true, folderId: 8103, folderName: 'HR Automation', Id: 3 }),
    baseSchedule({ Enabled: false, folderId: 8103, folderName: 'HR Automation', Id: 4 }),
  ]

  it('shows folders with any trigger when the status filter is All', () => {
    expect(getStatusAwareFolders(folders, schedules, 'all').map((folder) => folder.DisplayName)).toEqual([
      'Shared',
      'Finance Ops',
      'HR Automation',
    ])
  })

  it('shows only folders with enabled triggers when the status filter is Enabled', () => {
    expect(getStatusAwareFolders(folders, schedules, 'enabled').map((folder) => folder.DisplayName)).toEqual([
      'Shared',
      'HR Automation',
    ])
  })

  it('shows only folders with disabled triggers when the status filter is Disabled', () => {
    expect(getStatusAwareFolders(folders, schedules, 'disabled').map((folder) => folder.DisplayName)).toEqual([
      'Finance Ops',
      'HR Automation',
    ])
  })

  it('prunes selected folders after a status change', () => {
    const enabledFolders = getStatusAwareFolders(folders, schedules, 'enabled')

    expect(pruneSelectedFolderIdsForStatus([], enabledFolders)).toEqual([])
    expect(pruneSelectedFolderIdsForStatus(['8101', '8102', '8103'], enabledFolders)).toEqual([
      '8101',
      '8103',
    ])
  })

  it('builds virtual parent rows from fully qualified folder names', () => {
    const tree = buildFolderTree([
      baseFolder({ DisplayName: 'Starter Process', FullyQualifiedName: 'TAM_Automations/Team 8/Starter Process', Id: 8109 }),
      baseFolder({ DisplayName: 'Monthly Close', FullyQualifiedName: 'TAM_Automations/Team 8/Monthly Close', Id: 8110 }),
      baseFolder({ DisplayName: 'Shared', FullyQualifiedName: 'Shared', Id: 8101 }),
    ])

    expect(tree.map((node) => node.label)).toEqual(['TAM_Automations', 'Shared'])
    expect(tree[0].eligibleFolderIds).toEqual(['8109', '8110'])
    expect(tree[0].children[0].label).toBe('Team 8')
    expect(tree[0].children[0].eligibleFolderIds).toEqual(['8109', '8110'])
    expect(tree[0].children[0].children.map((node) => node.label)).toEqual(['Starter Process', 'Monthly Close'])
  })
})

describe('useScheduleFilters hook', () => {
  it('filters schedules by trigger type before calendar and inventory rendering', () => {
    const schedules = [
      baseSchedule({
        Id: 41,
        Name: 'Hourly Process',
        StartProcessCron: '0 0 * 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
        StartProcessCronSummary: 'Every hour',
      }),
      baseSchedule({
        Id: 42,
        Name: 'Weekly Process',
        StartProcessCron: '0 0 8 ? * MON',
        StartProcessCronDetails: JSON.stringify({
          type: 3,
          weekly: { atHour: 8, atMinute: 0, weekdays: [{ id: 'MON' }] },
        }),
        StartProcessCronSummary: 'At 08:00 AM, only on Monday',
      }),
    ]

    const { result } = renderHook(() =>
      useScheduleFilters({
        attentionFilter: 'none',
        query: '',
        schedules,
        selectedFolderIds: [],
        statusFilter: 'enabled',
        triggerTypeFilter: 'weekly',
      }),
    )

    expect(result.current.filteredSchedules).toHaveLength(1)
    expect(result.current.filteredSchedules[0].Name).toBe('Weekly Process')
  })

  it('filters schedules by any selected folder', () => {
    const schedules = [
      baseSchedule({ Id: 51, Name: 'Shared Process', folderId: 8101, folderName: 'Shared' }),
      baseSchedule({ Id: 52, Name: 'Finance Process', folderId: 8102, folderName: 'Finance Ops' }),
      baseSchedule({ Id: 53, Name: 'HR Process', folderId: 8103, folderName: 'HR Automation' }),
    ]

    const { result } = renderHook(() =>
      useScheduleFilters({
        attentionFilter: 'none',
        query: '',
        schedules,
        selectedFolderIds: ['8101', '8103'],
        statusFilter: 'enabled',
        triggerTypeFilter: 'all',
      }),
    )

    expect(result.current.filteredSchedules.map((schedule) => schedule.Name)).toEqual([
      'Shared Process',
      'HR Process',
    ])
  })
})

describe('useCalendarModel hook', () => {
  it('scopes selected details by schedule and exact time', () => {
    const viewDate = new Date(2026, 4, 6)
    const schedules = [
      baseSchedule({ Id: 61, Name: 'Clicked Trigger' }),
      baseSchedule({ Id: 62, Name: 'Same Time Trigger' }),
      baseSchedule({
        Id: 63,
        Name: 'Later Trigger',
        StartProcessCron: '0 30 11 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 11, atMinute: 30 } }),
        StartProcessCronSummary: 'At 11:30 AM',
      }),
    ]

    const { result: scopedResult } = renderHook(() =>
      useCalendarModel({
        calendarMode: 'week',
        filteredSchedules: schedules,
        monthSpanLaneLimit: 2,
        selectedDayDetail: {
          date: viewDate,
          key: dateKey(viewDate),
          minuteOfDay: 600,
          scheduleKey: scheduleKey(schedules[0]!),
          scope: 'schedule',
        },
        viewDate,
        viewMode: 'spanBars',
        weekSpanLaneLimit: 7,
      }),
    )

    expect(scopedResult.current.activeSelectedDayDetail?.scope).toBe('schedule')
    expect(scopedResult.current.selectedDayOccurrences.map((occurrence) => occurrence.schedule.Name)).toEqual([
      'Clicked Trigger',
    ])

    const { result: timeSlotResult } = renderHook(() =>
      useCalendarModel({
        calendarMode: 'week',
        filteredSchedules: schedules,
        monthSpanLaneLimit: 2,
        selectedDayDetail: {
          date: viewDate,
          key: dateKey(viewDate),
          minuteOfDay: 600,
          scope: 'time-slot',
        },
        viewDate,
        viewMode: 'spanBars',
        weekSpanLaneLimit: 7,
      }),
    )

    expect(timeSlotResult.current.selectedDayOccurrences.map((occurrence) => occurrence.schedule.Name)).toEqual([
      'Clicked Trigger',
      'Same Time Trigger',
    ])
  })
})

describe('CalendarWorkbench component', () => {
  it('renders month span bars with process-group overflow counts', async () => {
    const { props } = renderCalendarWorkbench()

    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeInTheDocument()
    const viewModeSelect = screen.getByRole('combobox', { name: /trigger layout/i })
    expect(viewModeSelect).toHaveTextContent('Bars')
    openRadixSelect(viewModeSelect)
    expect(screen.queryByRole('option', { name: /Density Rows/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Bars' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Blocks' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Bars' }))

    const overflowButtons = screen.getAllByRole('button', { name: '+1 more' })
    expect(overflowButtons.length).toBeGreaterThan(0)
    fireEvent.click(overflowButtons[0])

    expect(props.setSelectedDayDetail).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    )
    expect(screen.queryByText('+24 more')).not.toBeInTheDocument()
  })

  it('uses the dynamic visible lane limit for month span-bar overflow', () => {
    const scenario = buildMonthScenario()
    const spanBarLayout = buildSpanBarLayout(scenario.calendarDays, scenario.calendarItemsByDay, 3)

    renderCalendarWorkbench({
      overrides: {
        spanBars: spanBarLayout.bars,
        visibleSpanLaneLimit: 3,
      },
    })

    expect(screen.queryByRole('button', { name: '+1 more' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Process C/i }).length).toBeGreaterThan(0)
  })

  it('uses the dynamic visible lane limit for month block overflow', () => {
    renderCalendarWorkbench({
      viewMode: 'timeBlocks',
      overrides: {
        calendarRenderMode: 'timeBlocks',
        visibleSpanLaneLimit: 3,
      },
    })

    expect(screen.queryByRole('button', { name: '+1 more' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Process C/i }).length).toBeGreaterThan(0)
  })

  it('routes calendar toolbar controls through their callbacks', async () => {
    const { props } = renderCalendarWorkbench()

    openRadixSelect(screen.getByRole('combobox', { name: /trigger layout/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'Blocks' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Week' }))
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
    fireEvent.click(screen.getByRole('button', { name: /next month/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))

    expect(props.setViewMode).toHaveBeenCalledWith('timeBlocks')
    expect(props.setCalendarMode).toHaveBeenCalledWith('week')
    expect(props.moveCalendar).toHaveBeenCalledWith(-1)
    expect(props.moveCalendar).toHaveBeenCalledWith(1)
    expect(props.setViewDate).toHaveBeenCalledWith(expect.any(Date))
  })

  it('renders Outlook-style Week only when testing mode is enabled', () => {
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedules = [
      baseSchedule({ Id: 31, Name: 'Daily Process' }),
      baseSchedule({
        Id: 32,
        Name: 'Hourly Process',
        ReleaseName: 'Download.File',
        StartProcessCron: '0 0 * 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
        StartProcessCronSummary: 'Every hour',
      }),
      baseSchedule({ Id: 33, Name: 'Daily Process B' }),
      baseSchedule({
        Id: 34,
        Name: 'Hourly Process B',
        ReleaseName: 'Download.File',
        StartProcessCron: '0 0 * 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
        StartProcessCronSummary: 'Every hour',
      }),
      baseSchedule({
        Id: 35,
        Name: 'Hourly Process C',
        ReleaseName: 'Download.File',
        StartProcessCron: '0 0 * 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
        StartProcessCronSummary: 'Every hour',
      }),
    ]
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
      ),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    const { container, props } = renderCalendarWorkbench({
      calendarMode: 'week',
      overrides: {
        calendarDays,
        calendarItemsByDay,
        calendarTitle: 'May 3-9, 2026',
        calendarWeekCount: 1,
        navigationUnitLabel: 'week',
        spanBars: spanBarLayout.bars,
        todayKey: dateKey(viewDate),
        viewDate,
        visibleSpanLaneLimit: 7,
      },
    })

    expect(screen.getByText('All Day')).toBeInTheDocument()
    expect(screen.getByText('10 AM')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Hourly Process/i })[0]).toHaveTextContent('Hourly')
    expect(screen.getAllByRole('button', { name: /Hourly Process/i })[0]).not.toHaveTextContent('24 runs')
    expect(screen.getAllByRole('button', { name: /Hourly Process/i })[0]).toHaveAttribute(
      'aria-label',
      expect.stringContaining('24 runs'),
    )
    expect(screen.queryByText('Hourly Process C')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '+1 more' })[0])
    expect(screen.getAllByRole('button', { name: /Hourly Process C/i })[0]).toHaveTextContent('Hourly')
    expect(screen.getAllByRole('button', { name: /Hourly Process C/i })[0]).not.toHaveTextContent('24 runs')
    expect(screen.getAllByRole('button', { name: /Hourly Process C/i })[0]).toHaveAttribute(
      'aria-label',
      expect.stringContaining('24 runs'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all-day triggers' }))
    expect(screen.queryByText('Hourly Process C')).not.toBeInTheDocument()
    const dailyProcessButton = screen.getAllByRole('button', { name: /Daily Process/i })[0]
    expect(dailyProcessButton).not.toHaveTextContent('10:00')
    expect(dailyProcessButton).not.toHaveTextContent('Daily -')
    expect(container.querySelector('.outlook-week-event-stack.is-same-time-stack')).not.toBeNull()
    const sameTimeStack = container.querySelector('.outlook-week-event-stack.is-same-time-stack') as HTMLElement
    expect(sameTimeStack.style.getPropertyValue('--stack-columns')).toBe('2')
    expect(sameTimeStack.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    expect(screen.queryByRole('combobox', { name: /trigger layout/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /Hourly Process/i })[0])
    expect(props.onOpenDayDetail).toHaveBeenCalledWith(expect.objectContaining({ schedule: schedules[1] }))
  })

  it('caps same-time Outlook Week blocks at two and opens exact-time overflow details', () => {
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedules = Array.from({ length: 6 }, (_, index) =>
      baseSchedule({
        Id: 50 + index,
        Name: `Same Time Process ${index + 1}`,
      }),
    )
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
      ),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    const { container, props } = renderCalendarWorkbench({
      calendarMode: 'week',
      overrides: {
        calendarDays,
        calendarItemsByDay,
        calendarTitle: 'May 3-9, 2026',
        calendarWeekCount: 1,
        navigationUnitLabel: 'week',
        spanBars: spanBarLayout.bars,
        todayKey: dateKey(viewDate),
        viewDate,
        visibleSpanLaneLimit: 7,
      },
    })

    expect(screen.getAllByRole('button', { name: /Same Time Process 1/i })).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: /Same Time Process 2/i })).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /Same Time Process 3/i })).not.toBeInTheDocument()
    expect(screen.getAllByText('+4 more')).toHaveLength(7)
    const overflowButtons = screen.getAllByRole('button', { name: /Show 4 more triggers at 10:00 AM/i })
    expect(overflowButtons).toHaveLength(7)

    const sameTimeStack = container.querySelector('.outlook-week-event-stack.is-same-time-stack') as HTMLElement
    expect(sameTimeStack.style.getPropertyValue('--stack-columns')).toBe('2')
    expect(sameTimeStack).toHaveClass('has-overflow')
    expect(sameTimeStack.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    expect(sameTimeStack.querySelector('.outlook-week-overflow-link')).not.toBeNull()
    const outlookWeek = container.querySelector('.outlook-week') as HTMLElement
    expect(outlookWeek.style.getPropertyValue('--week-timed-overflow-width')).toBe('44px')
    expect(outlookWeek.style.getPropertyValue('--week-timed-overflow-reserved')).toBe('46px')
    const firstVisibleBlock = screen.getAllByRole('button', { name: /Same Time Process 1/i })[0]
    expect(firstVisibleBlock).not.toHaveTextContent('10:00 AM')
    expect(firstVisibleBlock).not.toHaveTextContent('Daily -')
    fireEvent.click(firstVisibleBlock)
    expect(props.setSelectedDayDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        minuteOfDay: 600,
        scheduleKey: scheduleKey(schedules[0]!),
        scope: 'schedule',
      }),
    )

    fireEvent.click(overflowButtons[3])

    expect(props.setSelectedDayDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        key: '2026-05-06',
        minuteOfDay: 600,
        scope: 'time-slot',
      }),
    )
  })

  it('shows one exact-time overflow link when three Outlook Week blocks share a time', () => {
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedules = Array.from({ length: 3 }, (_, index) =>
      baseSchedule({
        Id: 80 + index,
        Name: `Three Time Process ${index + 1}`,
      }),
    )
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
      ),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    const { container } = renderCalendarWorkbench({
      calendarMode: 'week',
      overrides: {
        calendarDays,
        calendarItemsByDay,
        calendarTitle: 'May 3-9, 2026',
        calendarWeekCount: 1,
        navigationUnitLabel: 'week',
        spanBars: spanBarLayout.bars,
        todayKey: dateKey(viewDate),
        viewDate,
        visibleSpanLaneLimit: 7,
      },
    })

    expect(screen.getAllByRole('button', { name: /Three Time Process 1/i })).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: /Three Time Process 2/i })).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /Three Time Process 3/i })).not.toBeInTheDocument()
    expect(screen.getAllByText('+1 more')).toHaveLength(7)

    const sameTimeStack = container.querySelector('.outlook-week-event-stack.is-same-time-stack') as HTMLElement
    expect(sameTimeStack.style.getPropertyValue('--stack-columns')).toBe('2')
    expect(sameTimeStack.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
  })

  it('keeps adjacent Outlook Week stacks in the same horizontal lane', () => {
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedules = [
      ...Array.from({ length: 3 }, (_, index) =>
        baseSchedule({
          Id: 100 + index,
          Name: `Morning 945 Process ${index + 1}`,
          StartProcessCron: '0 45 9 1/1 * ?',
          StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 9, atMinute: 45 } }),
          StartProcessCronSummary: 'At 09:45 AM',
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        baseSchedule({
          Id: 110 + index,
          Name: `Morning 1000 Process ${index + 1}`,
        }),
      ),
    ]
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
      ),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    const { container } = renderCalendarWorkbench({
      calendarMode: 'week',
      overrides: {
        calendarDays,
        calendarItemsByDay,
        calendarTitle: 'May 3-9, 2026',
        calendarWeekCount: 1,
        navigationUnitLabel: 'week',
        spanBars: spanBarLayout.bars,
        todayKey: dateKey(viewDate),
        viewDate,
        visibleSpanLaneLimit: 7,
      },
    })

    const stacks = Array.from(container.querySelectorAll('.outlook-week-event-stack')) as HTMLElement[]
    const stack945 = stacks.find((stack) => within(stack).queryByRole('button', { name: /Morning 945 Process 1/i }))
    const stack1000 = stacks.find((stack) => within(stack).queryByRole('button', { name: /Morning 1000 Process 1/i }))

    expect(stack945).toBeDefined()
    expect(stack1000).toBeDefined()
    expect(stack945?.style.getPropertyValue('--stack-left')).toBe(stack1000?.style.getPropertyValue('--stack-left'))
    expect(stack945?.style.getPropertyValue('--stack-width')).toContain('100%')
    expect(stack1000?.style.getPropertyValue('--stack-width')).toContain('100%')
    expect(within(stack945!).getByRole('button', { name: /Show 1 more trigger at 9:45 AM/i })).toHaveTextContent('+1 more')
    expect(within(stack1000!).getByText('+1 more')).toBeInTheDocument()
  })

  it('places truly overlapping Outlook Week stacks into separate horizontal lanes', () => {
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedules = [
      baseSchedule({
        Id: 120,
        Name: 'Overlap 945 Process',
        StartProcessCron: '0 45 9 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 9, atMinute: 45 } }),
        StartProcessCronSummary: 'At 09:45 AM',
      }),
      baseSchedule({
        Id: 121,
        Name: 'Overlap 950 Process',
        StartProcessCron: '0 50 9 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 9, atMinute: 50 } }),
        StartProcessCronSummary: 'At 09:50 AM',
      }),
    ]
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
      ),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    const { container } = renderCalendarWorkbench({
      calendarMode: 'week',
      overrides: {
        calendarDays,
        calendarItemsByDay,
        calendarTitle: 'May 3-9, 2026',
        calendarWeekCount: 1,
        navigationUnitLabel: 'week',
        spanBars: spanBarLayout.bars,
        todayKey: dateKey(viewDate),
        viewDate,
        visibleSpanLaneLimit: 7,
      },
    })

    const stacks = Array.from(container.querySelectorAll('.outlook-week-event-stack')) as HTMLElement[]
    const stack945 = stacks.find((stack) => within(stack).queryByRole('button', { name: /Overlap 945 Process/i }))
    const stack950 = stacks.find((stack) => within(stack).queryByRole('button', { name: /Overlap 950 Process/i }))

    expect(stack945).toBeDefined()
    expect(stack950).toBeDefined()
    expect(stack945?.style.getPropertyValue('--stack-left')).not.toBe(stack950?.style.getPropertyValue('--stack-left'))
    expect(stack945?.style.getPropertyValue('--stack-width')).toContain('50%')
    expect(stack950?.style.getPropertyValue('--stack-width')).toContain('50%')
  })

  it('collapses crowded Outlook Week timed windows into a readable dense cluster', () => {
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedules = [0, 10, 20].flatMap((minuteOffset, slotIndex) =>
      Array.from({ length: 3 }, (_, processIndex) =>
        baseSchedule({
          Id: 200 + slotIndex * 10 + processIndex,
          Name: `Dense ${slotIndex + 1} Process ${processIndex + 1}`,
          StartProcessCron: `0 ${minuteOffset} 19 1/1 * ?`,
          StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 19, atMinute: minuteOffset } }),
          StartProcessCronSummary: `At 07:${String(minuteOffset).padStart(2, '0')} PM`,
        }),
      ),
    )
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
      ),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    const { container, props } = renderCalendarWorkbench({
      calendarMode: 'week',
      overrides: {
        calendarDays,
        calendarItemsByDay,
        calendarTitle: 'May 3-9, 2026',
        calendarWeekCount: 1,
        navigationUnitLabel: 'week',
        spanBars: spanBarLayout.bars,
        todayKey: dateKey(viewDate),
        viewDate,
        visibleSpanLaneLimit: 7,
      },
    })

    const denseCluster = container.querySelector('.outlook-week-event-stack.is-dense-cluster') as HTMLElement

    expect(denseCluster).not.toBeNull()
    expect(within(denseCluster).queryByRole('button', { name: /Dense 1 Process 1/i })).not.toBeInTheDocument()
    expect(within(denseCluster).queryByRole('button', { name: /Show 9 more triggers/i })).not.toBeInTheDocument()
    expect(within(denseCluster).getByRole('button', { name: /Show 9 triggers from 7:00 PM to 7:35 PM/i })).toHaveTextContent(
      '9 triggers · 7:00 PM-7:35 PM',
    )
    expect(Number.parseFloat(denseCluster.style.getPropertyValue('--stack-height'))).toBeCloseTo(37.33, 1)

    fireEvent.click(within(denseCluster).getByRole('button', { name: /Show 9 triggers from/i }))

    expect(props.setSelectedDayDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        endMinute: 1175,
        scope: 'time-range',
        startMinute: 1140,
      }),
    )
  })

  it('uses a dense card when at least three same-time Week chips are too narrow to read', async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function getClientWidth(this: HTMLElement) {
      return this.classList.contains('outlook-week-day-column') ? 120 : 0
    })
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedules = Array.from({ length: 3 }, (_, index) =>
      baseSchedule({
        Id: 300 + index,
        Name: `Narrow Process ${index + 1}`,
      }),
    )
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(
        schedules.flatMap((schedule) => getScheduleOccurrences(schedule, range.start, range.end)),
      ),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    try {
      const { container, props } = renderCalendarWorkbench({
        calendarMode: 'week',
        overrides: {
          calendarDays,
          calendarItemsByDay,
          calendarTitle: 'May 3-9, 2026',
          calendarWeekCount: 1,
          navigationUnitLabel: 'week',
          spanBars: spanBarLayout.bars,
          todayKey: dateKey(viewDate),
          viewDate,
          visibleSpanLaneLimit: 7,
        },
      })

      await waitFor(() => {
        expect(container.querySelector('.outlook-week-event-stack.is-dense-cluster')).not.toBeNull()
      })

      const denseCluster = container.querySelector('.outlook-week-event-stack.is-dense-cluster') as HTMLElement

      expect(within(denseCluster).queryByRole('button', { name: /Narrow Process 1/i })).not.toBeInTheDocument()
      expect(within(denseCluster).getByRole('button', { name: /Show 3 triggers from 10:00 AM to 10:15 AM/i })).toHaveTextContent(
        '3 triggers · 10:00 AM-10:15 AM',
      )

      fireEvent.click(within(denseCluster).getByRole('button', { name: /Show 3 triggers from/i }))

      expect(props.setSelectedDayDetail).toHaveBeenCalledWith(
        expect.objectContaining({
          endMinute: 615,
          scope: 'time-range',
          startMinute: 600,
        }),
      )
    } finally {
      clientWidthSpy.mockRestore()
    }
  })

  const spanBarsForStopDate = (stopProcessDate: string) => {
    const scenario = buildMonthScenario()
    const schedule = baseSchedule({ Id: 70, Name: 'Lifecycle Process', StopProcessDate: stopProcessDate })
    const range = getVisibleMonthRange(scenario.viewDate)
    const occurrences = getScheduleOccurrences(schedule, range.start, range.end)
    const calendarItemsByDay = buildCalendarItemsByDay(groupOccurrencesByDay(occurrences))

    return buildSpanBarLayout(scenario.calendarDays, calendarItemsByDay, 2).bars
  }

  it('shows a glowing lifecycle dot on span bars for an expired trigger', () => {
    const { container } = renderCalendarWorkbench({
      overrides: { spanBars: spanBarsForStopDate(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) },
    })

    expect(container.querySelector('.lifecycle-dot.lifecycle-expired')).not.toBeNull()
  })

  // The marker-equals-Expiring-metric invariant: a stop date beyond EXPIRING_SOON_DAYS is
  // informational ('ending') and must not render a marker on any calendar surface.
  it('renders no lifecycle dot on span bars for a far-future stop date', () => {
    const { container } = renderCalendarWorkbench({
      overrides: { spanBars: spanBarsForStopDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()) },
    })

    expect(container.querySelector('.calendar-span-bar')).not.toBeNull()
    expect(container.querySelector('.lifecycle-dot')).toBeNull()
  })

  const renderWeekForStopDate = (stopProcessDate: string) => {
    const viewDate = new Date(2026, 4, 6)
    const calendarDays = getWeekDays(viewDate)
    const range = getVisibleWeekRange(viewDate)
    const schedule = baseSchedule({ Id: 71, Name: 'Lifecycle Week Process', StopProcessDate: stopProcessDate })
    const calendarItemsByDay = buildCalendarItemsByDay(
      groupOccurrencesByDay(getScheduleOccurrences(schedule, range.start, range.end)),
    )
    const spanBarLayout = buildSpanBarLayout(calendarDays, calendarItemsByDay, 7)

    return renderCalendarWorkbench({
      calendarMode: 'week',
      overrides: {
        calendarDays,
        calendarItemsByDay,
        calendarTitle: 'May 3-9, 2026',
        calendarWeekCount: 1,
        navigationUnitLabel: 'week',
        spanBars: spanBarLayout.bars,
        todayKey: dateKey(viewDate),
        viewDate,
        visibleSpanLaneLimit: 7,
      },
    })
  }

  it('shows a glowing lifecycle dot on Outlook Week timed events for a trigger expiring within EXPIRING_SOON_DAYS', () => {
    const { container } = renderWeekForStopDate(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString())

    expect(container.querySelector('.lifecycle-dot.lifecycle-expiring-soon')).not.toBeNull()
  })

  it('renders no lifecycle dot on Outlook Week timed events for a far-future stop date', () => {
    const { container } = renderWeekForStopDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString())

    expect(container.querySelector('.outlook-week-event')).not.toBeNull()
    expect(container.querySelector('.lifecycle-dot')).toBeNull()
  })
})

describe('UpcomingPanel component', () => {
  it('defaults to a collapsed rail and expands from the rail action', () => {
    const { group } = hourlyGroupForDay()
    const onToggleExpanded = vi.fn()

    render(
      <UpcomingPanel
        activeSelectedDayDetail={null}
        disabledCount={0}
        enabledCount={1}
        isExpanded={false}
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={onToggleExpanded}
        onOpenDay={vi.fn()}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={[]}
        upcomingDisplayGroups={[{ key: dateKey(group.date), label: 'TODAY', items: [group] }]}
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Upcoming' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /expand upcoming pane/i }))

    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('renders grouped upcoming pills and opens day details from a pill', () => {
    const { group } = hourlyGroupForDay()
    const onOpenDayDetail = vi.fn()

    render(
      <UpcomingPanel
        activeSelectedDayDetail={null}
        disabledCount={0}
        enabledCount={1}
        isExpanded
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenDayDetail={onOpenDayDetail}
        selectedDayOccurrences={[]}
        upcomingDisplayGroups={[{ key: dateKey(group.date), label: 'TODAY', items: [group] }]}
      />,
    )

    const pill = screen.getByRole('button', { name: /Hourly Process/i })
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument()
    expect(pill).toHaveTextContent('Hourly · Shared')
    expect(pill).toHaveTextContent(/Next \d{1,2}:00/)

    fireEvent.click(pill)

    expect(onOpenDayDetail).toHaveBeenCalledWith(group)
  })

  it('limits dense upcoming groups and exposes the remaining triggers as a drill-in row', () => {
    const { group } = hourlyGroupForDay()
    const items = Array.from({ length: 13 }, (_, index) => ({
      ...group,
      id: `${group.id}-${index}`,
      schedule: {
        ...group.schedule,
        Id: group.schedule.Id + index,
        Name: `Hourly Process ${index + 1}`,
      },
    }))
    const onOpenDay = vi.fn()

    render(
      <UpcomingPanel
        activeSelectedDayDetail={null}
        disabledCount={0}
        enabledCount={13}
        isExpanded
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={vi.fn()}
        onOpenDay={onOpenDay}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={[]}
        upcomingDisplayGroups={[{ key: dateKey(group.date), label: 'TODAY', items }]}
      />,
    )

    expect(screen.getAllByRole('button', { name: /Hourly Process/i })).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: '+1 more' }))

    expect(onOpenDay).toHaveBeenCalledWith({ key: dateKey(group.date), date: group.date, scope: 'day' })
  })

  it('renders exact day details and closes back to upcoming', () => {
    const { date, group, occurrences } = hourlyGroupForDay()
    const onClose = vi.fn()

    render(
      <UpcomingPanel
        activeSelectedDayDetail={{ key: dateKey(date), date, scheduleKey: group.scheduleKey, scope: 'schedule' }}
        disabledCount={0}
        enabledCount={1}
        isExpanded
        onCloseDayDetails={onClose}
        onToggleExpanded={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={occurrences}
        upcomingDisplayGroups={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Trigger Details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hourly Process' })).toBeInTheDocument()
    expect(screen.getByText('Hourly · Shared')).toBeInTheDocument()
    expect(screen.getByText('+19 more')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close details/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders runtime stats, timezone, and robot/machine when the run-info maps are supplied', () => {
    const { date, group, occurrences } = robotGroupForDay()

    render(
      <UpcomingPanel
        activeSelectedDayDetail={{ key: dateKey(date), date, scheduleKey: group.scheduleKey, scope: 'schedule' }}
        disabledCount={0}
        enabledCount={1}
        isExpanded
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={occurrences}
        upcomingDisplayGroups={[]}
        runtimeStats={new Map([[group.schedule.Id, { medianSec: 180, p90Sec: 300, sampleSize: 15 }]])}
        robotNames={new Map([[201, 'rparobot@intuit.com-unattended']])}
        machineNames={new Map([[501, 'ROBOT-VM-01']])}
        scheduleMachineIds={new Map([[group.schedule.Id, [501]]])}
      />,
    )

    expect(screen.getByText('Time zone: America/Chicago')).toBeInTheDocument()
    expect(screen.getByText('Runtime · based on 15 runs')).toBeInTheDocument()
    expect(screen.getByText('Typical 3m · Worst case (p90) 5m')).toBeInTheDocument()
    expect(screen.getByText('Robot: rparobot')).toBeInTheDocument()
    expect(screen.getByText('Machine: ROBOT-VM-01')).toBeInTheDocument()
  })

  it('summarizes the machine list as a hover affordance when many hosts run the schedule', () => {
    const { date, group, occurrences } = robotGroupForDay()
    const machineIds = [501, 502, 503, 504, 505]

    render(
      <UpcomingPanel
        activeSelectedDayDetail={{ key: dateKey(date), date, scheduleKey: group.scheduleKey, scope: 'schedule' }}
        disabledCount={0}
        enabledCount={1}
        isExpanded
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={occurrences}
        upcomingDisplayGroups={[]}
        runtimeStats={new Map([[group.schedule.Id, { medianSec: 180, p90Sec: 300, sampleSize: 15 }]])}
        robotNames={new Map([[201, 'rparobot@intuit.com-unattended']])}
        machineNames={new Map(machineIds.map((id, index) => [id, `HOST-${index + 1}`]))}
        scheduleMachineIds={new Map([[group.schedule.Id, machineIds]])}
      />,
    )

    expect(screen.getByRole('button', { name: '5 machines (dynamic pool)' })).toBeInTheDocument()
    // Full host list lives in the tooltip (Radix portal) — not in the DOM until hover.
    expect(screen.queryByText(/HOST-1, HOST-2/)).not.toBeInTheDocument()
  })

  it('falls back to "No recent run history" when the run-info maps are supplied but the schedule has no stats', () => {
    const { date, group, occurrences } = hourlyGroupForDay()

    render(
      <UpcomingPanel
        activeSelectedDayDetail={{ key: dateKey(date), date, scheduleKey: group.scheduleKey, scope: 'schedule' }}
        disabledCount={0}
        enabledCount={1}
        isExpanded
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={occurrences}
        upcomingDisplayGroups={[]}
        runtimeStats={new Map()}
        robotNames={new Map()}
        machineNames={new Map()}
        scheduleMachineIds={new Map()}
      />,
    )

    expect(screen.getByText('No recent run history')).toBeInTheDocument()
    expect(screen.queryByText(/^Runtime ·/)).not.toBeInTheDocument()
  })

  it('omits run info (timezone aside) when no run-info maps are supplied', () => {
    const { date, group, occurrences } = hourlyGroupForDay()

    render(
      <UpcomingPanel
        activeSelectedDayDetail={{ key: dateKey(date), date, scheduleKey: group.scheduleKey, scope: 'schedule' }}
        disabledCount={0}
        enabledCount={1}
        isExpanded
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={occurrences}
        upcomingDisplayGroups={[]}
      />,
    )

    expect(screen.getByText('Time zone: America/Chicago')).toBeInTheDocument()
    expect(screen.queryByText('No recent run history')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Robot:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Machine:/)).not.toBeInTheDocument()
  })

  const renderDayDetailForStopDate = (stopProcessDate: string) => {
    const schedule = baseSchedule({
      Id: 72,
      Name: 'Hourly Process',
      ReleaseName: 'Download.File',
      StartProcessCron: '0 0 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every hour',
      StopProcessDate: stopProcessDate,
    })
    const date = new Date(2026, 4, 6)
    const { start, end } = dayRange(date)
    const occurrences = getScheduleOccurrences(schedule, start, end)
    const group = buildProcessDayGroups(occurrences)[0]

    return render(
      <UpcomingPanel
        activeSelectedDayDetail={{ key: dateKey(date), date, scheduleKey: group.scheduleKey, scope: 'schedule' }}
        disabledCount={0}
        enabledCount={1}
        isExpanded
        onCloseDayDetails={vi.fn()}
        onToggleExpanded={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenDayDetail={vi.fn()}
        selectedDayOccurrences={occurrences}
        upcomingDisplayGroups={[]}
      />,
    )
  }

  it('shows the full glowing lifecycle badge in the group heading for an expired trigger', () => {
    const { container } = renderDayDetailForStopDate(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    const badge = container.querySelector('.lifecycle-badge.lifecycle-expired')
    expect(badge).not.toBeNull()
    // role="img" is what makes the aria-label reliably exposed; a bare span is role=generic,
    // where ARIA prohibits aria-label and user agents need not expose it.
    expect(badge).toHaveAttribute('role', 'img')
    // Past stop date → past tense. The far-future case below still reads "Ends", which is what
    // proves the tense keys off the date rather than being hardcoded.
    expect(screen.getByRole('img', { name: /^Ended on / })).toBeInTheDocument()
    expect(screen.getByText(/^Ended on /)).toBeInTheDocument()
  })

  it('renders no lifecycle badge for a far-future stop date but keeps the Ends text line', () => {
    const { container } = renderDayDetailForStopDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString())

    expect(container.querySelector('.lifecycle-badge')).toBeNull()
    expect(screen.getByText(/^Ends /)).toBeInTheDocument()
  })

  it('omits the stop strategy when Orchestrator did not report one', () => {
    const { container } = renderDayDetailForStopDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString())

    // StopStrategy is unset on this fixture, so no strategy must be asserted in the UI.
    expect(container.querySelector('.day-detail-meta')?.textContent).not.toMatch(/Soft Stop|Kill/)
  })
})

describe('ScheduleTable component', () => {
  it('renders numbered enterprise columns with compact metadata chips and truncation titles', () => {
    const longProcessName = 'WeeklyFactoryUtilization_UpdateUploadReport_Performer_Main.xaml'
    const schedules = [
      baseSchedule({
        Id: 21,
        Name: 'Process A',
        ReleaseName: longProcessName,
      }),
      baseSchedule({
        Id: 22,
        Name: 'Process B',
        Enabled: false,
        ReleaseName: 'Download.File',
        StartProcessCron: '0 0 * 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
        StartProcessCronSummary: 'Every hour',
      }),
      baseSchedule({
        Id: 23,
        Name: 'Process C',
        ReleaseName: 'RealtimeMonitor.File',
        StartProcessCron: '0 * * 1/1 * ?',
        StartProcessCronDetails: JSON.stringify({ type: 0, minutely: { interval: 1 } }),
        StartProcessCronSummary: 'Every minute',
      }),
    ]

    render(<ScheduleTable schedules={schedules} />)

    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual(['#', 'Name', 'Process', 'Folder', 'Machine', 'Robot', 'Trigger Type', 'Pattern', 'Status'])
    expect(within(table).getByText('1')).toBeInTheDocument()
    expect(within(table).getByText('2')).toBeInTheDocument()
    expect(within(table).getByText('3')).toBeInTheDocument()
    expect(screen.getByText(longProcessName)).toBeInTheDocument()
    expect(screen.getByText('Every hour')).toBeInTheDocument()
    expect(screen.getByText('Daily')).toBeInTheDocument()
    expect(screen.getByText('Hourly')).toBeInTheDocument()
    expect(screen.getByText('Minute-by-minute')).toBeInTheDocument()
    expect(screen.getAllByText('Enabled')).toHaveLength(2)
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    // With no machine/robot maps passed, both columns render but read "—".
    expect(table.querySelector('.table-machine')?.textContent).toBe('—')
    expect(table.querySelector('.table-robot')?.textContent).toBe('—')
  })

  it('renders machine and robot columns with first value plus +N overflow and a hover list', () => {
    const schedules = [
      baseSchedule({
        Id: 41,
        Name: 'Pool Process',
        MachineRobots: [
          { MachineId: null, MachineName: null, RobotId: 201, RobotUserName: 'Bot.Alpha', SessionId: null, SessionName: null },
        ],
      }),
      baseSchedule({
        Id: 42,
        Name: 'Single Machine Process',
        MachineRobots: [
          { MachineId: null, MachineName: null, RobotId: 202, RobotUserName: 'Bot.Beta', SessionId: null, SessionName: null },
        ],
      }),
      baseSchedule({ Id: 43, Name: 'No Runtime Process' }),
    ]
    const scheduleMachineIds = new Map<number, number[]>([
      [41, [501, 502, 503]],
      [42, [504]],
      // 43 has no run history
    ])
    const machineNames = new Map<number, string>([
      [501, 'HOST-1'],
      [502, 'HOST-2'],
      [503, 'HOST-3'],
      [504, 'HOST-4'],
    ])
    const robotNames = new Map<number, string>([[201, 'rparobot@example.com-unattended']])

    render(
      <ScheduleTable
        schedules={schedules}
        scheduleMachineIds={scheduleMachineIds}
        machineNames={machineNames}
        robotNames={robotNames}
      />,
    )

    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual(['#', 'Name', 'Process', 'Folder', 'Machine', 'Robot', 'Trigger Type', 'Pattern', 'Status'])

    // Row 41: 3 machines → first host + "+2"; robot resolved via robotNames → formatRobotDisplayName.
    expect(screen.getByText('HOST-1')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('rparobot')).toBeInTheDocument()
    // Full host list lives only in the (portal) tooltip — not inline in the DOM.
    expect(screen.queryByText('HOST-1, HOST-2, HOST-3')).not.toBeInTheDocument()

    // Row 42: single machine → plain host (no +N badge); robot falls back to inline RobotUserName.
    expect(screen.getByText('HOST-4')).toBeInTheDocument()
    expect(screen.getByText('Bot.Beta')).toBeInTheDocument()

    // Row 43: no machine/robot data → "—" in both cells.
    const machineCells = Array.from(table.querySelectorAll('.table-machine')).map((cell) => cell.textContent)
    const robotCells = Array.from(table.querySelectorAll('.table-robot')).map((cell) => cell.textContent)
    expect(machineCells).toContain('—')
    expect(robotCells).toContain('—')
  })

  it('sizes inventory columns from the loaded trigger data without forcing horizontal scroll', () => {
    const schedules = [
      baseSchedule({
        Id: 31,
        Name: 'Short Name',
        ReleaseName: 'Short.Process',
        folderName: 'HR/PP/TA_DATA',
        StartProcessCronSummary: 'At 25 seconds past the minute, every minute during business hours',
      }),
      baseSchedule({
        Id: 32,
        Name: 'Long Trigger Name That Should Influence Name Width',
        ReleaseName: 'LongReleaseNameThatShouldInfluenceProcessWidth.Main.xaml',
        folderName: 'HR/PP/Talent Market Operations',
        StartProcessCronSummary: 'At 04:30 AM, only on Monday, Wednesday, and Friday',
      }),
    ]

    render(<ScheduleTable schedules={schedules} />)

    const table = screen.getByRole('table')

    expect(table.style.getPropertyValue('--inventory-folder-width')).toMatch(/%$/)
    expect(table.style.getPropertyValue('--inventory-pattern-width')).toMatch(/%$/)
    expect(table.style.getPropertyValue('--inventory-process-width')).toMatch(/%$/)
    // Wide enough for the "Auto-disabled" status chip, which would otherwise ellipsize.
    expect(table.style.getPropertyValue('--inventory-status-width')).toBe('9.5%')
    expect(table.style.getPropertyValue('--inventory-type-width')).toBe('10.5%')
    expect(table.style.getPropertyValue('--inventory-table-min-width')).toBe('')
  })

  // reservedColumnPercent is a hand-maintained sum of the fixed column widths. If it drifts, the
  // text-weighted columns are handed more space than is left and the row overflows horizontally.
  it('keeps the fixed and dynamic column widths summing to 100%', () => {
    render(<ScheduleTable schedules={[baseSchedule({ Id: 81, Name: 'Width Probe' })]} />)

    const table = screen.getByRole('table')
    const percent = (name: string) =>
      Number.parseFloat(table.style.getPropertyValue(`--inventory-${name}-width`))
    const fixed = 2.4 + percent('status') + percent('type') + percent('machine') + percent('robot')
    const dynamic = ['name', 'process', 'folder', 'pattern'].reduce((sum, k) => sum + percent(k), 0)

    expect(fixed + dynamic).toBeCloseTo(100, 1)
  })

  it('shows a glowing lifecycle icon in the Pattern column with an accessible label and tooltip', async () => {
    const stopDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const schedules = [
      baseSchedule({
        Id: 51,
        Name: 'Expiring Soon Process',
        StopProcessDate: stopDate.toISOString(),
        StopStrategy: 'SoftStop',
      }),
      baseSchedule({ Id: 52, Name: 'No Stop Date Process' }),
    ]

    const { container } = render(<ScheduleTable schedules={schedules} />)

    // Only the schedule with a StopProcessDate gets a badge; the other row has none.
    const badges = container.querySelectorAll('.lifecycle-badge')
    expect(badges).toHaveLength(1)
    const badge = badges[0] as HTMLElement
    expect(badge).toHaveClass('lifecycle-expiring-soon')
    // Assert the ACCESSIBLE name, not just the attribute: role="img" is what makes aria-label
    // exposed at all (a bare span is role=generic, where ARIA prohibits aria-label).
    expect(screen.getByRole('img', { name: /^Ends / })).toBe(badge)

    // Full date-time also lives in the tooltip (Radix portal) — revealed on focus.
    fireEvent.focus(badge)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Ends /)
  })

  it('distinguishes an auto-disabled trigger from one someone switched off', () => {
    const schedules = [
      baseSchedule({
        Id: 71,
        Name: 'Stopped On End Date',
        Enabled: false,
        StopProcessDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }),
      baseSchedule({ Id: 72, Name: 'Switched Off By Hand', Enabled: false }),
      baseSchedule({ Id: 73, Name: 'Running Fine' }),
    ]

    const { container } = render(<ScheduleTable schedules={schedules} />)

    const statuses = Array.from(container.querySelectorAll('.status')).map((s) => s.textContent)
    expect(statuses).toEqual(['Auto-disabled', 'Disabled', 'Enabled'])
    // The row still carries its lifecycle marker — the two signals are independent.
    expect(container.querySelectorAll('.lifecycle-badge')).toHaveLength(1)
  })

  it('marks only the triggers the Expiring metric counts, not far-future stop dates', () => {
    const schedules = [
      baseSchedule({
        Id: 61,
        Name: 'Expiring Soon Process',
        StopProcessDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      baseSchedule({
        Id: 62,
        Name: 'Ends Far Future Process',
        StopProcessDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]

    const { container } = render(<ScheduleTable schedules={schedules} />)

    // A stop date beyond EXPIRING_SOON_DAYS is informational, not an attention marker — so the
    // badge's presence stays exactly equal to the Expiring metric's definition.
    expect(container.querySelectorAll('.lifecycle-badge')).toHaveLength(1)
    expect(container.querySelector('.lifecycle-badge')).toHaveClass('lifecycle-expiring-soon')
  })
})
