import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UiPath } from '@uipath/uipath-typescript/core'
import {
  AlertTriangle,
  Bot,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  Copy,
  Folder,
  Server,
  Zap,
} from 'lucide-react'
import {
  dateKey,
  buildEffectiveScheduleMachineIds,
  deriveFolderScopeSelection,
  deriveMachineScopeSelection,
  formatRobotDisplayName,
} from './scheduleUtils'
import {
  defaultMonthSpanLaneLimit,
  emptyFolders,
  emptySchedules,
  getEnvironmentDisplayLabel,
  iconSize,
  maxMonthSpanLaneLimit,
  minMonthSpanLaneLimit,
  defaultTenantName,
  monthSpanLaneStepPx,
  monthSpanReservedHeightPx,
  viewModeStorageKey,
  weekVisibleSpanRows,
} from './constants'
import {
  readInitialViewMode,
} from './calendarDisplay'
import { getStatusAwareFolders, pruneSelectedFolderIdsForStatus } from './folderOptions'
import { buildSummaryMetricData } from './summaryMetrics'
import type { SummaryMetricKey } from './summaryMetrics'
import {
  AppHeader,
  CalendarWorkbench,
  FilterToolbar,
  ScheduleTable,
  UpcomingPanel,
} from './components'
import {
  useCalendarModel,
  useScheduleData,
  useScheduleFilters,
  useThemeMode,
  useUpcomingModel,
  applyAttentionFilter,
} from './hooks'
import type {
  AttentionFilter,
  CalendarViewMode,
  MachineOption,
  ProcessDayGroup,
  SelectedDayDetail,
  StatusFilter,
  TriggerTypeFilter,
  ViewMode,
  WorkspaceView,
} from './types'
import { useJobRuntimes } from '@/features/jobs/hooks/useJobRuntimes'
import { fetchOData, fetchODataMetadata } from '@/features/orchestrator/odataClient'
import { cacheClear, cacheKey } from '@/features/orchestrator/cache'

const testingRouteEnabled = import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
const testingConnectionTitle = testingRouteEnabled
  ? 'Generated stress-test triggers are loaded locally. No Orchestrator triggers were created or changed.'
  : ''

const dayRangeFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

const summaryIconForMetric = (key: SummaryMetricKey) => {
  switch (key) {
    case 'enabled':
      return <CheckCircle2 size={iconSize} aria-hidden="true" />
    case 'activeToday':
    case 'suppressedToday':
      return <CalendarCheck2 size={iconSize} aria-hidden="true" />
    case 'folders':
      return <Folder size={iconSize} aria-hidden="true" />
    case 'machines':
      return <Server size={iconSize} aria-hidden="true" />
    case 'robots':
      return <Bot size={iconSize} aria-hidden="true" />
    case 'duplicateSchedules':
      return <Copy size={iconSize} aria-hidden="true" />
    case 'stale':
      return <AlertTriangle size={iconSize} aria-hidden="true" />
    case 'collisions':
      return <Zap size={iconSize} aria-hidden="true" />
    case 'triggers':
    default:
      return <CalendarClock size={iconSize} aria-hidden="true" />
  }
}

function Dashboard({
  configuredTenantNames = [],
  environmentSourceUrl,
  onManageConnection,
  sdk,
}: {
  configuredTenantNames?: string[]
  environmentSourceUrl?: string
  onManageConnection?: () => void
  sdk?: UiPath | null
}) {
  const {
    activeTenant,
    data,
    isLoading,
    isRevalidating,
    isTestingEnvironment,
    loadError,
    refresh,
    selectTenant,
    selectedStressCount,
    selectedTenant,
    stressData,
    tenantError,
    tenantOptions,
  } = useScheduleData(sdk, configuredTenantNames)
  const { resolvedTheme, setThemeMode } = useThemeMode()
  const runtimeTenant = activeTenant.name !== defaultTenantName ? activeTenant.name : undefined
  const [viewDate, setViewDate] = useState(() => new Date())
  const [calendarMode, setCalendarMode] = useState<CalendarViewMode>('month')
  const [viewMode, setViewMode] = useState<ViewMode>(readInitialViewMode)
  const [monthSpanLaneLimit, setMonthSpanLaneLimit] = useState(defaultMonthSpanLaneLimit)
  const weekSpanLaneLimit = weekVisibleSpanRows
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('calendar')
  const [selectedDayDetail, setSelectedDayDetail] = useState<SelectedDayDetail | null>(null)
  const [isUpcomingExpanded, setIsUpcomingExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('enabled')
  const [triggerTypeFilter, setTriggerTypeFilter] = useState<TriggerTypeFilter>('all')
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('none')
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])
  const [selectedMachineIds, setSelectedMachineIds] = useState<number[]>([])
  const [selectedRobotIds, setSelectedRobotIds] = useState<number[]>([])
  const calendarGridRef = useRef<HTMLDivElement | null>(null)

  const handleFullRefresh = useCallback(() => {
    if (sdk && runtimeTenant) {
      const org = sdk.config.orgName
      cacheClear(cacheKey('runtimeStats', org, runtimeTenant))
    }
    refresh()
  }, [sdk, runtimeTenant, refresh])

  useEffect(() => {
    window.localStorage.setItem(viewModeStorageKey, viewMode)
  }, [viewMode])
  const folders = data?.folders ?? emptyFolders
  const schedules = data?.schedules ?? emptySchedules

  useEffect(() => {
    if (!import.meta.env.DEV || !sdk || activeTenant.name === defaultTenantName) return
    const tenant = activeTenant.name
    const firstFolderId = folders[0]?.Id
    const debugObj = {
      fetch: (path: string, folderId?: number) => fetchOData(sdk, tenant, path, folderId),
      metadata: () => fetchODataMetadata(sdk, tenant),
      sessions: (folderId = firstFolderId) => fetchOData(sdk, tenant, 'Sessions?$top=10', folderId),
      robots: (folderId = firstFolderId) => fetchOData(sdk, tenant, 'Robots?$top=10', folderId),
    }
    ;(window as unknown as Record<string, unknown>).__orchestratorDebug = debugObj
    return () => { delete (window as unknown as Record<string, unknown>).__orchestratorDebug }
  }, [sdk, activeTenant, folders])
  const runtimeFolderIds = useMemo(
    () => Array.from(new Set(schedules.map((s) => s.folderId))),
    [schedules],
  )
  const { runtimeStats, robotNames, machineNames, scheduleMachineIds, releaseMachineIds } = useJobRuntimes(sdk, runtimeTenant, runtimeFolderIds.length ? runtimeFolderIds : undefined)
  // Effective machine-per-schedule: direct scheduled-job machines, with release (manual-run)
  // machines as a fallback only for schedules that have no direct association.
  const effectiveScheduleMachineIds = useMemo(
    () => buildEffectiveScheduleMachineIds(schedules, scheduleMachineIds, releaseMachineIds),
    [schedules, scheduleMachineIds, releaseMachineIds],
  )
  const statusAwareFolders = useMemo(
    () => getStatusAwareFolders(folders, schedules, statusFilter),
    [folders, schedules, statusFilter],
  )
  const handleStatusFilterChange = useCallback((nextStatusFilter: StatusFilter) => {
    const nextStatusAwareFolders = getStatusAwareFolders(folders, schedules, nextStatusFilter)
    const nextSelectedFolderIds = pruneSelectedFolderIdsForStatus(selectedFolderIds, nextStatusAwareFolders)

    if (nextSelectedFolderIds.length !== selectedFolderIds.length) {
      setSelectedFolderIds(nextSelectedFolderIds)
    }

    setSelectedDayDetail(null)
    setStatusFilter(nextStatusFilter)
  }, [folders, schedules, selectedFolderIds])
  const handleQueryChange = useCallback((nextQuery: string) => {
    setSelectedDayDetail(null)
    setQuery(nextQuery)
  }, [])
  const handleSelectedFolderIdsChange = useCallback((nextSelectedFolderIds: string[]) => {
    setSelectedDayDetail(null)
    setSelectedFolderIds(nextSelectedFolderIds)
  }, [])
  const handleTriggerTypeFilterChange = useCallback((nextTriggerTypeFilter: TriggerTypeFilter) => {
    setSelectedDayDetail(null)
    setTriggerTypeFilter(nextTriggerTypeFilter)
  }, [])
  const { filteredSchedules, preAttentionSchedules, trimmedQuery } = useScheduleFilters({
    attentionFilter,
    query,
    schedules,
    scheduleMachineIds: effectiveScheduleMachineIds,
    collisionMachineIds: scheduleMachineIds,
    selectedFolderIds,
    selectedMachineIds,
    selectedRobotIds,
    statusFilter,
    triggerTypeFilter,
  })
  const {
    activeSelectedDayDetail,
    calendarDays,
    calendarItemsByDay,
    calendarRenderMode,
    calendarTitle,
    calendarWeekCount,
    selectedDayOccurrences,
    shouldRenderSpanBars,
    spanBarLayout,
    todayKey,
    visibleSpanLaneLimit,
    yearMonths,
  } = useCalendarModel({
    calendarMode,
    filteredSchedules,
    monthSpanLaneLimit,
    runtimeStats,
    selectedDayDetail,
    viewDate,
    viewMode,
    weekSpanLaneLimit,
  })
  const { upcomingDisplayGroups } = useUpcomingModel(filteredSchedules)

  const enabledCount = useMemo(
    () => filteredSchedules.reduce((total, schedule) => total + (schedule.Enabled ? 1 : 0), 0),
    [filteredSchedules],
  )
  const disabledCount = filteredSchedules.length - enabledCount
  const todayRange = useMemo(() => dayRangeFromKey(todayKey), [todayKey])
  const summaryMetrics = useMemo(
    () =>
      buildSummaryMetricData({
        schedules: filteredSchedules,
        scheduleMachineIds: effectiveScheduleMachineIds,
        collisionMachineIds: scheduleMachineIds,
        selectedMachineIds,
        selectedRobotIds,
        statusFilter,
        todayEnd: todayRange.end,
        todayStart: todayRange.start,
      }).map((metric) => ({
        ...metric,
        icon: summaryIconForMetric(metric.key),
      })),
    [filteredSchedules, effectiveScheduleMachineIds, scheduleMachineIds, selectedMachineIds, selectedRobotIds, statusFilter, todayRange],
  )
  const activeMetricKey: SummaryMetricKey | null =
    attentionFilter === 'duplicates'
      ? 'duplicateSchedules'
      : attentionFilter === 'stale'
        ? 'stale'
        : attentionFilter === 'collisions'
          ? 'collisions'
          : null
  const robotOptions = useMemo(() => {
    // Narrow robot options to robots used by the current scope: when a machine is selected,
    // robots that ran on that machine; when folder(s) are selected, robots used in those
    // folders. Both are drill-down aids (option-list only — never auto-apply a robot filter,
    // see handleMachineSelection). When both are active the two sets INTERSECT.
    const machineScopeRobots = selectedMachineIds.length
      ? new Set(deriveMachineScopeSelection(schedules, effectiveScheduleMachineIds, selectedMachineIds).robotIds)
      : null
    const folderScopeRobots = selectedFolderIds.length
      ? new Set(deriveFolderScopeSelection(schedules, effectiveScheduleMachineIds, selectedFolderIds).robotIds)
      : null
    const seen = new Set<number>()
    const options: { id: number; name: string }[] = []
    for (const s of schedules) {
      for (const mr of s.MachineRobots ?? []) {
        if (mr.RobotId != null && !seen.has(mr.RobotId)) {
          if (machineScopeRobots && !machineScopeRobots.has(mr.RobotId)) continue
          if (folderScopeRobots && !folderScopeRobots.has(mr.RobotId)) continue
          seen.add(mr.RobotId)
          // Prefer the canonical Robot.Name (from Jobs $expand=Robot), shortened to the
          // account portion to match the Orchestrator UI; fall back to the Domain\Username
          // on MachineRobots, then a synthetic label.
          const canonical = robotNames.get(mr.RobotId)
          const name = canonical ? formatRobotDisplayName(canonical) : (mr.RobotUserName ?? `Robot ${mr.RobotId}`)
          options.push({ id: mr.RobotId, name })
        }
      }
    }
    return options.sort((a, b) => a.name.localeCompare(b.name))
  }, [schedules, robotNames, selectedMachineIds, selectedFolderIds, effectiveScheduleMachineIds])
  // Machine options come from JOB HISTORY (the machines schedules actually ran on),
  // not the schedule's configured MachineRobots — which on dynamic-allocation tenants is
  // null (machine resolved at runtime) and never reflects where work runs. Name-only:
  // machine state/type is unavailable on these tenants (Sessions 403s), so there is no
  // inventory to enrich with. When folder(s) are selected, narrow to the machines used in
  // those folders (option-list only — mirrors robot narrowing; never auto-applies a filter).
  const machineOptions = useMemo<MachineOption[]>(() => {
    const folderScopeMachines = selectedFolderIds.length
      ? new Set(deriveFolderScopeSelection(schedules, effectiveScheduleMachineIds, selectedFolderIds).machineIds)
      : null
    const runtimeMachineIds = new Set<number>()
    for (const ids of effectiveScheduleMachineIds.values()) {
      for (const id of ids) runtimeMachineIds.add(id)
    }
    const options: MachineOption[] = []
    for (const id of runtimeMachineIds) {
      if (folderScopeMachines && !folderScopeMachines.has(id)) continue
      options.push({ id, name: machineNames.get(id) ?? `Machine ${id}` })
    }
    return options.sort((a, b) => a.name.localeCompare(b.name))
  }, [schedules, selectedFolderIds, effectiveScheduleMachineIds, machineNames])
  const handleMetricClick = useCallback(
    (key: SummaryMetricKey) => {
      setSelectedDayDetail(null)
      const next: AttentionFilter =
        key === 'duplicateSchedules'
          ? attentionFilter === 'duplicates' ? 'none' : 'duplicates'
          : key === 'stale'
            ? attentionFilter === 'stale' ? 'none' : 'stale'
            : key === 'collisions'
              ? attentionFilter === 'collisions' ? 'none' : 'collisions'
              : attentionFilter
      setAttentionFilter(next)

      if (next === 'none') {
        setSelectedFolderIds([])
        return
      }
      const matches = applyAttentionFilter(
        preAttentionSchedules,
        next,
        selectedMachineIds.length ? new Set(selectedMachineIds) : undefined,
        selectedRobotIds.length ? new Set(selectedRobotIds) : undefined,
        scheduleMachineIds,
      )
      setSelectedFolderIds(Array.from(new Set(matches.map((s) => String(s.folderId)))))
    },
    [attentionFilter, preAttentionSchedules, selectedMachineIds, selectedRobotIds, scheduleMachineIds],
  )
  // Selecting a machine auto-narrows the FOLDER picker to where that machine is active
  // (mirrors the metric-tile → folder auto-narrow), and narrows the robot picker's OPTION
  // list (below) — but does not auto-apply a robot filter, since machine data (Jobs) and
  // robot data (inline config) have different coverage and auto-selecting robots would
  // hide machine-matched schedules that use dynamic allocation. Clearing resets folders.
  const handleMachineSelection = useCallback(
    (nextMachineIds: number[]) => {
      setSelectedMachineIds(nextMachineIds)
      if (!nextMachineIds.length) {
        setSelectedFolderIds([])
        return
      }
      const { folderIds } = deriveMachineScopeSelection(
        schedules,
        effectiveScheduleMachineIds,
        nextMachineIds,
      )
      setSelectedFolderIds(folderIds)
    },
    [schedules, effectiveScheduleMachineIds],
  )
  const attentionChipLabel: Record<Exclude<AttentionFilter, 'none'>, string> = {
    collisions: 'Collisions only',
    duplicates: 'Duplicates only',
    stale: 'Stale only',
  }
  const hasNotices = Boolean(tenantError || loadError)
  const headerFilterChips = [
    trimmedQuery
      ? {
          label: `Search: ${trimmedQuery}`,
          onClear: () => handleQueryChange(''),
        }
      : null,
    attentionFilter !== 'none'
      ? {
          label: attentionChipLabel[attentionFilter],
          onClear: () => {
            setAttentionFilter('none')
            setSelectedFolderIds([])
          },
        }
      : null,
  ].filter((chip): chip is { label: string; onClear: () => void } => Boolean(chip))
  useEffect(() => {
    if (calendarMode !== 'month') return

    const grid = calendarGridRef.current
    if (!grid) return
    if (typeof ResizeObserver === 'undefined') return

    const updateVisibleLaneLimit = () => {
      const weekdayHeaderHeight = grid.querySelector<HTMLElement>('.weekday')?.offsetHeight ?? 24
      const cellHeight = Math.max(0, (grid.clientHeight - weekdayHeaderHeight) / calendarWeekCount)
      const measuredLimit = Math.floor((cellHeight - monthSpanReservedHeightPx) / monthSpanLaneStepPx)
      const nextLimit = Math.min(maxMonthSpanLaneLimit, Math.max(minMonthSpanLaneLimit, measuredLimit))
      setMonthSpanLaneLimit((current) => (current === nextLimit ? current : nextLimit))
    }

    updateVisibleLaneLimit()

    const resizeObserver = new ResizeObserver(updateVisibleLaneLimit)
    resizeObserver.observe(grid)

    return () => resizeObserver.disconnect()
  }, [calendarMode, calendarWeekCount])

  const moveCalendar = useCallback((delta: number) => {
    setViewDate((current) => {
      if (calendarMode === 'year') {
        return new Date(current.getFullYear() + delta, 0, 1)
      }

      if (calendarMode === 'month') {
        return new Date(current.getFullYear(), current.getMonth() + delta, 1)
      }

      const next = new Date(current)
      next.setDate(current.getDate() + delta * 7)
      return next
    })
  }, [calendarMode])
  const navigationUnitLabel =
    calendarMode === 'year' ? 'year' : calendarMode === 'month' ? 'month' : 'week'
  const openMonthFromYear = useCallback((month: Date) => {
    setViewDate(month)
    setCalendarMode('month')
    setSelectedDayDetail(null)
  }, [])
  const openDayDetail = useCallback((item: ProcessDayGroup) => {
    setIsUpcomingExpanded(true)
    setSelectedDayDetail({
      key: dateKey(item.date),
      date: item.date,
      scheduleKey: item.scheduleKey,
      scope: 'schedule',
    })
  }, [])
  const openSelectedDayDetail = useCallback((detail: SelectedDayDetail) => {
    setIsUpcomingExpanded(true)
    setSelectedDayDetail(detail)
  }, [])
  const connectionState = loadError ? 'issue' : isLoading ? 'syncing' : 'connected'
  const connectionLabel = loadError
    ? 'Sync Failed'
    : isLoading
      ? 'Syncing...'
      : stressData
        ? 'Stress Data'
        : 'Live'
  const connectionTitle =
    connectionState === 'connected'
      ? stressData
        ? testingConnectionTitle
        : 'Trigger data loaded successfully from UiPath Orchestrator.'
      : connectionState === 'syncing'
        ? 'Trigger data is currently refreshing from UiPath Orchestrator.'
        : 'The app could not load trigger data from UiPath Orchestrator.'
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
  const nextThemeLabel = nextTheme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'
  const environmentDisplayLabel = isTestingEnvironment
    ? 'Testing'
    : getEnvironmentDisplayLabel(environmentSourceUrl ?? sdk?.config.baseUrl)

  return (
    <main className={`app-shell ${hasNotices ? 'has-notices' : 'no-notices'}`}>
      <AppHeader
        activeMetricKey={activeMetricKey}
        activeTenantName={activeTenant.displayName}
        connectionLabel={connectionLabel}
        connectionState={connectionState}
        connectionTitle={connectionTitle}
        environmentDisplayLabel={environmentDisplayLabel}
        headerFilterChips={headerFilterChips}
        isLoading={isLoading}
        isRevalidating={isRevalidating}
        metrics={summaryMetrics}
        nextThemeLabel={nextThemeLabel}
        onManageConnection={onManageConnection}
        onMetricClick={handleMetricClick}
        onTenantChange={(tenantName) => {
          selectTenant(tenantName)
          setSelectedFolderIds([])
          setSelectedDayDetail(null)
          setIsUpcomingExpanded(false)
        }}
        refresh={handleFullRefresh}
        resolvedTheme={resolvedTheme}
        selectedStressCount={selectedStressCount}
        selectedTenant={selectedTenant}
        setThemeMode={setThemeMode}
        tenantOptions={tenantOptions}
      />

      {hasNotices ? (
        <section className="notice-stack" aria-label="Sync notices">
          {tenantError ? <div className="notice warning">Tenant list fallback active: {tenantError}</div> : null}
          {loadError ? <div className="notice error">Error: {loadError}</div> : null}
        </section>
      ) : null}

      <FilterToolbar
        query={query}
        setQuery={handleQueryChange}
        selectedFolderIds={selectedFolderIds}
        setSelectedFolderIds={handleSelectedFolderIdsChange}
        setStatusFilter={handleStatusFilterChange}
        setTriggerTypeFilter={handleTriggerTypeFilterChange}
        setWorkspaceView={setWorkspaceView}
        statusFilter={statusFilter}
        statusAwareFolders={statusAwareFolders}
        triggerTypeFilter={triggerTypeFilter}
        workspaceView={workspaceView}
        machines={machineOptions}
        selectedMachineIds={selectedMachineIds}
        setSelectedMachineIds={handleMachineSelection}
        robotOptions={robotOptions}
        selectedRobotIds={selectedRobotIds}
        setSelectedRobotIds={setSelectedRobotIds}
      />

      {workspaceView === 'calendar' ? (
        <section
          className={`workspace ${isUpcomingExpanded || activeSelectedDayDetail ? 'upcoming-expanded' : 'upcoming-collapsed'}`}
          aria-label="Planner canvas"
        >
          <CalendarWorkbench
            calendarDays={calendarDays}
            calendarGridRef={calendarGridRef}
            calendarItemsByDay={calendarItemsByDay}
            calendarMode={calendarMode}
            calendarRenderMode={calendarRenderMode}
            calendarTitle={calendarTitle}
            calendarWeekCount={calendarWeekCount}
            moveCalendar={moveCalendar}
            navigationUnitLabel={navigationUnitLabel}
            onOpenDayDetail={openDayDetail}
            onOpenMonthFromYear={openMonthFromYear}
            runtimeStats={runtimeStats}
            setCalendarMode={setCalendarMode}
            setSelectedDayDetail={openSelectedDayDetail}
            setViewMode={setViewMode}
            setViewDate={setViewDate}
            shouldRenderSpanBars={shouldRenderSpanBars}
            spanBars={spanBarLayout.bars}
            todayKey={todayKey}
            viewMode={viewMode}
            viewDate={viewDate}
            visibleSpanLaneLimit={visibleSpanLaneLimit}
            yearMonths={yearMonths}
          />

          <UpcomingPanel
            activeSelectedDayDetail={activeSelectedDayDetail}
            disabledCount={disabledCount}
            enabledCount={enabledCount}
            isExpanded={isUpcomingExpanded || Boolean(activeSelectedDayDetail)}
            onCloseDayDetails={() => setSelectedDayDetail(null)}
            onOpenDay={openSelectedDayDetail}
            onOpenDayDetail={openDayDetail}
            onToggleExpanded={() => setIsUpcomingExpanded((current) => !current)}
            selectedDayOccurrences={selectedDayOccurrences}
            upcomingDisplayGroups={upcomingDisplayGroups}
            runtimeStats={runtimeStats}
            robotNames={robotNames}
            machineNames={machineNames}
            scheduleMachineIds={effectiveScheduleMachineIds}
          />
        </section>
      ) : (
        <ScheduleTable
          schedules={filteredSchedules}
          className="inventory-view"
          robotNames={robotNames}
          machineNames={machineNames}
          scheduleMachineIds={effectiveScheduleMachineIds}
        />
      )}
    </main>
  )
}

export default function SchedulePlanner({
  configuredTenantNames,
  environmentSourceUrl,
  onManageConnection,
  sdk,
}: {
  configuredTenantNames?: string[]
  environmentSourceUrl?: string
  onManageConnection?: () => void
  sdk?: UiPath | null
}) {
  return (
    <Dashboard
      configuredTenantNames={configuredTenantNames}
      environmentSourceUrl={environmentSourceUrl}
      onManageConnection={onManageConnection}
      sdk={sdk}
    />
  )
}
